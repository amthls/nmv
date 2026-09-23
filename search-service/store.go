package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// store holds every index (by name) and persists them to a single snapshot
// file so a container restart doesn't serve empty results until the backend's
// next full reindex finishes.
type store struct {
	mu           sync.Mutex // guards creating/looking up indices in `indices`
	indices      map[string]*index
	snapshotPath string
}

func newStore(snapshotPath string) *store {
	return &store{
		indices:      make(map[string]*index),
		snapshotPath: snapshotPath,
	}
}

func (s *store) get(name string) (*index, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ix, ok := s.indices[name]
	return ix, ok
}

func (s *store) getOrCreate(name string) *index {
	s.mu.Lock()
	defer s.mu.Unlock()
	ix, ok := s.indices[name]
	if !ok {
		ix = newIndexData()
		s.indices[name] = ix
	}
	return ix
}

type snapshotFile struct {
	Indices map[string][]snapshotDoc `json:"indices"`
}

func (s *store) save() {
	if s.snapshotPath == "" {
		return
	}
	s.mu.Lock()
	names := make([]string, 0, len(s.indices))
	ixs := make([]*index, 0, len(s.indices))
	for name, ix := range s.indices {
		names = append(names, name)
		ixs = append(ixs, ix)
	}
	s.mu.Unlock()

	snap := snapshotFile{Indices: make(map[string][]snapshotDoc, len(names))}
	for i, name := range names {
		snap.Indices[name] = ixs[i].snapshot()
	}

	data, err := json.Marshal(snap)
	if err != nil {
		log.Printf("snapshot marshal failed: %v", err)
		return
	}

	tmp := s.snapshotPath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		log.Printf("snapshot write failed: %v", err)
		return
	}
	if err := os.Rename(tmp, s.snapshotPath); err != nil {
		log.Printf("snapshot rename failed: %v", err)
	}
}

func (s *store) load() {
	if s.snapshotPath == "" {
		return
	}
	data, err := os.ReadFile(s.snapshotPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("snapshot load failed: %v", err)
		}
		return
	}
	var snap snapshotFile
	if err := json.Unmarshal(data, &snap); err != nil {
		log.Printf("snapshot parse failed: %v", err)
		return
	}
	total := 0
	for name, docs := range snap.Indices {
		ix := s.getOrCreate(name)
		ix.restore(docs)
		total += len(docs)
	}
	log.Printf("restored %d docs across %d index(es) from %s", total, len(snap.Indices), s.snapshotPath)
}

func ensureDir(path string) {
	dir := filepath.Dir(path)
	if dir == "" || dir == "." {
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("could not create snapshot dir %s: %v", dir, err)
	}
}
