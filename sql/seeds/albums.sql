-- Demo albums (sql/migrations/009_story_albums.sql must be applied first).
-- Gives the seeded accounts themed albums built from the stories already in the database, so
-- every story page has an album row to show. Safe to re-run: it replaces only its own albums
-- (fixed ids), albums people made themselves are untouched.
--
--   docker exec -i novel_postgres psql -U postgres -d novel_platform < sql/seeds/albums.sql

DO $$
DECLARE
  spec RECORD;
  v_owner UUID;
  v_album UUID;
  target INT;
  seeded UUID[] := '{}';
BEGIN
  -- Drop the previous run's albums (ids are md5 of the spec number, see below)
  DELETE FROM albums WHERE id IN (SELECT md5('nmv-album-seed-' || n)::uuid FROM generate_series(1, 200) n);

  FOR spec IN
    SELECT * FROM (VALUES
      -- n, owner, name, description, tag slug to draw from (NULL = any), story type (NULL = any), public
      (1,  'reader_hana',   'Isekai đỉnh cao',              'Xuyên không, chuyển sinh, có hệ thống càng tốt.',           'isekai',        NULL,    true),
      (2,  'reader_hana',   'Romcom ngọt sâu răng',         'Đọc để cười và để tim đập nhanh.',                         'romance',       NULL,    true),
      (3,  'reader_hana',   'Đọc trước khi ngủ',            NULL,                                                        'slice-of-life', NULL,    false),
      (4,  'reader_ryu',    'Main bá đạo',                  'Nhân vật chính mạnh từ đầu, không lan man.',                'op-mc',         NULL,    true),
      (5,  'reader_ryu',    'Shounen máu lửa',              'Đánh nhau, tình bạn, vượt giới hạn.',                       'shounen',       'manga', true),
      (6,  'reader_ryu',    'Võ hiệp & tu luyện',           NULL,                                                        'martial-arts',  NULL,    true),
      (7,  'reader_sora',   'Fantasy phải đọc một lần',     'Thế giới phép thuật xây dựng kỹ.',                          'fantasy',       NULL,    true),
      (8,  'reader_sora',   'Light novel cho người mới',    'Ngắn, dễ đọc, dịch mượt.',                                  'light-novel',   'novel', true),
      (9,  'reader_sora',   'Để dành đọc dần',              NULL,                                                        NULL,            NULL,    false),
      (10, 'reader_yuki',   'Học đường thanh xuân',         'Câu lạc bộ, lễ hội trường, mối tình đầu.',                  'school-life',   NULL,    true),
      (11, 'reader_yuki',   'Hài không nhặt được mồm',      NULL,                                                        'comedy',        NULL,    true),
      (12, 'reader_yuki',   'Drama cực cuốn',               'Đọc xong một chương là muốn đọc chương tiếp.',              'drama',         NULL,    true),
      (13, 'mod_sakura',    'Manga tranh đẹp',              'Nét vẽ xuất sắc, xem cho đã mắt.',                          NULL,            'manga', true),
      (14, 'mod_sakura',    'Tuyển chọn của Mod',           'Những bộ chất lượng mình hay giới thiệu.',                  NULL,            NULL,    true),
      (15, 'mod_kaito',     'Siêu nhiên & bí ẩn',           NULL,                                                        'supernatural',  NULL,    true),
      (16, 'mod_kaito',     'Seinen cho người lớn',         'Cốt truyện nặng đô, nhân vật có chiều sâu.',                'seinen',        NULL,    true),
      (17, 'author_minh',   'Truyện chữ hay để học viết',   'Văn phong đáng tham khảo.',                                 NULL,            'novel', true),
      (18, 'author_minh',   'Phép thuật & học viện',        NULL,                                                        'magic',         NULL,    true),
      (19, 'neko_trans',    'Nhóm Neko đang theo',          'Những bộ cả nhóm đang đọc cùng nhau.',                      NULL,            NULL,    true),
      (20, 'neko_trans',    'Phiêu lưu khắp thế giới',      NULL,                                                        'adventure',     NULL,    true),
      (21, 'kitsune_group', 'Kitsune đề cử',                'Mỗi tuần nhóm chọn vài bộ.',                                NULL,            NULL,    true),
      (22, 'kitsune_group', 'Quái vật & dungeon',           NULL,                                                        'monsters',      NULL,    true),
      (23, 'tanuki_san',    'Chill cuối tuần',              'Nhẹ nhàng, không cần suy nghĩ.',                            'slice-of-life', NULL,    true),
      (24, 'tanuki_san',    'Đọc một mạch hết luôn',        NULL,                                                        NULL,            'manga', true),
      (25, 'usagi_editor',  'Bìa đẹp tuyển tập',            'Chọn theo bìa, chưa bao giờ hối hận.',                      NULL,            NULL,    true),
      (26, 'usagi_editor',  'Chuyển sinh làm lại cuộc đời', NULL,                                                        'reincarnation', NULL,    true),
      (27, 'admin',         'Top truyện tháng này',         'Danh sách do ban quản trị tổng hợp.',                       NULL,            NULL,    true),
      (28, 'admin',         'Khoa học viễn tưởng',          NULL,                                                        'sci-fi',        NULL,    true)
    ) AS t(n, username, name, description, tag_slug, story_type, is_public)
  LOOP
    SELECT id INTO v_owner FROM users WHERE username = spec.username AND deleted_at IS NULL;
    CONTINUE WHEN v_owner IS NULL;

    v_album := md5('nmv-album-seed-' || spec.n)::uuid;
    INSERT INTO albums (id, user_id, name, description, is_public, created_at, updated_at)
    VALUES (v_album, v_owner, spec.name, spec.description, spec.is_public,
            NOW() - (random() * 60 + 5) * INTERVAL '1 day', NOW() - random() * 5 * INTERVAL '1 day');
    seeded := seeded || v_album;
    target := 6 + floor(random() * 7)::int; -- 6..12 stories

    -- Stories matching the album's theme first...
    INSERT INTO album_stories (album_id, story_id, added_at)
    SELECT v_album, s.id, NOW() - random() * 30 * INTERVAL '1 day'
    FROM stories s
    WHERE s.approval_status = 'approved'
      AND (spec.story_type IS NULL OR s.story_type::text = spec.story_type)
      AND (spec.tag_slug IS NULL OR EXISTS (
        SELECT 1 FROM story_tags st JOIN tags t ON t.id = st.tag_id WHERE st.story_id = s.id AND t.slug = spec.tag_slug))
    ORDER BY random()
    LIMIT target;

    -- ...then topped up with random ones of the same type
    INSERT INTO album_stories (album_id, story_id, added_at)
    SELECT v_album, s.id, NOW() - random() * 30 * INTERVAL '1 day'
    FROM stories s
    WHERE s.approval_status = 'approved'
      AND (spec.story_type IS NULL OR s.story_type::text = spec.story_type)
      AND NOT EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = v_album AND x.story_id = s.id)
    ORDER BY random()
    LIMIT GREATEST(0, target - (SELECT count(*) FROM album_stories x WHERE x.album_id = v_album));
  END LOOP;

  -- Every approved story lands in at least 3 public seeded albums, so each story page has a row
  FOR spec IN
    SELECT s.id AS story_id, gs AS round
    FROM stories s CROSS JOIN generate_series(1, 3) gs
    WHERE s.approval_status = 'approved'
  LOOP
    INSERT INTO album_stories (album_id, story_id, added_at)
    SELECT a.id, spec.story_id, NOW() - random() * 30 * INTERVAL '1 day'
    FROM albums a
    WHERE a.id = ANY (seeded) AND a.is_public
      AND NOT EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = a.id AND x.story_id = spec.story_id)
      AND (SELECT count(*) FROM album_stories x JOIN albums pa ON pa.id = x.album_id
           WHERE x.story_id = spec.story_id AND pa.id = ANY (seeded) AND pa.is_public) < 3
    ORDER BY random()
    LIMIT 1;
  END LOOP;

  -- Each account saves a few public albums of other people (gives albums a save count)
  INSERT INTO album_saves (user_id, album_id, created_at)
  SELECT u.id, pick.id, NOW() - random() * 10 * INTERVAL '1 day'
  FROM users u
  CROSS JOIN LATERAL (
    SELECT a.id FROM albums a
    WHERE a.id = ANY (seeded) AND a.is_public AND a.user_id <> u.id
    ORDER BY random()
    LIMIT 2 + floor(random() * 4)::int
  ) pick
  WHERE u.deleted_at IS NULL AND NOT COALESCE(u.is_banned, false)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Seeded % albums, % album entries, % saves',
    (SELECT count(*) FROM albums WHERE id = ANY (seeded)),
    (SELECT count(*) FROM album_stories WHERE album_id = ANY (seeded)),
    (SELECT count(*) FROM album_saves WHERE album_id = ANY (seeded));
END $$;
