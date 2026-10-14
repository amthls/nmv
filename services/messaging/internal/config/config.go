// Package config reads the service settings from the environment.
package config

import (
	"os"
	"strings"
)

// Config is everything messaging reads from environment variables.
type Config struct {
	Port        string
	SigKey      []byte // USER_SIG_KEY_MESSAGING: identity signs the gateway's X-User-* for us alone
	InternalKey []byte // INTERNAL_KEY_MESSAGING: verifies the backend's calls to /internal
	BackendKey  []byte // INTERNAL_KEY_CATALOG: signs our calls to the backend
	BackendURL  string
	LibraryKey  []byte // INTERNAL_KEY_LIBRARY: our calls to the library (who follows a story)
	LibraryURL  string
	RedisURL    string
	DatabaseURL string
	RabbitURL   string // jobs on novel.notifications (empty: only /internal/notifications/jobs)
	LegacyURL   string // novel_platform, only for `messaging import-legacy`
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
		SigKey:      []byte(os.Getenv("USER_SIG_KEY_MESSAGING")),
		InternalKey: []byte(os.Getenv("INTERNAL_KEY_MESSAGING")),
		BackendKey:  []byte(os.Getenv("INTERNAL_KEY_CATALOG")),
		BackendURL:  strings.TrimRight(Env("CATALOG_INTERNAL_URL", "http://catalog:5000"), "/"),
		LibraryKey:  []byte(os.Getenv("INTERNAL_KEY_LIBRARY")),
		LibraryURL:  strings.TrimRight(Env("LIBRARY_INTERNAL_URL", "http://library:8080"), "/"),
		RedisURL:    os.Getenv("REDIS_URL"),
		DatabaseURL: os.Getenv("MESSAGING_DATABASE_URL"),
		RabbitURL:   os.Getenv("RABBITMQ_URL"),
		LegacyURL:   os.Getenv("LEGACY_DATABASE_URL"),
	}
}

// Valid reports whether the required keys and URLs are set.
func (c Config) Valid() bool {
	return len(c.SigKey) >= 32 && len(c.InternalKey) >= 32 && len(c.BackendKey) >= 32 && len(c.LibraryKey) >= 32 &&
		c.RedisURL != "" && c.DatabaseURL != ""
}
