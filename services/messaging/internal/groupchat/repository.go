package groupchat

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the SQL of group chat.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wraps the pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{db: pool} }

// latest: the latest 100 messages of the group (oldest first).
func (r *Repository) latest(ctx context.Context, gid string) ([]msgRow, error) {
	rows, err := r.db.Query(ctx, `SELECT * FROM (SELECT m.id::text, m.seq, m.sender_id::text, m.body, m.created_at
		FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.group_id = $1
		ORDER BY m.seq DESC LIMIT 100) latest ORDER BY seq`, gid)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(rw pgx.CollectableRow) (msgRow, error) {
		var x msgRow
		var seq int64
		err := rw.Scan(&x.id, &seq, &x.sender, &x.body, &x.created)
		return x, err
	})
}

// insert stores a message in the group's conversation (created the first time), in one transaction.
func (r *Repository) insert(ctx context.Context, gid, me, body string) (id string, created time.Time, err error) {
	err = pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		var conv string
		if err := tx.QueryRow(ctx, `INSERT INTO conversations (kind, group_id) VALUES ('group', $1)
			ON CONFLICT (group_id) DO UPDATE SET group_id = EXCLUDED.group_id RETURNING id::text`, gid).Scan(&conv); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)
			RETURNING id::text, created_at`, conv, me, body).Scan(&id, &created); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE conversations SET last_message_at = $2 WHERE id = $1`, conv, created)
		return err
	})
	return
}

// sender returns who wrote the message; pgx.ErrNoRows when the group has no such message.
func (r *Repository) sender(ctx context.Context, msgID, gid string) (string, error) {
	var sender string
	err := r.db.QueryRow(ctx, `SELECT m.sender_id::text FROM messages m JOIN conversations c ON c.id = m.conversation_id
		WHERE m.id = $1 AND c.group_id = $2`, msgID, gid).Scan(&sender)
	return sender, err
}

func (r *Repository) delete(ctx context.Context, msgID string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM messages WHERE id = $1`, msgID)
	return err
}
