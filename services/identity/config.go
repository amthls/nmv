package main

import (
	"fmt"
	"os"
	"strings"
)

type config struct {
	Port            string
	DatabaseURL     string // identity_db, as role identity
	LegacyURL       string // novel_platform, only for `identity import-legacy`
	RedisURL        string
	RabbitURL       string
	JWTSecret       []byte // signs nh_access
	HeaderKey       []byte // signs X-User-* for the backend (shared secret AUTH_HEADER_KEY)
	BackendURL      string // internal calls (account delete pre-check)
	SMTPURL         string
	MailFrom        string
	SiteURL         string
	CookieSecure    bool
	EnableDemoUsers bool
}

func loadConfig() (config, error) {
	c := config{
		Port:            env("PORT", "8080"),
		DatabaseURL:     os.Getenv("IDENTITY_DATABASE_URL"),
		LegacyURL:       os.Getenv("LEGACY_DATABASE_URL"),
		RedisURL:        os.Getenv("REDIS_URL"),
		RabbitURL:       os.Getenv("RABBITMQ_URL"),
		JWTSecret:       []byte(os.Getenv("IDENTITY_JWT_SECRET")),
		HeaderKey:       []byte(os.Getenv("AUTH_HEADER_KEY")),
		BackendURL:      env("BACKEND_INTERNAL_URL", "http://backend:5000"),
		SMTPURL:         os.Getenv("SMTP_URL"),
		MailFrom:        env("MAIL_FROM", "NovelHub <no-reply@novelhub.local>"),
		SiteURL:         strings.TrimRight(env("SITE_URL", "http://localhost:3000"), "/"),
		CookieSecure:    os.Getenv("COOKIE_SECURE") == "true",
		EnableDemoUsers: os.Getenv("ENABLE_DEMO_ACCOUNTS") == "true",
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("IDENTITY_DATABASE_URL is required")
	}
	if len(c.JWTSecret) < 32 || len(c.HeaderKey) < 32 {
		return c, fmt.Errorf("IDENTITY_JWT_SECRET and AUTH_HEADER_KEY must be at least 32 characters")
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
