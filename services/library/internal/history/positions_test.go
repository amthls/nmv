package history

import "testing"

func TestPositionBufferAddsSecondsAndTakes(t *testing.T) {
	var b positionBuffer
	b.add(pendingRead{UserID: "u", ChapterID: "c", Seconds: 60, Scroll: 10})
	p := b.add(pendingRead{UserID: "u", ChapterID: "c", Seconds: 30, Scroll: 40})
	if p.Seconds != 90 || p.Scroll != 40 {
		t.Fatalf("merged position: %+v", p)
	}
	b.add(pendingRead{UserID: "v", ChapterID: "c"})
	if n := len(b.take("u")); n != 1 {
		t.Fatalf("take one user: %d", n)
	}
	if n := len(b.take("")); n != 1 {
		t.Fatalf("take the rest: %d", n)
	}
}
