// novelsearch is a small drop-in replacement for the Elasticsearch instance
// the backend used to query. It speaks the same narrow REST surface that
// backend/src/services/search.service.ts calls (index create/HEAD, bulk
// upsert, single doc upsert/delete, and a bool/should/multi_match search),
// so the Node.js code did not need to change - only SEARCH_URL now points
// here instead of at Elasticsearch.
package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

var st *store

func main() {
	port := envOr("PORT", "8091")
	snapshotPath := envOr("SNAPSHOT_PATH", "/data/snapshot.json")

	ensureDir(snapshotPath)
	st = newStore(snapshotPath)
	st.load()

	mux := http.NewServeMux()
	// Two path segments so this can never collide with the single-segment
	// "/{index}" wildcard routes below (ServeMux refuses to register
	// overlapping patterns, including the implicit HEAD it adds for GET).
	mux.HandleFunc("GET /_meta/health", handleHealth)
	// The global /_bulk form (no index segment) is what search.service.ts actually
	// calls - each NDJSON action line carries its own "_index". The /{index}/_bulk
	// form is also accepted for callers that prefer it.
	mux.HandleFunc("POST /_bulk", handleBulk)
	mux.HandleFunc("HEAD /{index}", handleHeadIndex)
	mux.HandleFunc("PUT /{index}", handlePutIndex)
	mux.HandleFunc("POST /{index}/_bulk", handleBulk)
	mux.HandleFunc("PUT /{index}/_doc/{id}", handlePutDoc)
	mux.HandleFunc("DELETE /{index}/_doc/{id}", handleDeleteDoc)
	mux.HandleFunc("POST /{index}/_search", handleSearch)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
	}
	log.Printf("novelsearch listening on :%s (snapshot: %s)", port, snapshotPath)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func handleHeadIndex(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("index")
	if _, ok := st.get(name); !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func handlePutIndex(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("index")
	// Body carries ES settings/mappings; this engine has a single fixed
	// analysis pipeline (see text.go), so the body's content is unused.
	io.Copy(io.Discard, r.Body)
	st.getOrCreate(name)
	st.save()
	writeJSON(w, http.StatusOK, map[string]bool{"acknowledged": true})
}

func handleBulk(w http.ResponseWriter, r *http.Request) {
	// Path index (if any) is only a default: each NDJSON action line carries
	// its own "_index", which is what the real bulk API - and this backend's
	// client - relies on.
	pathIndex := r.PathValue("index")

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	lines := strings.Split(strings.TrimRight(string(body), "\n"), "\n")
	count := 0
	for i := 0; i+1 < len(lines); i += 2 {
		actionLine := strings.TrimSpace(lines[i])
		docLine := lines[i+1]
		if actionLine == "" {
			continue
		}
		var action struct {
			Index *struct {
				ID   string `json:"_id"`
				Name string `json:"_index"`
			} `json:"index"`
		}
		if err := json.Unmarshal([]byte(actionLine), &action); err != nil || action.Index == nil || action.Index.ID == "" {
			continue
		}
		indexName := action.Index.Name
		if indexName == "" {
			indexName = pathIndex
		}
		if indexName == "" {
			continue
		}
		var raw RawDoc
		if err := json.Unmarshal([]byte(docLine), &raw); err != nil {
			continue
		}
		st.getOrCreate(indexName).upsert(action.Index.ID, raw)
		count++
	}
	st.save()
	writeJSON(w, http.StatusOK, map[string]interface{}{"errors": false, "items": []interface{}{}, "indexed": count})
}

func handlePutDoc(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("index")
	id := r.PathValue("id")
	ix := st.getOrCreate(name)

	var raw RawDoc
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	ix.upsert(id, raw)
	st.save()
	writeJSON(w, http.StatusOK, map[string]string{"result": "updated"})
}

func handleDeleteDoc(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("index")
	id := r.PathValue("id")
	ix, ok := st.get(name)
	if !ok || !ix.remove(id) {
		writeJSON(w, http.StatusNotFound, map[string]string{"result": "not_found"})
		return
	}
	st.save()
	writeJSON(w, http.StatusOK, map[string]string{"result": "deleted"})
}

// --- search query DSL (the narrow subset search.service.ts emits) ---

type searchRequestBody struct {
	Size  int `json:"size"`
	Query struct {
		Bool struct {
			Should []json.RawMessage `json:"should"`
		} `json:"bool"`
	} `json:"query"`
}

type multiMatchClauseBody struct {
	Query     string   `json:"query"`
	Operator  string   `json:"operator"`
	Fuzziness string   `json:"fuzziness"`
	Fields    []string `json:"fields"`
}

type matchFieldBody struct {
	Query    string  `json:"query"`
	Operator string  `json:"operator"`
	Boost    float64 `json:"boost"`
}

type shouldClauseBody struct {
	MultiMatch *multiMatchClauseBody    `json:"multi_match"`
	Match      map[string]matchFieldBody `json:"match"`
}

func parseFieldBoost(spec string) fieldBoost {
	name, boostStr, found := strings.Cut(spec, "^")
	boost := 1.0
	if found {
		if b, err := strconv.ParseFloat(boostStr, 64); err == nil {
			boost = b
		}
	}
	return fieldBoost{Name: name, Boost: boost}
}

func buildClauses(raws []json.RawMessage) []clause {
	clauses := make([]clause, 0, len(raws))
	for _, raw := range raws {
		var sc shouldClauseBody
		if err := json.Unmarshal(raw, &sc); err != nil {
			continue
		}
		if sc.MultiMatch != nil {
			mm := sc.MultiMatch
			fields := make([]fieldBoost, 0, len(mm.Fields))
			for _, f := range mm.Fields {
				fields = append(fields, parseFieldBoost(f))
			}
			clauses = append(clauses, clause{
				queryTokens: analyze(mm.Query),
				fields:      fields,
				fuzzy:       mm.Fuzziness != "",
			})
			continue
		}
		for fieldName, mf := range sc.Match {
			if !strings.HasSuffix(fieldName, ".prefix") {
				continue
			}
			boost := mf.Boost
			if boost == 0 {
				boost = 1.0
			}
			clauses = append(clauses, clause{
				queryTokens: analyze(mf.Query),
				prefix:      true,
				prefixBoost: boost,
			})
		}
	}
	return clauses
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("index")
	ix, ok := st.get(name)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": map[string]string{"type": "index_not_found_exception"},
		})
		return
	}

	var body searchRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	size := body.Size
	if size <= 0 {
		size = 1000
	}

	clauses := buildClauses(body.Query.Bool.Should)
	hits := ix.search(clauses, size)

	type hitDoc struct {
		ID string `json:"_id"`
	}
	hitDocs := make([]hitDoc, len(hits))
	for i, h := range hits {
		hitDocs[i] = hitDoc{ID: h.ID}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"hits": map[string]interface{}{
			"hits": hitDocs,
		},
	})
}
