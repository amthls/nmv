package auth

import (
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// argon2id with OWASP's minimum (19 MiB, 2 passes, 1 lane). Old bcrypt hashes from the Node backend still
// verify; login replaces them with argon2id (needsRehash).
const (
	argonMemory  = 19 * 1024
	argonTime    = 2
	argonThreads = 1
	argonKeyLen  = 32
)

// HashPassword hashes with argon2id.
func HashPassword(pw string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	key := argon2.IDKey([]byte(pw), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads, b64.EncodeToString(salt), b64.EncodeToString(key))
}

// CheckPassword compares in constant time. '!' (deleted accounts) and unknown formats never match.
// CheckPassword compares in constant time.
func CheckPassword(pw, hash string) bool {
	switch {
	case strings.HasPrefix(hash, "$argon2id$"):
		var v, m, t int
		var p uint8
		parts := strings.Split(hash, "$") // "", argon2id, v=19, m=..,t=..,p=.., salt, key
		if len(parts) != 6 {
			return false
		}
		if _, err := fmt.Sscanf(parts[2], "v=%d", &v); err != nil || v != argon2.Version {
			return false
		}
		if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
			return false
		}
		salt, err1 := base64.RawStdEncoding.DecodeString(parts[4])
		key, err2 := base64.RawStdEncoding.DecodeString(parts[5])
		if err1 != nil || err2 != nil {
			return false
		}
		got := argon2.IDKey([]byte(pw), salt, uint32(t), uint32(m), p, uint32(len(key)))
		return subtle.ConstantTimeCompare(got, key) == 1
	case strings.HasPrefix(hash, "$2"):
		return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
	}
	return false
}

// NeedsRehash: a hash that is not argon2id with the current parameters.
func NeedsRehash(hash string) bool {
	return !strings.HasPrefix(hash, fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$", argon2.Version, argonMemory, argonTime, argonThreads))
}

// A real hash to compare against when the account doesn't exist, so "no such user" takes as long as "wrong password".
var dummyHash = HashPassword("timing-equaliser")

//go:embed commonpasswords.txt
var commonList string

var commonPasswords = func() map[string]bool {
	m := map[string]bool{}
	for _, l := range strings.Split(commonList, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			m[l] = true
		}
	}
	return m
}()

// PasswordProblem returns a message for the user, or "" when a NEW password is acceptable.
func PasswordProblem(pw, username, email string) string {
	n := utf8.RuneCountInString(pw)
	low := strings.ToLower(pw)
	switch {
	case n < 8:
		return "Mật khẩu phải có ít nhất 8 ký tự."
	case n > 128:
		return "Mật khẩu tối đa 128 ký tự."
	case strings.TrimSpace(pw) == "":
		return "Mật khẩu không được chỉ gồm khoảng trắng."
	case commonPasswords[low]:
		return "Mật khẩu này quá phổ biến, dễ bị đoán. Hãy chọn mật khẩu khác."
	case username != "" && strings.Contains(low, strings.ToLower(username)):
		return "Mật khẩu không được chứa tên đăng nhập."
	case email != "" && strings.Contains(low, strings.ToLower(strings.SplitN(email, "@", 2)[0])) && len(strings.SplitN(email, "@", 2)[0]) >= 4:
		return "Mật khẩu không được chứa phần đầu email."
	}
	return ""
}
