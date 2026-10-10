package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sample accounts of sql/database.sql (same UUIDs, the backend copy is seeded there). Password: password123.
var demoAccounts = []struct{ id, username, email, name, roles string }{
	{"a0000000-0000-0000-0000-000000000001", "admin", "admin@novelhub.vn", "Administrator", "admin,reader:hidden"},
	{"a0000000-0000-0000-0000-000000000002", "mod_sakura", "sakura@novelhub.vn", "Sakura ✿", "mod,reader"},
	{"a0000000-0000-0000-0000-000000000003", "mod_kaito", "kaito@novelhub.vn", "Kaito", "mod,reader"},
	{"a0000000-0000-0000-0000-000000000004", "neko_trans", "neko@novelhub.vn", "Neko Translation", "translator,reader"},
	{"a0000000-0000-0000-0000-000000000005", "tanuki_san", "tanuki@novelhub.vn", "Tanuki-san", "translator,reader"},
	{"a0000000-0000-0000-0000-000000000006", "author_minh", "minh@novelhub.vn", "Minh Phương", "author,reader"},
	{"a0000000-0000-0000-0000-000000000007", "kitsune_group", "kitsune@novelhub.vn", "Kitsune Group", "translator,reader"},
	{"a0000000-0000-0000-0000-000000000008", "usagi_editor", "usagi@novelhub.vn", "Usagi Editor", "translator,reader"},
	{"a0000000-0000-0000-0000-000000000009", "reader_hana", "hana@novelhub.vn", "Hana 🌸", "reader"},
	{"a0000000-0000-0000-0000-000000000010", "reader_ryu", "ryu@novelhub.vn", "Ryū Dragon", "reader"},
	{"a0000000-0000-0000-0000-000000000011", "reader_yuki", "yuki@novelhub.vn", "Yuki ❄️", "reader"},
	{"a0000000-0000-0000-0000-000000000012", "reader_sora", "sora@novelhub.vn", "Sora ☁️", "reader"},
}

// seedDemo creates the sample accounts, but only into an empty identity_db (a fresh install): a running site never
// gets them back after they were deleted or renamed.
func seedDemo(ctx context.Context, db *pgxpool.Pool) error {
	var n int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		logInfo(ctx, fmt.Sprintf("seed-demo: %d accounts already, nothing added", n))
		return nil
	}
	hash := hashPassword("password123")
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		for _, a := range demoAccounts {
			if _, err := tx.Exec(ctx, `INSERT INTO users (id, username, email, password_hash, display_name, email_verified)
				VALUES ($1, $2, $3, $4, $5, TRUE)`, a.id, a.username, a.email, hash, a.name); err != nil {
				return fmt.Errorf("user %s: %w", a.username, err)
			}
			for _, r := range strings.Split(a.roles, ",") {
				role, hidden := strings.CutSuffix(r, ":hidden")
				if _, err := tx.Exec(ctx, `INSERT INTO user_roles (user_id, role, is_visible) VALUES ($1, $2, $3)`, a.id, role, !hidden); err != nil {
					return err
				}
			}
			if err := userEvent(ctx, tx, a.id, "created", nil); err != nil { // the backend copy (seeded too) learns the version
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	logInfo(ctx, fmt.Sprintf("seed-demo: %d sample accounts added", len(demoAccounts)))
	return nil
}
