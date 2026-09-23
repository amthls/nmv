package main

import (
	"sort"
	"sync"
)

// RawDoc is the story document shape sent by the backend (see
// backend/src/services/search.service.ts toDoc()).
type RawDoc struct {
	Title          string   `json:"title"`
	OriginalTitle  string   `json:"original_title"`
	AuthorName     string   `json:"author_name"`
	ArtistName     string   `json:"artist_name"`
	Synopsis       string   `json:"synopsis"`
	ApprovalStatus string   `json:"approval_status"`
	GroupName      string   `json:"group_name"`
	Tags           []string `json:"tags"`
}

// doc is a RawDoc plus its precomputed analyzed fields, so search requests
// don't retokenize every document on every query.
type doc struct {
	ID    string
	Raw   RawDoc
	Field map[string][]string    // field name -> analyzed tokens
	Grams map[string]struct{} // title.prefix edge-ngrams
}

func newDoc(id string, raw RawDoc) *doc {
	titleTokens := analyze(raw.Title)
	d := &doc{
		ID:  id,
		Raw: raw,
		Field: map[string][]string{
			"title":          titleTokens,
			"original_title": analyze(raw.OriginalTitle),
			"author_name":    analyze(raw.AuthorName),
			"artist_name":    analyze(raw.ArtistName),
			"synopsis":       analyze(raw.Synopsis),
			"group_name":     analyze(raw.GroupName),
			"tags":           analyze(joinStrings(raw.Tags)),
		},
		Grams: edgeGrams(titleTokens),
	}
	return d
}

func joinStrings(ss []string) string {
	out := ""
	for i, s := range ss {
		if i > 0 {
			out += " "
		}
		out += s
	}
	return out
}

type index struct {
	mu   sync.RWMutex
	Docs map[string]*doc
}

func newIndexData() *index {
	return &index{Docs: make(map[string]*doc)}
}

func (ix *index) upsert(id string, raw RawDoc) {
	d := newDoc(id, raw)
	ix.mu.Lock()
	ix.Docs[id] = d
	ix.mu.Unlock()
}

func (ix *index) remove(id string) bool {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	if _, ok := ix.Docs[id]; !ok {
		return false
	}
	delete(ix.Docs, id)
	return true
}

// fieldScore scores one field's tokens against the query tokens under an
// implicit AND operator: every query token must match (exactly, or within
// fuzzyMaxEdits when fuzzy is true) at least one field token, otherwise the
// field contributes nothing. The score rewards repeated/multiple matches,
// loosely standing in for Elasticsearch's BM25 term frequency component.
func fieldScore(queryTokens, fieldTokens []string, fuzzy bool) float64 {
	if len(queryTokens) == 0 || len(fieldTokens) == 0 {
		return 0
	}
	freq := make(map[string]int, len(fieldTokens))
	for _, t := range fieldTokens {
		freq[t]++
	}
	total := 0.0
	for _, q := range queryTokens {
		if cnt, ok := freq[q]; ok {
			total += float64(cnt)
			continue
		}
		if !fuzzy {
			return 0
		}
		maxEdits := fuzzyMaxEdits(len([]rune(q)))
		matched := false
		for ft, cnt := range freq {
			if levenshtein(q, ft) <= maxEdits {
				total += float64(cnt)
				matched = true
				break
			}
		}
		if !matched {
			return 0
		}
	}
	return total
}

type fieldBoost struct {
	Name  string
	Boost float64
}

// multiMatchScore mirrors multi_match type:"best_fields": the clause's score
// is the *best* single field's score (not the sum across fields), scaled by
// that field's boost.
func multiMatchScore(queryTokens []string, d *doc, fields []fieldBoost, fuzzy bool) float64 {
	best := 0.0
	for _, fb := range fields {
		s := fieldScore(queryTokens, d.Field[fb.Name], fuzzy)
		if s <= 0 {
			continue
		}
		s *= fb.Boost
		if s > best {
			best = s
		}
	}
	return best
}

// prefixMatchScore mirrors `match: {"title.prefix": {query, operator: and}}`.
func prefixMatchScore(queryTokens []string, d *doc, boost float64) float64 {
	if len(queryTokens) == 0 {
		return 0
	}
	for _, q := range queryTokens {
		if _, ok := d.Grams[q]; !ok {
			return 0
		}
	}
	return boost * float64(len(queryTokens))
}

type hit struct {
	ID    string
	Score float64
}

func (ix *index) search(clauses []clause, size int) []hit {
	ix.mu.RLock()
	defer ix.mu.RUnlock()

	hits := make([]hit, 0, len(ix.Docs))
	for _, d := range ix.Docs {
		total := 0.0
		for _, c := range clauses {
			total += c.score(d)
		}
		if total > 0 {
			hits = append(hits, hit{ID: d.ID, Score: total})
		}
	}
	sort.Slice(hits, func(i, j int) bool {
		if hits[i].Score != hits[j].Score {
			return hits[i].Score > hits[j].Score
		}
		return hits[i].ID < hits[j].ID
	})
	if size > 0 && len(hits) > size {
		hits = hits[:size]
	}
	return hits
}

// clause is one entry of the top-level bool/should array.
type clause struct {
	queryTokens []string
	fields      []fieldBoost // for multi_match
	fuzzy       bool
	prefix      bool // title.prefix match clause
	prefixBoost float64
}

func (c clause) score(d *doc) float64 {
	if c.prefix {
		return prefixMatchScore(c.queryTokens, d, c.prefixBoost)
	}
	return multiMatchScore(c.queryTokens, d, c.fields, c.fuzzy)
}

// snapshot / restore ---------------------------------------------------

type snapshotDoc struct {
	ID  string `json:"id"`
	Raw RawDoc `json:"doc"`
}

func (ix *index) snapshot() []snapshotDoc {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	out := make([]snapshotDoc, 0, len(ix.Docs))
	for id, d := range ix.Docs {
		out = append(out, snapshotDoc{ID: id, Raw: d.Raw})
	}
	return out
}

func (ix *index) restore(docs []snapshotDoc) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	for _, sd := range docs {
		ix.Docs[sd.ID] = newDoc(sd.ID, sd.Raw)
	}
}
