package admin

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nmv/identity/internal/sessions"
)

// Same rules as the backend's moderationRights:
//   - nobody acts on themselves or on an admin;
//   - admins act on everyone else, mods only on regular users (not on other mods);
//   - admins and mods may make a regular user a mod; only admins take the mod role away.
//
// target is the account an action is aimed at.
type target struct {
	ID       string
	Username string
	Roles    []string
	Banned   bool
	Deleted  bool
}

func (t target) Has(role string) bool {
	for _, r := range t.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// rights is what an actor may do to a target.
type rights struct{ Ban, Unban, Delete, GrantMod, RevokeMod bool }

// moderationRights decides what actor may do to t.
func moderationRights(actor sessions.Caller, t target) rights {
	actorAdmin, actorMod := actor.Has("admin"), actor.Has("mod")
	self := actor.ID == t.ID
	outranks := !self && !t.Has("admin") && (actorAdmin || (actorMod && !t.Has("mod")))
	alive := !t.Deleted
	return rights{
		Ban:       alive && outranks && !t.Banned,
		Unban:     alive && outranks && t.Banned,
		Delete:    alive && outranks,
		GrantMod:  alive && !self && !t.Banned && !t.Has("admin") && !t.Has("mod") && (actorAdmin || actorMod),
		RevokeMod: alive && !self && actorAdmin && t.Has("mod"),
	}
}

func loadTarget(ctx context.Context, q pgx.Tx, id string) (target, error) {
	t := target{ID: id}
	err := q.QueryRow(ctx, `SELECT username::text, is_banned, deleted_at IS NOT NULL,
		COALESCE((SELECT array_agg(role ORDER BY role) FROM user_roles WHERE user_id = users.id), '{}')
		FROM users WHERE id = $1 FOR UPDATE`, id).Scan(&t.Username, &t.Banned, &t.Deleted, &t.Roles)
	return t, err
}
