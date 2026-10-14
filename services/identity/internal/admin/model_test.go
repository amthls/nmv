package admin

import (
	"testing"

	"nmv/identity/internal/sessions"
)

func TestModerationRights(t *testing.T) {
	admin := sessions.Caller{ID: "a", Roles: []string{"admin"}}
	mod := sessions.Caller{ID: "m", Roles: []string{"mod"}}
	reader := target{ID: "r", Roles: []string{"reader"}}
	otherMod := target{ID: "m2", Roles: []string{"mod"}}
	otherAdmin := target{ID: "a2", Roles: []string{"admin"}}
	if r := moderationRights(mod, reader); !r.Ban || !r.Delete || !r.GrantMod || r.RevokeMod {
		t.Errorf("mod on reader: %+v", r)
	}
	if r := moderationRights(mod, otherMod); r.Ban || r.Delete || r.RevokeMod {
		t.Errorf("mod on mod: %+v", r)
	}
	if r := moderationRights(admin, otherMod); !r.Ban || !r.RevokeMod {
		t.Errorf("admin on mod: %+v", r)
	}
	if r := moderationRights(admin, otherAdmin); r.Ban || r.Delete {
		t.Errorf("admin on admin: %+v", r)
	}
	if r := moderationRights(admin, target{ID: "a", Roles: []string{"admin"}}); r.Ban || r.Delete || r.GrantMod {
		t.Errorf("self: %+v", r)
	}
	if r := moderationRights(admin, target{ID: "r", Roles: []string{"reader"}, Deleted: true}); r.Ban || r.Delete {
		t.Errorf("deleted: %+v", r)
	}
}
