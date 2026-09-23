package main

import (
	"strings"
	"unicode"
)

// vnFold strips Vietnamese diacritics (and folds đ -> d) so "tien hiep" matches
// "Tiên Hiệp", mirroring the asciifolding token filter used by the old Elasticsearch
// analyzer. Only lowercase forms are needed since callers lowercase text first.
var vnFold = buildVnFold()

func buildVnFold() map[rune]rune {
	groups := map[rune]string{
		'a': "àảãáạăằẳẵắặâầẩẫấậ",
		'e': "èẻẽéẹêềểễếệ",
		'i': "ìỉĩíị",
		'o': "òỏõóọôồổỗốộơờởỡớợ",
		'u': "ùủũúụưừửữứự",
		'y': "ỳỷỹýỵ",
		'd': "đ",
	}
	m := make(map[rune]rune)
	for base, chars := range groups {
		for _, r := range chars {
			m[r] = base
		}
	}
	return m
}

func foldRune(r rune) rune {
	if f, ok := vnFold[r]; ok {
		return f
	}
	return r
}

// tokenize lowercases, diacritic-folds and splits text into word/number tokens,
// approximating Elasticsearch's "standard" tokenizer + lowercase + asciifolding chain.
func tokenize(text string) []string {
	lower := strings.ToLower(text)
	return strings.FieldsFunc(lower, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
}

func foldToken(tok string) string {
	var b strings.Builder
	b.Grow(len(tok))
	for _, r := range tok {
		b.WriteRune(foldRune(r))
	}
	return b.String()
}

// analyze is the "vi_fold" analyzer: fold + tokenize, folding applied per rune.
func analyze(text string) []string {
	toks := tokenize(text)
	out := make([]string, len(toks))
	for i, t := range toks {
		out[i] = foldToken(t)
	}
	return out
}

// edgeGrams reproduces the edge_ngram(min=2,max=15) filter used for the
// "title.prefix" sub-field: every prefix of each token from length 2 to 15.
func edgeGrams(tokens []string) map[string]struct{} {
	grams := make(map[string]struct{})
	for _, tok := range tokens {
		runes := []rune(tok)
		max := len(runes)
		if max > 15 {
			max = 15
		}
		for n := 2; n <= max; n++ {
			grams[string(runes[:n])] = struct{}{}
		}
	}
	return grams
}

// levenshtein computes classic edit distance, used for fuzziness:AUTO matching.
func levenshtein(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	la, lb := len(ra), len(rb)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	prev := make([]int, lb+1)
	curr := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		curr[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			del := prev[j] + 1
			ins := curr[j-1] + 1
			sub := prev[j-1] + cost
			min := del
			if ins < min {
				min = ins
			}
			if sub < min {
				min = sub
			}
			curr[j] = min
		}
		prev, curr = curr, prev
	}
	return prev[lb]
}

// fuzzyMaxEdits mirrors Elasticsearch's fuzziness:"AUTO" thresholds:
// 0 edits for terms of length 0-2, 1 edit for 3-5, 2 edits for 6+.
func fuzzyMaxEdits(termLen int) int {
	switch {
	case termLen <= 2:
		return 0
	case termLen <= 5:
		return 1
	default:
		return 2
	}
}
