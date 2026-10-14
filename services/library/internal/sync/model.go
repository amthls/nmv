package sync

const syncPage = 500

// table is one copied table: the backend path that lists its changed rows and the upsert that stores a page.
type table struct {
	name, path, upsert string
}

// Read copies of the backend's stories and chapters (ext_stories, ext_chapters). Every 30 s library asks the backend for
// rows changed since its cursor ((updated_at, id) of the last row taken; every update bumps updated_at by trigger), and
// once a day it drops copies whose row is gone. Deletions also come straight away through POST /internal/purge.
// shortcut: polling instead of catalog events (the backend has no outbox yet); change at stage I.

var tables = []table{
	{"stories", "/internal/library/stories", `
		INSERT INTO ext_stories (id, title, slug, cover_image_url, author_name, story_type, status, approval_status, total_chapters,
		  total_views, total_favorites, group_name, tags, updated_at, synced_at)
		SELECT id, title, slug, cover_image_url, author_name, story_type, status, approval_status, total_chapters,
		  total_views, total_favorites, group_name, COALESCE(tags, '[]'), updated_at, NOW()
		FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, title text, slug text, cover_image_url text, author_name text, story_type text,
		  status text, approval_status text, total_chapters int, total_views bigint, total_favorites bigint, group_name text, tags jsonb,
		  updated_at timestamptz)
		ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, cover_image_url = EXCLUDED.cover_image_url,
		  author_name = EXCLUDED.author_name, story_type = EXCLUDED.story_type, status = EXCLUDED.status,
		  approval_status = EXCLUDED.approval_status, total_chapters = EXCLUDED.total_chapters, total_views = EXCLUDED.total_views,
		  total_favorites = EXCLUDED.total_favorites, group_name = EXCLUDED.group_name, tags = EXCLUDED.tags,
		  updated_at = EXCLUDED.updated_at, synced_at = NOW()`},
	{"chapters", "/internal/library/chapters", `
		INSERT INTO ext_chapters (id, story_id, title, slug, chapter_number, is_published, updated_at, synced_at)
		SELECT id, story_id, title, slug, chapter_number, is_published, updated_at, NOW()
		FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, story_id uuid, title text, slug text, chapter_number numeric,
		  is_published boolean, updated_at timestamptz)
		ON CONFLICT (id) DO UPDATE SET story_id = EXCLUDED.story_id, title = EXCLUDED.title, slug = EXCLUDED.slug,
		  chapter_number = EXCLUDED.chapter_number, is_published = EXCLUDED.is_published, updated_at = EXCLUDED.updated_at,
		  synced_at = NOW()`},
}
