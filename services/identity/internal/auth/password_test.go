package auth

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestPasswordHashing(t *testing.T) {
	h := HashPassword("correct horse battery")
	if !strings.HasPrefix(h, "$argon2id$") || !CheckPassword("correct horse battery", h) || CheckPassword("wrong", h) {
		t.Fatal("argon2id round trip")
	}
	if NeedsRehash(h) {
		t.Fatal("fresh argon2id hash should not need a rehash")
	}
	legacy, _ := bcrypt.GenerateFromPassword([]byte("password123"), 10)
	if !CheckPassword("password123", string(legacy)) || !NeedsRehash(string(legacy)) {
		t.Fatal("legacy bcrypt must verify and be flagged for rehash")
	}
	for _, bad := range []string{"!", "", "$argon2id$garbage", "plain"} {
		if CheckPassword("!", bad) || CheckPassword("", bad) {
			t.Fatalf("hash %q must never match", bad)
		}
	}
}

func TestPasswordProblem(t *testing.T) {
	cases := map[string]bool{ // password -> acceptable (user "yuki", email yuki.chan@mail.vn)
		"short":                  false,
		"password123":            false, // common
		"PASSWORD123":            false, // common, case-insensitive
		"myname-yuki-2026":       false, // contains username
		"yuki.chan.reads.books":  false, // contains the email's local part
		"        ":               false,
		"Tôi đọc truyện mỗi tối": true,
		"x7#Lp2!qRs":             true,
	}
	for pw, want := range cases {
		if got := PasswordProblem(pw, "yuki", "yuki.chan@mail.vn") == ""; got != want {
			t.Errorf("%q: acceptable=%v, want %v", pw, got, want)
		}
	}
}
