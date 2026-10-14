package legacy

// part is one table copied from the old database: a SELECT there and the INSERT its rows go through.
type part struct{ name, read, write string }

// Each part: a SELECT on the old database and the INSERT its rows go through ($n in column order)
var parts = []part{
	{"follows", `SELECT id, user_id, story_id, category, notify_updates, created_at FROM user_favorites`,
		`INSERT INTO user_favorites (id, user_id, story_id, category, notify_updates, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`},
	{"bookmarks", `SELECT id, user_id, story_id, chapter_id, line_text, line_index, scroll_position, page_number, note, color, created_at FROM bookmarks`,
		`INSERT INTO bookmarks (id, user_id, story_id, chapter_id, line_text, line_index, scroll_position, page_number, note, color, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`},
	{"history", `SELECT id, user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds FROM reading_history`,
		`INSERT INTO reading_history (id, user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`},
	// copied_from points at another album: insert them all first without it, then set it
	{"albums", `SELECT a.id, a.user_id, u.code_no, a.name, a.description, a.is_public, a.share_token, a.created_at, a.updated_at, a.code_no
		FROM albums a LEFT JOIN users u ON u.id = a.user_id`,
		`INSERT INTO albums (id, user_id, owner_code_no, name, description, is_public, share_token, created_at, updated_at, code_no)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`},
	{"album links", `SELECT id, copied_from FROM albums WHERE copied_from IS NOT NULL`,
		`UPDATE albums SET copied_from = $2 WHERE id = $1`},
	{"album stories", `SELECT album_id, story_id, added_at FROM album_stories`,
		`INSERT INTO album_stories (album_id, story_id, added_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`},
	{"album saves", `SELECT user_id, album_id, share_token, created_at FROM album_saves`,
		`INSERT INTO album_saves (user_id, album_id, share_token, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`},
	{"user follows", `SELECT id, follower_id, following_id, created_at FROM user_follows`,
		`INSERT INTO user_follows (id, follower_id, following_id, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`},
}
