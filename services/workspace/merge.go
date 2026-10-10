package main

import (
	"encoding/json"
	"fmt"
	"slices"
)

// Three-way merge of a draft with the official line (Plan/chapter-workspace.md, stage 2), like git merges lines:
// base = the version the draft started from, ours = the draft, theirs = the current official version.
// Paragraphs are compared by hash, so a paragraph only one side touched merges by itself.

// mergeChunk is a run of the result: either settled blocks, or a conflict the user must choose for.
type mergeChunk struct {
	Ok       []string       `json:"ok,omitempty"`
	Conflict *blockConflict `json:"conflict,omitempty"`
}

type blockConflict struct {
	ID     string   `json:"id"` // "b0", "b1", ... in order: the key of the user's choice
	Base   []string `json:"base"`
	Ours   []string `json:"ours"`
	Theirs []string `json:"theirs"`
}

// matchIndex: for every element of a, its index in b on the longest common subsequence, or -1.
func matchIndex(a, b []string) []int {
	m := make([]int, len(a))
	i, j := 0, 0
	for _, op := range diffHashes(a, b) {
		switch op.Op {
		case "same":
			m[i] = j
			i, j = i+1, j+1
		case "del":
			m[i] = -1
			i++
		default:
			j++
		}
	}
	return m
}

// merge3 splits the result into stable runs (all three agree) and changed runs; a changed run takes the side
// that changed it, or becomes a conflict when both sides changed it differently.
func merge3(base, ours, theirs []string) []mergeChunk {
	mo, mt := matchIndex(base, ours), matchIndex(base, theirs)
	var out []mergeChunk
	emit := func(blocks []string) {
		if len(blocks) == 0 {
			return
		}
		if n := len(out); n > 0 && out[n-1].Conflict == nil {
			out[n-1].Ok = append(out[n-1].Ok, blocks...)
			return
		}
		out = append(out, mergeChunk{Ok: append([]string{}, blocks...)})
	}
	conflicts := 0
	i, a, b := 0, 0, 0
	for i < len(base) || a < len(ours) || b < len(theirs) {
		if i < len(base) && mo[i] == a && mt[i] == b {
			emit(base[i : i+1])
			i, a, b = i+1, a+1, b+1
			continue
		}
		// next base block both sides still have = end of this changed run
		end, ea, eb := len(base), len(ours), len(theirs)
		for k := i; k < len(base); k++ {
			if mo[k] >= a && mt[k] >= b {
				end, ea, eb = k, mo[k], mt[k]
				break
			}
		}
		o, x, y := base[i:end], ours[a:ea], theirs[b:eb]
		switch {
		case slices.Equal(x, o): // only theirs changed it
			emit(y)
		case slices.Equal(y, o), slices.Equal(x, y): // only ours, or both the same way
			emit(x)
		default:
			out = append(out, mergeChunk{Conflict: &blockConflict{ID: fmt.Sprintf("b%d", conflicts), Base: o, Ours: x, Theirs: y}})
			conflicts++
		}
		i, a, b = end, ea, eb
	}
	return out
}

// metaConflict: a chapter field both sides changed differently.
type metaConflict struct {
	ID     string `json:"id"` // the field name
	Base   any    `json:"base"`
	Ours   any    `json:"ours"`
	Theirs any    `json:"theirs"`
}

func metaFields(m chapterMeta) map[string]any {
	var out map[string]any
	data, _ := json.Marshal(m)
	json.Unmarshal(data, &out)
	return out
}

// mergeMeta merges field by field; a conflicting field keeps ours until the user chooses.
func mergeMeta(base, ours, theirs chapterMeta) (chapterMeta, []metaConflict) {
	bf, of, tf := metaFields(base), metaFields(ours), metaFields(theirs)
	same := func(x, y any) bool { a, _ := json.Marshal(x); b, _ := json.Marshal(y); return string(a) == string(b) }
	result := map[string]any{}
	var conflicts []metaConflict
	for _, k := range []string{"title", "chapter_number", "volume_id", "intro_note", "outro_note"} {
		switch {
		case same(of[k], bf[k]):
			result[k] = tf[k]
		case same(tf[k], bf[k]), same(of[k], tf[k]):
			result[k] = of[k]
		default:
			result[k] = of[k]
			conflicts = append(conflicts, metaConflict{ID: k, Base: bf[k], Ours: of[k], Theirs: tf[k]})
		}
	}
	var m chapterMeta
	data, _ := json.Marshal(result)
	json.Unmarshal(data, &m)
	return m, conflicts
}

// resolve applies the user's choices ("ours" | "theirs" | "both" for blocks); every conflict needs one.
func resolve(chunks []mergeChunk, meta chapterMeta, metaConf []metaConflict, theirs chapterMeta, choices map[string]string) ([]string, chapterMeta, error) {
	out := []string{}
	for _, c := range chunks {
		if c.Conflict == nil {
			out = append(out, c.Ok...)
			continue
		}
		switch choices[c.Conflict.ID] {
		case "ours":
			out = append(out, c.Conflict.Ours...)
		case "theirs":
			out = append(out, c.Conflict.Theirs...)
		case "both":
			out = append(append(out, c.Conflict.Ours...), c.Conflict.Theirs...)
		default:
			return nil, meta, fmt.Errorf("chưa chọn cách gộp cho đoạn xung đột %s", c.Conflict.ID)
		}
	}
	tf := metaFields(theirs)
	mf := metaFields(meta)
	for _, c := range metaConf {
		switch choices[c.ID] {
		case "ours":
		case "theirs":
			mf[c.ID] = tf[c.ID]
		default:
			return nil, meta, fmt.Errorf("chưa chọn giá trị cho trường %s", c.ID)
		}
	}
	data, _ := json.Marshal(mf)
	var m chapterMeta
	json.Unmarshal(data, &m)
	return out, m, nil
}
