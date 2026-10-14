package logger

import (
	"strings"
	"testing"
)

func TestRedact(t *testing.T) {
	out := redact(`login a.b@mail.vn Bearer abc password=hunter2 postgres://identity:s3cret@postgres/x eyJa.eyJb.c`)
	for _, leak := range []string{"a.b@mail.vn", "abc", "hunter2", "s3cret", "eyJa"} {
		if strings.Contains(out, leak) {
			t.Errorf("leaked %q: %s", leak, out)
		}
	}
}
