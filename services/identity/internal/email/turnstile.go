package email

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"nmv/identity/internal/platform/httpx"
	"nmv/identity/internal/platform/logger"
)

// ---- Turnstile (Cloudflare bot check), optional ------------------------------------------------------------

// DefaultTurnstileURL is Cloudflare's verification endpoint.
const DefaultTurnstileURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// Turnstile checks the form token with Cloudflare when a secret is set.
type Turnstile struct {
	Secret string
	URL    string
}

// OK: with TURNSTILE_SECRET set, the form's turnstile_token must pass Cloudflare's check. Answers itself when not.
func (t *Turnstile) OK(w http.ResponseWriter, r *http.Request, token string) bool {
	if t.Secret == "" {
		return true
	}
	form := url.Values{"secret": {t.Secret}, "response": {token}, "remoteip": {httpx.ClientIP(r)}}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", t.URL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var out struct {
		Success bool `json:"success"`
	}
	res, err := http.DefaultClient.Do(req)
	if err == nil {
		defer res.Body.Close()
		err = json.NewDecoder(res.Body).Decode(&out)
	}
	if err != nil {
		logger.Logf(r.Context(), "warn", "turnstile check failed: "+err.Error())
		httpx.Fail(w, 503, "Không kiểm tra được chống bot, vui lòng thử lại sau ít phút.")
		return false
	}
	if !out.Success {
		httpx.Fail(w, 400, "Vui lòng xác nhận bạn không phải robot.")
		return false
	}
	return true
}
