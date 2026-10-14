// Package blocks is the content of a chapter: paragraphs stored once by hash, compared with an LCS diff, merged with diff3.
package blocks

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Blocks arrive from the backend already validated and sanitized (Plan/chapter-workspace.md: one HTML filter,
// in the backend). Their "id" is only a position (b1, b2, ...) and is reassigned on every save, so it is not
// part of the hash: the same paragraph anywhere in any version has one hash.

type Block = map[string]any

// Canonical: the block without its positional id, and without an "html" that only wraps its own text in
// <p>…</p>. Imported chapters store a plain paragraph as {text}; the editor sends the same paragraph back as
// {html: "<p>text</p>", text}. Both must hash the same or every paragraph looks changed to diff3 after one save.
func Canonical(b Block) Block {
	c := make(Block, len(b))
	for k, v := range b {
		if k != "id" {
			c[k] = v
		}
	}
	h, _ := c["html"].(string)
	t, _ := c["text"].(string)
	if inner, found := strings.CutPrefix(h, "<p>"); found && strings.HasSuffix(inner, "</p>") && c["type"] == "paragraph" {
		inner = strings.TrimSuffix(inner, "</p>")
		if !strings.Contains(inner, "<") && html.UnescapeString(inner) == t {
			delete(c, "html")
		}
	}
	return c
}

// Hash: sha256 of the canonical JSON (encoding/json sorts map keys).
func Hash(b Block) (string, []byte, error) {
	data, err := json.Marshal(Canonical(b))
	if err != nil {
		return "", nil, err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), data, nil
}

// Store writes the blocks not stored yet and returns their hashes in order.
func Store(ctx context.Context, tx pgx.Tx, blocks []Block) ([]string, error) {
	if len(blocks) > 5000 {
		return nil, fmt.Errorf("too many blocks")
	}
	hashes := make([]string, len(blocks))
	batch := &pgx.Batch{}
	for i, b := range blocks {
		h, data, err := Hash(b)
		if err != nil {
			return nil, err
		}
		hashes[i] = h
		batch.Queue(`INSERT INTO content_blocks (hash, data) VALUES ($1, $2) ON CONFLICT DO NOTHING`, h, data)
	}
	if len(blocks) > 0 {
		if err := tx.SendBatch(ctx, batch).Close(); err != nil {
			return nil, err
		}
	}
	return hashes, nil
}

// Load returns the blocks for the hashes in order, with positional ids b1, b2, ... like the editor expects.
func Load(ctx context.Context, q pgx.Tx, hashes []string) ([]Block, error) {
	if len(hashes) == 0 {
		return []Block{}, nil
	}
	data, err := Data(ctx, q, hashes)
	if err != nil {
		return nil, err
	}
	out := make([]Block, len(hashes))
	for i, h := range hashes {
		b := Block{}
		if err := json.Unmarshal(data[h], &b); err != nil {
			return nil, fmt.Errorf("block %s: %w", h, err)
		}
		b["id"] = fmt.Sprintf("b%d", i+1)
		out[i] = b
	}
	return out, nil
}

func Data(ctx context.Context, q pgx.Tx, hashes []string) (map[string][]byte, error) {
	rows, err := q.Query(ctx, `SELECT hash, data::text FROM content_blocks WHERE hash = ANY($1)`, hashes)
	if err != nil {
		return nil, err
	}
	data := map[string][]byte{}
	for rows.Next() {
		var h, d string
		if err := rows.Scan(&h, &d); err != nil {
			return nil, err
		}
		data[h] = []byte(d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, h := range hashes {
		if data[h] == nil {
			return nil, fmt.Errorf("missing block %s", h)
		}
	}
	return data, nil
}

// DiffOp is one step of turning version A into version B.
type DiffOp struct {
	Op   string `json:"op"` // same | del | ins
	Hash string `json:"hash"`
}

// Diff: longest common subsequence over two hash arrays (O(n*m); chapters are ~70 blocks, at most a few
// thousand). A changed paragraph shows as del + ins; the browser pairs them and diffs the words.
func Diff(a, b []string) []DiffOp {
	n, m := len(a), len(b)
	lcs := make([][]int, n+1)
	for i := range lcs {
		lcs[i] = make([]int, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if a[i] == b[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			} else {
				lcs[i][j] = max(lcs[i+1][j], lcs[i][j+1])
			}
		}
	}
	ops := make([]DiffOp, 0, max(n, m))
	i, j := 0, 0
	for i < n && j < m {
		switch {
		case a[i] == b[j]:
			ops = append(ops, DiffOp{"same", a[i]})
			i, j = i+1, j+1
		case lcs[i+1][j] >= lcs[i][j+1]:
			ops = append(ops, DiffOp{"del", a[i]})
			i++
		default:
			ops = append(ops, DiffOp{"ins", b[j]})
			j++
		}
	}
	for ; i < n; i++ {
		ops = append(ops, DiffOp{"del", a[i]})
	}
	for ; j < m; j++ {
		ops = append(ops, DiffOp{"ins", b[j]})
	}
	return ops
}
