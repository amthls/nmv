package notifications

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const broadcastDays = "30 days"

// Repository is the SQL of notifications, settings and announcements.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wraps the pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{db: pool} }

// upsertNotification: skip a dedupe key seen before; otherwise insert, or merge into the person's unread row with the
// same group key (newest actor first, at most 3 kept, count + 1, unseen again, moves to the top).
// shortcut: actor_count grows unless the actor is among the 3 kept, so one person commenting often counts more than once;
// keep every actor id if that matters.
const upsertNotification = `
WITH d AS (
  INSERT INTO notification_dedupe (key) SELECT $1 WHERE $1 <> '' ON CONFLICT DO NOTHING RETURNING 1
)
INSERT INTO notifications AS n (user_id, type, category, title, message, link, image, actors, actor_count, data, group_key)
SELECT $2, $3, $4, $5, $6, $7, $8, $9::jsonb, jsonb_array_length($9::jsonb), $10::jsonb, NULLIF($11, '')
WHERE $1 = '' OR EXISTS (SELECT 1 FROM d)
ON CONFLICT (user_id, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL DO UPDATE SET
  title = EXCLUDED.title, message = EXCLUDED.message, link = EXCLUDED.link, image = COALESCE(EXCLUDED.image, n.image),
  actors = (SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]') FROM (
    SELECT e, o FROM (
      SELECT DISTINCT ON (e->>'id') e, o FROM jsonb_array_elements(EXCLUDED.actors || n.actors) WITH ORDINALITY x(e, o) ORDER BY e->>'id', o
    ) u ORDER BY o LIMIT 3) k),
  actor_count = n.actor_count + CASE WHEN EXCLUDED.actors = '[]'::jsonb
    OR n.actors @> jsonb_build_array(jsonb_build_object('id', EXCLUDED.actors->0->'id')) THEN 0 ELSE 1 END,
  count = n.count + 1, data = n.data || EXCLUDED.data, seen_at = NULL, updated_at = NOW()
RETURNING user_id::text`

// switchedOff returns "<user>|<category>" for every category the users switched off.
func (r *Repository) switchedOff(ctx context.Context, ids []string) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT user_id::text || '|' || category FROM notification_settings WHERE user_id = ANY($1) AND NOT web`, ids)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// upsertBatch runs the queued upsertNotification statements in one transaction; returns who got something new and how
// many rows were created or merged into.
func (r *Repository) upsertBatch(ctx context.Context, b *pgx.Batch) (map[string]bool, int, error) {
	got := map[string]bool{}
	n := 0
	err := pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		br := tx.SendBatch(ctx, b)
		for i := 0; i < b.Len(); i++ {
			var u string
			err := br.QueryRow().Scan(&u)
			if err == pgx.ErrNoRows {
				continue // delivered before
			}
			if err != nil {
				br.Close()
				return err
			}
			got[u] = true
			n++
		}
		return br.Close()
	})
	return got, n, err
}

// list: own rows plus live announcements, newest first.
func (r *Repository) list(ctx context.Context, me, cat string, unread bool, before *time.Time, limit int, pattern string) ([]notificationOut, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id::text, type, category, title, message, link, image, actors, actor_count, count, data, seen_at IS NOT NULL, read_at, created_at, updated_at
		FROM notifications WHERE user_id = $1 AND ($2 = '' OR category = $2) AND (NOT $3 OR read_at IS NULL)
		  AND ($4::timestamptz IS NULL OR updated_at < $4) AND ($6 = '' OR title ILIKE $6 OR message ILIKE $6)
		UNION ALL
		SELECT b.id::text, 'broadcast', 'system', b.title, b.message, b.link, NULL, '[]', 0, 1, '{}', r.seen_at IS NOT NULL, r.read_at, b.created_at, b.created_at
		FROM broadcasts b LEFT JOIN broadcast_reads r ON r.broadcast_id = b.id AND r.user_id = $1
		WHERE b.created_at > NOW() - INTERVAL '`+broadcastDays+`' AND $2 IN ('', 'system') AND (NOT $3 OR r.read_at IS NULL)
		  AND ($4::timestamptz IS NULL OR b.created_at < $4) AND ($6 = '' OR b.title ILIKE $6 OR b.message ILIKE $6)
		ORDER BY 15 DESC LIMIT $5`, me, cat, unread, before, limit, pattern)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (notificationOut, error) {
		var n notificationOut
		err := row.Scan(&n.ID, &n.Type, &n.Category, &n.Title, &n.Message, &n.Link, &n.Image, &n.Actors, &n.ActorCount, &n.Count,
			&n.Data, &n.Seen, &n.ReadAt, &n.CreatedAt, &n.UpdatedAt)
		n.IsRead = n.ReadAt != nil
		n.Title = groupedTitle(n)
		return n, err
	})
}

// counts: the bell's number (unseen) and the unread total.
func (r *Repository) counts(ctx context.Context, me string) (unseenCounts, error) {
	var c unseenCounts
	err := r.db.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM notifications WHERE user_id = $1 AND seen_at IS NULL)
		     + (SELECT count(*) FROM broadcasts b WHERE b.created_at > NOW() - INTERVAL '`+broadcastDays+`'
		        AND NOT EXISTS (SELECT 1 FROM broadcast_reads r WHERE r.broadcast_id = b.id AND r.user_id = $1 AND r.seen_at IS NOT NULL)),
		       (SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL)
		     + (SELECT count(*) FROM broadcasts b WHERE b.created_at > NOW() - INTERVAL '`+broadcastDays+`'
		        AND NOT EXISTS (SELECT 1 FROM broadcast_reads r WHERE r.broadcast_id = b.id AND r.user_id = $1 AND r.read_at IS NOT NULL))`,
		me).Scan(&c.unseen, &c.unread)
	return c, err
}

// markSeen: the bell was opened.
func (r *Repository) markSeen(ctx context.Context, me string) error {
	return pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE notifications SET seen_at = NOW() WHERE user_id = $1 AND seen_at IS NULL`, me); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO broadcast_reads (broadcast_id, user_id, seen_at)
			SELECT id, $1, NOW() FROM broadcasts WHERE created_at > NOW() - INTERVAL '`+broadcastDays+`'
			ON CONFLICT (broadcast_id, user_id) DO UPDATE SET seen_at = COALESCE(broadcast_reads.seen_at, NOW())`, me)
		return err
	})
}

// markRead marks a notification, or (when it is not one of mine) an announcement, as read; returns rows touched.
func (r *Repository) markRead(ctx context.Context, id, me string) (int64, error) {
	tag, err := r.db.Exec(ctx, `UPDATE notifications SET read_at = COALESCE(read_at, NOW()), seen_at = COALESCE(seen_at, NOW())
		WHERE id = $1 AND user_id = $2`, id, me)
	if err == nil && tag.RowsAffected() == 0 {
		tag, err = r.db.Exec(ctx, `INSERT INTO broadcast_reads (broadcast_id, user_id, seen_at, read_at)
			SELECT id, $2, NOW(), NOW() FROM broadcasts WHERE id = $1
			ON CONFLICT (broadcast_id, user_id) DO UPDATE SET read_at = COALESCE(broadcast_reads.read_at, NOW()),
			  seen_at = COALESCE(broadcast_reads.seen_at, NOW())`, id, me)
	}
	return tag.RowsAffected(), err
}

// markAllRead marks every unread notification (of a category, or all) and, for "system", the announcements.
func (r *Repository) markAllRead(ctx context.Context, me, cat string) error {
	return pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE notifications SET read_at = NOW(), seen_at = COALESCE(seen_at, NOW())
			WHERE user_id = $1 AND read_at IS NULL AND ($2 = '' OR category = $2)`, me, cat); err != nil {
			return err
		}
		if cat != "" && cat != "system" {
			return nil
		}
		_, err := tx.Exec(ctx, `INSERT INTO broadcast_reads (broadcast_id, user_id, seen_at, read_at)
			SELECT id, $1, NOW(), NOW() FROM broadcasts WHERE created_at > NOW() - INTERVAL '`+broadcastDays+`'
			ON CONFLICT (broadcast_id, user_id) DO UPDATE SET read_at = COALESCE(broadcast_reads.read_at, NOW()),
			  seen_at = COALESCE(broadcast_reads.seen_at, NOW())`, me)
		return err
	})
}

func (r *Repository) deleteNotification(ctx context.Context, id, me string) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM notifications WHERE id = $1 AND user_id = $2`, id, me)
	return tag.RowsAffected(), err
}

// disabledCategories: the categories I switched off on the web.
func (r *Repository) disabledCategories(ctx context.Context, me string) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT category FROM notification_settings WHERE user_id = $1 AND NOT web`, me)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// applySettings runs the queued settings statements.
func (r *Repository) applySettings(ctx context.Context, b *pgx.Batch) error {
	return r.db.SendBatch(ctx, b).Close()
}

func (r *Repository) broadcasts(ctx context.Context) ([]map[string]any, error) {
	rows, err := r.db.Query(ctx, `SELECT b.id::text, b.title, b.message, b.link, b.created_at,
		(SELECT count(*) FROM broadcast_reads r WHERE r.broadcast_id = b.id AND r.read_at IS NOT NULL)
		FROM broadcasts b ORDER BY b.created_at DESC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (map[string]any, error) {
		var id, title string
		var msg, link *string
		var at time.Time
		var reads int
		err := row.Scan(&id, &title, &msg, &link, &at, &reads)
		return map[string]any{"id": id, "title": title, "message": msg, "link": link, "created_at": at, "read_count": reads}, err
	})
}

func (r *Repository) createBroadcast(ctx context.Context, title, msg, link, by string) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `INSERT INTO broadcasts (title, message, link, created_by) VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4)
		RETURNING id::text`, title, msg, link, by).Scan(&id)
	return id, err
}

func (r *Repository) deleteBroadcast(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM broadcasts WHERE id = $1`, id)
	return err
}

// cleanupQueries keep the inbox small: read > 30 days, unread > 60 days, dedupe keys > 60 days, announcements > 30 days,
// chat messages > 7 months (pinned ones stay).
var cleanupQueries = []string{
	`DELETE FROM notifications WHERE read_at < NOW() - INTERVAL '30 days'`,
	`DELETE FROM notifications WHERE read_at IS NULL AND updated_at < NOW() - INTERVAL '60 days'`,
	`DELETE FROM notification_dedupe WHERE created_at < NOW() - INTERVAL '60 days'`,
	`DELETE FROM broadcasts WHERE created_at < NOW() - INTERVAL '30 days'`,
	`DELETE FROM messages WHERE created_at < NOW() - INTERVAL '7 months' AND pinned_at IS NULL`,
}

func (r *Repository) cleanup(ctx context.Context, q string) error {
	_, err := r.db.Exec(ctx, q)
	return err
}
