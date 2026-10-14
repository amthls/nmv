package blocks

import (
	"strings"
	"testing"
)

func TestBlockHashIgnoresPositionAndKeyOrder(t *testing.T) {
	h1, _, _ := Hash(Block{"id": "b1", "type": "paragraph", "text": "Xin chào"})
	h2, _, _ := Hash(Block{"text": "Xin chào", "type": "paragraph", "id": "b7"})
	h3, _, _ := Hash(Block{"id": "b1", "type": "paragraph", "text": "Xin chào!"})
	if h1 != h2 || h1 == h3 {
		t.Fatalf("hash: %s %s %s", h1, h2, h3)
	}
}

func TestBlockHashPlainParagraphHTML(t *testing.T) {
	// what an imported chapter stores vs what the editor sends back for the same paragraph
	plain, _, _ := Hash(Block{"type": "paragraph", "text": "A & B < C"})
	edited, _, _ := Hash(Block{"id": "b3", "type": "paragraph", "text": "A & B < C", "html": "<p>A &amp; B &lt; C</p>"})
	bold, _, _ := Hash(Block{"type": "paragraph", "text": "A & B < C", "html": "<p><strong>A</strong> &amp; B &lt; C</p>"})
	centered, _, _ := Hash(Block{"type": "paragraph", "text": "A", "html": "<p style=\"text-align:center\">A</p>"})
	alone, _, _ := Hash(Block{"type": "paragraph", "text": "A"})
	if plain != edited || plain == bold || centered == alone {
		t.Fatalf("plain %s edited %s bold %s centered %s", plain, edited, bold, centered)
	}
}

func TestDiffHashes(t *testing.T) {
	render := func(ops []DiffOp) string {
		var b strings.Builder
		for _, o := range ops {
			b.WriteString(map[string]string{"same": " ", "del": "-", "ins": "+"}[o.Op] + o.Hash)
		}
		return b.String()
	}
	cases := []struct{ a, b, want string }{
		{"abc", "abc", " a b c"},
		{"abc", "abxc", " a b+x c"},      // insert
		{"abc", "ac", " a-b c"},          // delete
		{"abc", "axc", " a-b+x c"},       // changed paragraph = del + ins
		{"", "ab", "+a+b"},               // new chapter
		{"ab", "", "-a-b"},               // emptied
		{"abcd", "cdab", "-a-b c d+a+b"}, // moved block shows as delete + insert
	}
	split := func(s string) []string { return strings.Split(s, "")[:len(s)] }
	for _, c := range cases {
		a, b := split(c.a), split(c.b)
		if c.a == "" {
			a = nil
		}
		if c.b == "" {
			b = nil
		}
		if got := render(Diff(a, b)); got != c.want {
			t.Errorf("%q -> %q: got %q, want %q", c.a, c.b, got, c.want)
		}
	}
}

func TestMerge3(t *testing.T) {
	// one letter = one paragraph hash; conflicts render as <base|ours|theirs>
	render := func(chunks []Chunk) string {
		var b strings.Builder
		for _, c := range chunks {
			if c.Conflict == nil {
				b.WriteString(strings.Join(c.Ok, ""))
				continue
			}
			b.WriteString("<" + strings.Join(c.Conflict.Base, "") + "|" + strings.Join(c.Conflict.Ours, "") + "|" + strings.Join(c.Conflict.Theirs, "") + ">")
		}
		return b.String()
	}
	split := func(s string) []string {
		if s == "" {
			return nil
		}
		return strings.Split(s, "")
	}
	cases := []struct{ name, base, ours, theirs, want string }{
		{"nothing changed", "abc", "abc", "abc", "abc"},
		{"only ours changed", "abc", "aXc", "abc", "aXc"},
		{"only theirs changed", "abc", "abc", "aXc", "aXc"},
		{"different paragraphs", "abcde", "aXcde", "abcYe", "aXcYe"},
		{"both the same change", "abc", "aXc", "aXc", "aXc"},
		{"both changed one paragraph", "abc", "aXc", "aYc", "a<b|X|Y>c"},
		{"neighbouring paragraphs, one each", "abcd", "aXcd", "abYd", "aXYd"},
		{"neighbours, one clash", "abcd", "aXYd", "aXZd", "aX<c|Y|Z>d"},
		{"ours inserted, theirs deleted elsewhere", "abcd", "abXcd", "abc", "abXc"},
		{"theirs inserted at the end", "ab", "Ab", "abZ", "AbZ"},
		{"both inserted at the same place", "ab", "aXb", "aYb", "a<|X|Y>b"},
		{"ours deleted what theirs edited", "abc", "ac", "aYc", "a<b||Y>c"},
		{"new paragraphs both sides apart", "", "X", "", "X"},
	}
	for _, c := range cases {
		if got := render(Merge3(split(c.base), split(c.ours), split(c.theirs))); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}

	// conflicts are numbered and resolved by the user's choices
	chunks := Merge3(split("abc"), split("XbY"), split("ZbW"))
	if render(chunks) != "<a|X|Z>b<c|Y|W>" || chunks[0].Conflict.ID != "b0" || chunks[2].Conflict.ID != "b1" {
		t.Fatalf("ids: %s", render(chunks))
	}
	out, _, err := Resolve(chunks, Meta{}, nil, Meta{}, map[string]string{"b0": "theirs", "b1": "both"})
	if err != nil || strings.Join(out, "") != "ZbYW" {
		t.Fatalf("resolve: %v %v", out, err)
	}
	if _, _, err := Resolve(chunks, Meta{}, nil, Meta{}, map[string]string{"b0": "ours"}); err == nil {
		t.Fatal("an unchosen conflict must be refused")
	}
}

func TestMergeMeta(t *testing.T) {
	base := Meta{Title: "Mở đầu", ChapterNumber: 1}
	ours := Meta{Title: "Mở đầu (sửa)", ChapterNumber: 1}
	theirs := Meta{Title: "Mở đầu", ChapterNumber: 2}
	m, conf := MergeMeta(base, ours, theirs)
	if m.Title != "Mở đầu (sửa)" || m.ChapterNumber != 2 || len(conf) != 0 {
		t.Fatalf("clean meta merge: %+v %v", m, conf)
	}
	theirs.Title = "Khởi đầu"
	m, conf = MergeMeta(base, ours, theirs)
	if len(conf) != 1 || conf[0].ID != "title" || m.Title != "Mở đầu (sửa)" {
		t.Fatalf("title conflict: %+v %v", m, conf)
	}
	_, m, err := Resolve(nil, m, conf, theirs, map[string]string{"title": "theirs"})
	if err != nil || m.Title != "Khởi đầu" || m.ChapterNumber != 2 {
		t.Fatalf("resolve meta: %+v %v", m, err)
	}
}
