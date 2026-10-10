package main

import (
	"fmt"
	"os"
	"strings"
)

type config struct {
	Port            string
	DatabaseURL     string // identity_db, as role identity
	RedisURL        string
	RabbitURL       string
	JWTSecret       []byte // signs nh_access
	SigKeyBackend   []byte // signs X-User-* for the backend (USER_SIG_KEY_BACKEND, the backend has it too)
	SigKeyWorkspace []byte // signs them again for the workspace (USER_SIG_KEY_WORKSPACE): neither can forge for the other
	InternalKey     []byte // verifies X-Internal-Auth of calls to identity (INTERNAL_KEY_IDENTITY)
	BackendURL      string // internal calls (account delete pre-check)
	SMTPURL         string
	MailFrom        string
	SiteURL         string
	CookieSecure    bool
	EnableDemoUsers bool
	TurnstileSecret string // optional: register and forgot-password then need a Cloudflare Turnstile token
}

func loadConfig() (config, error) {
	c := config{
		Port:            env("PORT", "8080"),
		DatabaseURL:     os.Getenv("IDENTITY_DATABASE_URL"),
		RedisURL:        os.Getenv("REDIS_URL"),
		RabbitURL:       os.Getenv("RABBITMQ_URL"),
		JWTSecret:       []byte(os.Getenv("IDENTITY_JWT_SECRET")),
		SigKeyBackend:   []byte(os.Getenv("USER_SIG_KEY_BACKEND")),
		SigKeyWorkspace: []byte(os.Getenv("USER_SIG_KEY_WORKSPACE")),
		InternalKey:     []byte(os.Getenv("INTERNAL_KEY_IDENTITY")),
		BackendURL:      env("BACKEND_INTERNAL_URL", "http://backend:5000"),
		SMTPURL:         os.Getenv("SMTP_URL"),
		MailFrom:        env("MAIL_FROM", "NovelHub <no-reply@novelhub.local>"),
		SiteURL:         strings.TrimRight(env("SITE_URL", "http://localhost:3000"), "/"),
		CookieSecure:    os.Getenv("COOKIE_SECURE") == "true",
		EnableDemoUsers: os.Getenv("ENABLE_DEMO_ACCOUNTS") == "true",
		TurnstileSecret: os.Getenv("TURNSTILE_SECRET"),
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("IDENTITY_DATABASE_URL is required")
	}
	for k, v := range map[string][]byte{"IDENTITY_JWT_SECRET": c.JWTSecret, "USER_SIG_KEY_BACKEND": c.SigKeyBackend,
		"USER_SIG_KEY_WORKSPACE": c.SigKeyWorkspace, "INTERNAL_KEY_IDENTITY": c.InternalKey} {
		if len(v) < 32 {
			return c, fmt.Errorf("%s must be at least 32 characters", k)
		}
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
