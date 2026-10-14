// Package redis connects to Redis (realtime pushes between messaging copies and the other services).
package redis

import (
	"fmt"

	goredis "github.com/redis/go-redis/v9"
)

// Connect returns a client for url.
func Connect(url string) (*goredis.Client, error) {
	opt, err := goredis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("REDIS_URL: %w", err)
	}
	return goredis.NewClient(opt), nil
}
