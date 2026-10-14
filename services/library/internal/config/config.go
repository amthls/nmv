// Package config reads the service settings from the environment.
package config

import (
	"os"
	"strings"
)

// Config is everything library reads from environment variables.
type Config struct {
	Port        string
	SigKey      []byte // USER_SIG_KEY_LIBRARY: identity signs the gateway's X-User-* for us alone
	InternalKey []byte // INTERNAL_KEY_LIBRARY: other services' calls to /internal
	BackendKey  []byte // INTERNAL_KEY_CATALOG: our calls to the backend
	BackendURL  string
	DatabaseURL string
	RabbitURL   string // identity.user.deleted
	LegacyURL   string // novel_platform, only for `library import-legacy`
}

// Env returns the variable k, or def when it is empty.
func Env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// Load reads the environment.
func Load() Config {
	return Config{
		Port:        Env("PORT", "8080"),
		SigKey:      []byte(os.Getenv("USER_SIG_KEY_LIBRARY")),
		InternalKey: []byte(os.Getenv("INTERNAL_KEY_LIBRARY")),
		BackendKey:  []byte(os.Getenv("INTERNAL_KEY_CATALOG")),
		BackendURL:  strings.TrimRight(Env("CATALOG_INTERNAL_URL", "http://catalog:5000"), "/"),
		DatabaseURL: os.Getenv("LIBRARY_DATABASE_URL"),
		RabbitURL:   os.Getenv("RABBITMQ_URL"),
		LegacyURL:   os.Getenv("LEGACY_DATABASE_URL"),
	}
}

// Valid reports whether the required keys and database URL are set.
func (c Config) Valid() bool {
	return len(c.SigKey) >= 32 && len(c.InternalKey) >= 32 && len(c.BackendKey) >= 32 && c.DatabaseURL != ""
}
