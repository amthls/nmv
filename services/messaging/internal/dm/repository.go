package dm

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the SQL of direct messages, labels, blocks and pins.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wraps the pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{db: pool} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// blockState: whether me blocked other, and whether other blocked me.
func (r *Repository) blockState(ctx context.Context, me, other string) (byMe, byThem bool, err error) {
	err = r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2),
		EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $2 AND blocked_id = $1)`, me, other).Scan(&byMe, &byThem)
	return
}

// inbox: one row per person I talked with (latest first).
func (r *Repository) inbox(ctx context.Context, me string, label, pattern *string) ([]inboxRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT o.user_id::text, lm.body, lm.sender_id::text, lm.created_at,
		       (SELECT count(*) FROM messages x WHERE x.conversation_id = c.id AND x.seq > me.last_read_seq AND x.sender_id <> $1)::int,
		       COALESCE((SELECT array_agg(lc.label_id::text) FROM dm_label_conversations lc JOIN dm_labels dl ON dl.id = lc.label_id
		                 WHERE dl.user_id = $1 AND lc.partner_id = o.user_id), '{}'),
		       EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = o.user_id),
		       (SELECT body FROM messages x WHERE $3::text IS NOT NULL AND x.conversation_id = c.id AND x.body ILIKE $3 ORDER BY seq DESC LIMIT 1)
		FROM conversation_members me
		JOIN conversations c ON c.id = me.conversation_id AND c.kind = 'dm' AND c.last_message_at IS NOT NULL
		JOIN conversation_members o ON o.conversation_id = c.id AND o.user_id <> me.user_id
		JOIN LATERAL (SELECT body, sender_id, created_at FROM messages WHERE conversation_id = c.id ORDER BY seq DESC LIMIT 1) lm ON true
		WHERE me.user_id = $1
		  AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM dm_label_conversations lc JOIN dm_labels dl ON dl.id = lc.label_id
		                                   WHERE dl.user_id = $1 AND lc.label_id = $2 AND lc.partner_id = o.user_id))
		ORDER BY c.last_message_at DESC
		LIMIT 300`, me, label, pattern)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(rw pgx.CollectableRow) (inboxRow, error) {
		var x inboxRow
		err := rw.Scan(&x.partner, &x.last, &x.lastSender, &x.lastAt, &x.unread, &x.labels, &x.blocked, &x.match)
		return x, err
	})
}

// unreadTotal counts every unread message, whatever filter the inbox shows.
func (r *Repository) unreadTotal(ctx context.Context, me string) (int, error) {
	var unread int
	err := r.db.QueryRow(ctx, `SELECT COALESCE(sum((SELECT count(*) FROM messages x WHERE x.conversation_id = me.conversation_id
		AND x.seq > me.last_read_seq AND x.sender_id <> $1)), 0)::int
		FROM conversation_members me JOIN conversations c ON c.id = me.conversation_id AND c.kind = 'dm' WHERE me.user_id = $1`, me).Scan(&unread)
	return unread, err
}

// markRead: everything there is now counts as read by me.
func (r *Repository) markRead(ctx context.Context, key, me string) error {
	_, err := r.db.Exec(ctx, `UPDATE conversation_members m SET last_read_seq = x.max_seq, last_read_at = NOW()
		FROM (SELECT c.id, (SELECT COALESCE(max(seq), 0) FROM messages WHERE conversation_id = c.id) AS max_seq
		      FROM conversations c WHERE c.dm_key = $1) x
		WHERE m.conversation_id = x.id AND m.user_id = $2 AND m.last_read_seq < x.max_seq`, key, me)
	return err
}

func (r *Repository) loadConv(ctx context.Context, me, other string) (dmConv, error) {
	var c dmConv
	err := r.db.QueryRow(ctx, `SELECT c.id::text, o.last_read_seq, o.last_read_at, m.last_read_seq, m.last_read_at
		FROM conversations c
		JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $2
		JOIN conversation_members o ON o.conversation_id = c.id AND o.user_id = $3
		WHERE c.dm_key = $1`, dmKey(me, other), me, other).Scan(&c.id, &c.partnerReadSeq, &c.partnerReadAt, &c.myReadSeq, &c.myReadAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, nil
	}
	c.exists = err == nil
	return c, err
}

func (r *Repository) messageRows(ctx context.Context, query, convID string) ([]msgRow, error) {
	rows, err := r.db.Query(ctx, query, convID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(rw pgx.CollectableRow) (msgRow, error) {
		var x msgRow
		err := rw.Scan(&x.id, &x.seq, &x.sender, &x.body, &x.created, &x.pinnedAt, &x.pinnedBy, &x.draft)
		return x, err
	})
}

// latest: the latest 100 messages (oldest first).
func (r *Repository) latest(ctx context.Context, convID string) ([]msgRow, error) {
	return r.messageRows(ctx, `SELECT * FROM (SELECT id::text, seq, sender_id::text, body, created_at, pinned_at, pinned_by::text, draft_id::text
			FROM messages WHERE conversation_id = $1 ORDER BY seq DESC LIMIT 100) latest ORDER BY seq`, convID)
}

// pinned: every pinned message, newest pin first.
func (r *Repository) pinned(ctx context.Context, convID string) ([]msgRow, error) {
	return r.messageRows(ctx, `SELECT id::text, seq, sender_id::text, body, created_at, pinned_at, pinned_by::text, draft_id::text
			FROM messages WHERE conversation_id = $1 AND pinned_at IS NOT NULL ORDER BY pinned_at DESC`, convID)
}

// labelsOf: the labels I put on my conversation with a partner.
func (r *Repository) labelsOf(ctx context.Context, me, partner string) ([]string, error) {
	var labels []string
	err := r.db.QueryRow(ctx, `SELECT COALESCE(array_agg(lc.label_id::text), '{}') FROM dm_label_conversations lc
		JOIN dm_labels dl ON dl.id = lc.label_id WHERE dl.user_id = $1 AND lc.partner_id = $2`, me, partner).Scan(&labels)
	return labels, err
}

// insertMessage stores a message in the pair's conversation, creating it the first time, in one transaction.
func (r *Repository) insertMessage(ctx context.Context, me, other, body string, draftID *string) (id string, created time.Time, err error) {
	err = pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		var conv string
		if err := tx.QueryRow(ctx, `INSERT INTO conversations (kind, dm_key) VALUES ('dm', $1)
			ON CONFLICT (dm_key) DO UPDATE SET dm_key = EXCLUDED.dm_key RETURNING id::text`, dmKey(me, other)).Scan(&conv); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)
			ON CONFLICT DO NOTHING`, conv, me, other); err != nil {
			return err
		}
		var seq int64
		if err := tx.QueryRow(ctx, `INSERT INTO messages (conversation_id, sender_id, body, draft_id) VALUES ($1, $2, $3, $4)
			RETURNING id::text, seq, created_at`, conv, me, body, draftID).Scan(&id, &seq, &created); err != nil {
			return err
		}
		// The sender has read their own message
		if _, err := tx.Exec(ctx, `UPDATE conversations SET last_message_at = $2 WHERE id = $1`, conv, created); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE conversation_members SET last_read_seq = $3, last_read_at = NOW()
			WHERE conversation_id = $1 AND user_id = $2`, conv, me, seq)
		return err
	})
	return
}

func (r *Repository) labels(ctx context.Context, me string) ([]map[string]any, error) {
	rows, err := r.db.Query(ctx, `SELECT dl.id::text, dl.name, dl.color, count(lc.partner_id)::int
		FROM dm_labels dl LEFT JOIN dm_label_conversations lc ON lc.label_id = dl.id
		WHERE dl.user_id = $1 GROUP BY dl.id ORDER BY dl.created_at`, me)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(rw pgx.CollectableRow) (map[string]any, error) {
		var id, name, color string
		var n int
		err := rw.Scan(&id, &name, &color, &n)
		return map[string]any{"id": id, "name": name, "color": color, "conversation_count": n}, err
	})
}

func (r *Repository) labelCount(ctx context.Context, me string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM dm_labels WHERE user_id = $1`, me).Scan(&n)
	return n, err
}

// createLabel inserts a label; errDuplicateLabel when the person already has one with this name.
func (r *Repository) createLabel(ctx context.Context, me, name, color string) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `INSERT INTO dm_labels (user_id, name, color) VALUES ($1, $2, $3) RETURNING id::text`, me, name, color).Scan(&id)
	return id, err
}

func (r *Repository) updateLabel(ctx context.Context, id, me string, name, color *string) (n, c string, err error) {
	err = r.db.QueryRow(ctx, `UPDATE dm_labels SET name = COALESCE($3, name), color = COALESCE($4, color)
		WHERE id = $1 AND user_id = $2 RETURNING name, color`, id, me, name, color).Scan(&n, &c)
	return
}

func (r *Repository) deleteLabel(ctx context.Context, id, me string) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM dm_labels WHERE id = $1 AND user_id = $2`, id, me)
	return tag.RowsAffected(), err
}

func (r *Repository) ownedLabels(ctx context.Context, me string, ids []string) (int, error) {
	var owned int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM dm_labels WHERE user_id = $1 AND id = ANY($2::uuid[])`, me, ids).Scan(&owned)
	return owned, err
}

// replaceLabels swaps the labels on my conversation with a partner, in one transaction.
func (r *Repository) replaceLabels(ctx context.Context, me, partner string, ids []string) error {
	return pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM dm_label_conversations lc USING dm_labels dl
			WHERE dl.id = lc.label_id AND dl.user_id = $1 AND lc.partner_id = $2`, me, partner); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO dm_label_conversations (label_id, partner_id) SELECT unnest($1::uuid[]), $2 ON CONFLICT DO NOTHING`, ids, partner)
		return err
	})
}

func (r *Repository) block(ctx context.Context, me, other string) error {
	_, err := r.db.Exec(ctx, `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, me, other)
	return err
}

func (r *Repository) unblock(ctx context.Context, me, other string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, me, other)
	return err
}

// pinCount: how many other messages of the conversation are pinned.
func (r *Repository) pinCount(ctx context.Context, key, msgID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
		WHERE c.dm_key = $1 AND m.pinned_at IS NOT NULL AND m.id <> $2`, key, msgID).Scan(&n)
	return n, err
}

// setPin pins or unpins a message of the conversation; pgx.ErrNoRows when it is not there.
func (r *Repository) setPin(ctx context.Context, pin bool, key, msgID, me string) (id string, at *time.Time, err error) {
	q := `UPDATE messages m SET pinned_at = NULL, pinned_by = NULL FROM conversations c
			WHERE c.id = m.conversation_id AND c.dm_key = $1 AND m.id = $2 AND $3::uuid IS NOT NULL RETURNING m.id::text, m.pinned_at`
	if pin {
		q = `UPDATE messages m SET pinned_at = COALESCE(m.pinned_at, NOW()), pinned_by = COALESCE(m.pinned_by, $3) FROM conversations c
				WHERE c.id = m.conversation_id AND c.dm_key = $1 AND m.id = $2 RETURNING m.id::text, m.pinned_at`
	}
	err = r.db.QueryRow(ctx, q, key, msgID, me).Scan(&id, &at)
	return
}
