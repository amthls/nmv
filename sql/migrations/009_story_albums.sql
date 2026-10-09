-- Albums: named story lists a user makes ("Truyện Đã Lưu" upgraded). A story can sit in any
-- number of the user's albums. Albums are private by default; a public album shows up under the
-- stories it contains, and a private one can still be opened by anyone holding its share link
-- (share_token). Other users can save (bookmark) an album or copy its stories into their own.
CREATE TABLE IF NOT EXISTS albums (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    description  VARCHAR(500),
    is_public    BOOLEAN NOT NULL DEFAULT FALSE,
    share_token  VARCHAR(32) NOT NULL UNIQUE DEFAULT replace(uuid_generate_v4()::text, '-', ''),
    copied_from  UUID REFERENCES albums(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS album_stories (
    album_id   UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    story_id   UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (album_id, story_id)
);
CREATE INDEX IF NOT EXISTS idx_album_stories_story ON album_stories(story_id);

-- Someone else's album saved to "Album đã lưu" (follows it live, unlike a copy)
CREATE TABLE IF NOT EXISTS album_saves (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    album_id   UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    share_token VARCHAR(32), -- link key used to save a private album; a reset link revokes the save
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, album_id)
);
CREATE INDEX IF NOT EXISTS idx_album_saves_album ON album_saves(album_id);

-- One-time move of the old reading-status lists (user_favorites.category) into albums,
-- so nobody loses what they had saved. Runs only for users who have no album yet.
DO $$
DECLARE
  r RECORD;
  new_id UUID;
BEGIN
  FOR r IN
    SELECT uf.user_id, COALESCE(NULLIF(uf.category, ''), 'reading') AS category
    FROM user_favorites uf
    WHERE NOT EXISTS (SELECT 1 FROM albums a WHERE a.user_id = uf.user_id)
    GROUP BY 1, 2
  LOOP
    INSERT INTO albums (user_id, name)
    VALUES (r.user_id, CASE r.category
      WHEN 'reading' THEN 'Đang đọc'
      WHEN 'completed' THEN 'Đã đọc xong'
      WHEN 'on_hold' THEN 'Tạm dừng'
      WHEN 'plan_to_read' THEN 'Dự định đọc'
      ELSE 'Truyện đã lưu' END)
    RETURNING id INTO new_id;

    INSERT INTO album_stories (album_id, story_id, added_at)
    SELECT new_id, uf.story_id, uf.created_at
    FROM user_favorites uf
    WHERE uf.user_id = r.user_id AND COALESCE(NULLIF(uf.category, ''), 'reading') = r.category
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
