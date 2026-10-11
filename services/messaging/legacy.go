package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// importLegacy copies direct messages, group chats, blocks and labels from the backend's database (novel_platform)
// into messaging_db, keeping message and label UUIDs. Only adds what is missing, never overwrites; each part is
// recorded in legacy_imports and never runs again (a group message deleted here must not come back).
// Read state: a dm member has read up to their newest message from the other person that has read_at set.
//
//	docker compose run --rm -e LEGACY_DATABASE_URL=... messaging import-legacy
func importLegacy(ctx context.Context, db *pgxpool.Pool, legacyURL string) error {
	if legacyURL == "" {
		return fmt.Errorf("LEGACY_DATABASE_URL is required")
	}
	old, err := pgx.Connect(ctx, legacyURL)
	if err != nil {
		return err
	}
	defer old.Close(ctx)
	var exists, done bool
	if err := old.QueryRow(ctx, `SELECT to_regclass('direct_messages') IS NOT NULL`).Scan(&exists); err != nil || !exists {
		logInfo(ctx, "import-legacy: no legacy tables, nothing to do")
		return err
	}
	if err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM legacy_imports WHERE part = 'messages')`).Scan(&done); err != nil {
		return err
	}
	if done {
		logInfo(ctx, "import-legacy: messages already imported")
		return importLegacyNotifications(ctx, db, old)
	}

	collect := func(q string) ([][]any, error) {
		rows, err := old.Query(ctx, q)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, func(r pgx.CollectableRow) ([]any, error) { return r.Values() })
	}
	dms, err := collect(`SELECT id, sender_id, recipient_id, message, read_at, created_at, pinned_at, pinned_by, draft_id
		FROM direct_messages ORDER BY created_at, id`)
	if err != nil {
		return err
	}
	groups, err := collect(`SELECT id, group_id, user_id, message, created_at FROM group_messages ORDER BY created_at, id`)
	if err != nil {
		return err
	}
	blocks, err := collect(`SELECT blocker_id, blocked_id, created_at FROM user_blocks`)
	if err != nil {
		return err
	}
	labels, err := collect(`SELECT id, user_id, name, color, created_at FROM dm_labels`)
	if err != nil {
		return err
	}
	labelled, err := collect(`SELECT label_id, partner_id, created_at FROM dm_label_conversations`)
	if err != nil {
		return err
	}

	var added [5]int64
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		uuid := func(v any) string {
			b, ok := v.([16]byte)
			if !ok {
				return ""
			}
			return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
		}
		for _, m := range dms {
			from, to := uuid(m[1]), uuid(m[2])
			var conv string
			if err := tx.QueryRow(ctx, `INSERT INTO conversations (kind, dm_key) VALUES ('dm', $1)
				ON CONFLICT (dm_key) DO UPDATE SET dm_key = EXCLUDED.dm_key RETURNING id::text`, dmKey(from, to)).Scan(&conv); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`,
				conv, from, to); err != nil {
				return err
			}
			var seq int64
			err := tx.QueryRow(ctx, `INSERT INTO messages (id, conversation_id, sender_id, body, created_at, pinned_at, pinned_by, draft_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING RETURNING seq`,
				m[0], conv, from, m[3], m[5], m[6], m[7], m[8]).Scan(&seq)
			if err == pgx.ErrNoRows {
				continue // already imported
			}
			if err != nil {
				return err
			}
			added[0]++
			if _, err := tx.Exec(ctx, `UPDATE conversations SET last_message_at = GREATEST(COALESCE(last_message_at, $2), $2) WHERE id = $1`, conv, m[5]); err != nil {
				return err
			}
			// The sender has read it; the recipient has if read_at is set
			if _, err := tx.Exec(ctx, `UPDATE conversation_members SET last_read_seq = GREATEST(last_read_seq, $3),
				last_read_at = GREATEST(COALESCE(last_read_at, $4), $4) WHERE conversation_id = $1 AND user_id = $2`, conv, from, seq, m[5]); err != nil {
				return err
			}
			if m[4] != nil {
				if _, err := tx.Exec(ctx, `UPDATE conversation_members SET last_read_seq = GREATEST(last_read_seq, $3),
					last_read_at = GREATEST(COALESCE(last_read_at, $4), $4) WHERE conversation_id = $1 AND user_id = $2`, conv, to, seq, m[4]); err != nil {
					return err
				}
			}
		}
		for _, m := range groups {
			var conv string
			if err := tx.QueryRow(ctx, `INSERT INTO conversations (kind, group_id) VALUES ('group', $1)
				ON CONFLICT (group_id) DO UPDATE SET group_id = EXCLUDED.group_id RETURNING id::text`, m[1]).Scan(&conv); err != nil {
				return err
			}
			tag, err := tx.Exec(ctx, `INSERT INTO messages (id, conversation_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (id) DO NOTHING`, m[0], conv, m[2], m[3], m[4])
			if err != nil {
				return err
			}
			added[1] += tag.RowsAffected()
			if _, err := tx.Exec(ctx, `UPDATE conversations SET last_message_at = GREATEST(COALESCE(last_message_at, $2), $2) WHERE id = $1`, conv, m[4]); err != nil {
				return err
			}
		}
		for _, b := range blocks {
			tag, err := tx.Exec(ctx, `INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, b...)
			if err != nil {
				return err
			}
			added[2] += tag.RowsAffected()
		}
		for _, l := range labels {
			tag, err := tx.Exec(ctx, `INSERT INTO dm_labels (id, user_id, name, color, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, l...)
			if err != nil {
				return err
			}
			added[3] += tag.RowsAffected()
		}
		for _, l := range labelled {
			tag, err := tx.Exec(ctx, `INSERT INTO dm_label_conversations (label_id, partner_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, l...)
			if err != nil {
				return err
			}
			added[4] += tag.RowsAffected()
		}
		_, err := tx.Exec(ctx, `INSERT INTO legacy_imports (part) VALUES ('messages')`)
		return err
	})
	if err != nil {
		return err
	}
	logInfo(ctx, fmt.Sprintf("import-legacy: %d/%d direct messages, %d/%d group messages, %d/%d blocks, %d/%d labels, %d/%d labelled conversations added",
		added[0], len(dms), added[1], len(groups), added[2], len(blocks), added[3], len(labels), added[4], len(labelled)))
	return importLegacyNotifications(ctx, db, old)
}

// legacyCategory: the old enum type + reference type -> a category (drafts, tasks and take-downs all used 'system').
func legacyCategory(typ, ref string) string {
	switch {
	case typ == "chapter_update" || typ == "bookmark_update":
		return "read"
	case typ == "comment_reply" || typ == "post_comment" || typ == "post_reaction":
		return "interaction"
	case strings.HasPrefix(typ, "group_"):
		return "group"
	case ref == "draft" || ref == "draft_edit" || ref == "ws_story":
		return "workspace"
	case ref == "post" || ref == "story":
		return "moderation"
	}
	return "system"
}

// importLegacyNotifications copies the backend's notifications (same ids; the link is built from its tables, as the
// old bell did) and the notify_* switches of user_settings (interaction is off only when all three old switches were).
func importLegacyNotifications(ctx context.Context, db *pgxpool.Pool, old *pgx.Conn) error {
	var done bool
	if err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM legacy_imports WHERE part = 'notifications')`).Scan(&done); err != nil || done {
		if done {
			logInfo(ctx, "import-legacy: notifications already imported")
		}
		return err
	}
	rows, err := old.Query(ctx, `
		SELECT n.id::text, n.user_id::text, n.type::text, COALESCE(n.reference_type, ''), n.title, n.message,
		  CASE n.reference_type
		    WHEN 'draft' THEN '/ws/de-xuat/' || n.reference_id WHEN 'draft_edit' THEN '/dang-chuong?draft=' || n.reference_id
		    WHEN 'ws_story' THEN '/ws/truyen/' || s.slug WHEN 'chapter' THEN '/truyen/' || s.slug || '/' || c.slug
		    WHEN 'story' THEN '/truyen/' || s.slug WHEN 'post' THEN '/fandom/' || p.slug WHEN 'group' THEN '/nhom-dich/' || g.slug END,
		  s.cover_image_url, n.sender_id::text, COALESCE(u.display_name, u.username, ''),
		  COALESCE(n.read_at, CASE WHEN n.is_read THEN n.created_at END), n.created_at, COALESCE(n.dedupe_key, '')
		FROM notifications n
		LEFT JOIN chapters c ON n.reference_type = 'chapter' AND c.id = n.reference_id
		LEFT JOIN stories s ON s.id = COALESCE(c.story_id, CASE WHEN n.reference_type IN ('story', 'ws_story') THEN n.reference_id END)
		LEFT JOIN posts p ON n.reference_type = 'post' AND p.id = n.reference_id
		LEFT JOIN translation_groups g ON n.reference_type = 'group' AND g.id = n.reference_id
		LEFT JOIN users u ON u.id = n.sender_id
		ORDER BY n.created_at`)
	if err != nil {
		return err
	}
	type legacyNote struct {
		ID, User, Type, Ref, Title string
		Message, Link, Image       *string
		Sender                     *string
		SenderName                 string
		ReadAt                     *time.Time
		CreatedAt                  time.Time
		Dedupe                     string
	}
	notes, err := pgx.CollectRows(rows, pgx.RowToStructByPos[legacyNote])
	if err != nil {
		return err
	}
	rows, err = old.Query(ctx, `SELECT user_id::text, COALESCE(notify_chapter_update, true), COALESCE(notify_group_events, true),
		COALESCE(notify_comments, true) OR COALESCE(notify_post_comments, true) OR COALESCE(notify_post_reactions, true)
		FROM user_settings`)
	if err != nil {
		return err
	}
	type legacySetting struct {
		User                     string
		Read, Group, Interaction bool
	}
	settings, err := pgx.CollectRows(rows, pgx.RowToStructByPos[legacySetting])
	if err != nil {
		return err
	}
	var addedNotes, addedOff int64
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		for _, n := range notes {
			actors := "[]"
			if n.Sender != nil {
				a, _ := json.Marshal([]actor{{ID: *n.Sender, Name: n.SenderName}})
				actors = string(a)
			}
			tag, err := tx.Exec(ctx, `INSERT INTO notifications (id, user_id, type, category, title, message, link, image, actors, actor_count,
				seen_at, read_at, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, jsonb_array_length($9::jsonb), $10, $10, $11, $11) ON CONFLICT (id) DO NOTHING`,
				n.ID, n.User, n.Type, legacyCategory(n.Type, n.Ref), n.Title, n.Message, n.Link, n.Image, actors, n.ReadAt, n.CreatedAt)
			if err != nil {
				return err
			}
			addedNotes += tag.RowsAffected()
			if n.Dedupe != "" {
				if _, err := tx.Exec(ctx, `INSERT INTO notification_dedupe (key, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`, n.Dedupe, n.CreatedAt); err != nil {
					return err
				}
			}
		}
		for _, st := range settings {
			for cat, on := range map[string]bool{"read": st.Read, "group": st.Group, "interaction": st.Interaction} {
				if on {
					continue
				}
				// never overwrite what the person set in the new settings
				tag, err := tx.Exec(ctx, `INSERT INTO notification_settings (user_id, category, web) VALUES ($1, $2, false) ON CONFLICT DO NOTHING`, st.User, cat)
				if err != nil {
					return err
				}
				addedOff += tag.RowsAffected()
			}
		}
		_, err := tx.Exec(ctx, `INSERT INTO legacy_imports (part) VALUES ('notifications')`)
		return err
	})
	if err != nil {
		return err
	}
	logInfo(ctx, fmt.Sprintf("import-legacy: %d/%d notifications, %d switched-off categories added", addedNotes, len(notes), addedOff))
	return nil
}
