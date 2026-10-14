package tokens

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Keys are the per-receiver signing keys: neither service can forge a header for another.
type Keys struct {
	Backend   []byte // USER_SIG_KEY_CATALOG
	Workspace []byte // USER_SIG_KEY_WORKSPACE
	Media     []byte // USER_SIG_KEY_MEDIA
	Msg       []byte // USER_SIG_KEY_MESSAGING
	Community []byte // USER_SIG_KEY_COMMUNITY
	Library   []byte // USER_SIG_KEY_LIBRARY
	Rec       []byte // USER_SIG_KEY_RECOMMENDER
}

// Signer puts the signed identity headers on a request or response.
type Signer struct {
	keys Keys
	now  func() time.Time
}

// NewSigner makes a signer with the given keys and clock.
func NewSigner(keys Keys, now func() time.Time) *Signer { return &Signer{keys: keys, now: now} }

// Backend returns the key signed for the backend (tests check it).
func (s *Signer) Backend() []byte { return s.keys.Backend }

// SignHeaders sets X-User-Id, -Roles, -Exp and one signature per receiving service.
func (s *Signer) SignHeaders(h http.Header, uid, roles string) {
	exp := s.now().Add(HeaderTTL).Unix()
	h.Set("X-User-Id", uid)
	h.Set("X-User-Roles", roles)
	h.Set("X-User-Exp", strconv.FormatInt(exp, 10))
	h.Set("X-User-Sig", SignUserHeaders(s.keys.Backend, uid, roles, exp))
	h.Set("X-User-Sig-Ws", SignUserHeaders(s.keys.Workspace, uid, roles, exp)) // the gateway sends it to the workspace as X-User-Sig
	h.Set("X-User-Sig-Media", SignUserHeaders(s.keys.Media, uid, roles, exp))
	h.Set("X-User-Sig-Msg", SignUserHeaders(s.keys.Msg, uid, roles, exp))
	h.Set("X-User-Sig-Community", SignUserHeaders(s.keys.Community, uid, roles, exp))
	h.Set("X-User-Sig-Library", SignUserHeaders(s.keys.Library, uid, roles, exp))
	h.Set("X-User-Sig-Rec", SignUserHeaders(s.keys.Rec, uid, roles, exp))
}

// InternalAuth: service-to-service calls carry X-Internal-Auth "<exp>.<hmac(key, 'internal|'+exp)>", key = the
// receiver's INTERNAL_KEY_*.
func InternalAuth(key []byte, now time.Time) string {
	exp := strconv.FormatInt(now.Add(HeaderTTL).Unix(), 10)
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + exp))
	return exp + "." + hex.EncodeToString(m.Sum(nil))
}

// InternalAuthOK checks an X-Internal-Auth value.
func InternalAuthOK(key []byte, v string, now time.Time) bool {
	exp, sig, found := strings.Cut(v, ".")
	n, err := strconv.ParseInt(exp, 10, 64)
	if !found || err != nil || now.Unix() > n {
		return false
	}
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + exp))
	return hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(sig))
}
