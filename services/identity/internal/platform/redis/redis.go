// Package redis connects to the optional Redis cache (revocation and roles).
package redis

import (
	"fmt"

	goredis "github.com/redis/go-redis/v9"
)

// Connect returns a client for url, or nil when url is empty (everything then reads Postgres).
func Connect(url string) (*goredis.Client, error) {
	if url == "" {
		return nil, nil
	}
	opt, err := goredis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("REDIS_URL: %w", err)
	}
	return goredis.NewClient(opt), nil
}
