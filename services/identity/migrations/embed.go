// Package migrations carries the SQL files inside the binary (applied by platform/db.Migrate).
package migrations

import "embed"

// FS holds every *.sql file of this directory.
//
//go:embed *.sql
var FS embed.FS
