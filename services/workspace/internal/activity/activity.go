// Package activity is the story feed: one line per draft or task event ("who did what to which chapter").
package activity

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

// Log adds a line to the story feed in the caller's transaction. detail says what it is about (a draft or a task:
// their chapter, step...).
func Log(ctx context.Context, tx pgx.Tx, story, actorID string, actorName *string, action string, detail map[string]any) error {
	body, _ := json.Marshal(detail)
	var actor *string
	if actorID != "" {
		actor = &actorID
	}
	_, err := tx.Exec(ctx, `INSERT INTO ws_activity (story_id, actor_id, actor_name, action, detail) VALUES ($1, $2, $3, $4, $5)`, story, actor, actorName, action, body)
	return err
}
