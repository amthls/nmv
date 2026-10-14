// Package config reads the environment once at start.
package config

import (
	"errors"
	"os"
	"strings"
)

// Config is everything workspace needs from the environment.
type Config struct {
	Port        string
	DatabaseURL string
	RabbitURL   string
	SigKey      []byte // USER_SIG_KEY_WORKSPACE: verifies the gateway's X-User-* headers (identity signs them for us alone)
	InternalKey []byte // INTERNAL_KEY_WORKSPACE: verifies X-Internal-Auth of calls to us
	BackendKey  []byte // INTERNAL_KEY_CATALOG: signs our calls to the backend
	BackendURL  string
}

// Load reads the environment; the error says which settings are missing.
func Load() (Config, error) {
	c := Config{
		Port:        Env("PORT", "8080"),
		DatabaseURL: os.Getenv("WORKSPACE_DATABASE_URL"),
		RabbitURL:   os.Getenv("RABBITMQ_URL"),
		SigKey:      []byte(os.Getenv("USER_SIG_KEY_WORKSPACE")),
		InternalKey: []byte(os.Getenv("INTERNAL_KEY_WORKSPACE")),
		BackendKey:  []byte(os.Getenv("INTERNAL_KEY_CATALOG")),
		BackendURL:  strings.TrimRight(Env("CATALOG_INTERNAL_URL", "http://catalog:5000"), "/"),
	}
	if c.DatabaseURL == "" || len(c.SigKey) < 32 || len(c.InternalKey) < 32 || len(c.BackendKey) < 32 {
		return c, errors.New("WORKSPACE_DATABASE_URL, USER_SIG_KEY_WORKSPACE, INTERNAL_KEY_WORKSPACE and INTERNAL_KEY_CATALOG (>= 32 chars) are required")
	}
	return c, nil
}

// Env is os.Getenv with a default.
func Env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
