-- Sample Fandom posts, reactions, comments and a report for a fresh install (users from sql/database.sql / identity
-- seed-demo). launch.py runs it after import-legacy; it adds rows only once and only into an empty community_db.
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM legacy_imports WHERE part = 'demo') OR EXISTS (SELECT 1 FROM posts) OR EXISTS (SELECT 1 FROM comments) THEN RETURN; END IF;

-- Posts (Fandom/Blog)
INSERT INTO posts (id, user_id, title, slug, content, story_id, is_published) VALUES
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000009',
    'Top 10 Light Novel Isekai hay nhất 2026 - Không thể bỏ lỡ!',
    'top-10-light-novel-isekai-2026',
    E'## Danh sách Top 10 Isekai LN hay nhất năm nay\n\nXin chào mọi người! Mình là Hana, hôm nay mình muốn chia sẻ danh sách top 10 Light Novel Isekai mà mình đã đọc trong năm 2026.\n\n### 1. Mushoku Tensei\nKinh điển không cần bàn cãi...\n\n### 2. Re:Zero\nChuyển sinh vào thế giới khác với khả năng quay về sau khi chết...\n\n### 3. Overlord\nBị kẹt trong game MMORPG với sức mạnh tối thượng...\n\nCác bạn có bộ nào muốn thêm vào danh sách không? Comment bên dưới nhé! 👇',
    NULL, TRUE),
('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000010',
    'Review: Solo Leveling - Từ E-rank lên Shadow Monarch',
    'review-solo-leveling',
    E'## Solo Leveling - Review chi tiết\n\n**Rating: 9/10** ⭐\n\nSolo Leveling là một trong những manhwa hay nhất mình từng đọc. Câu chuyện về Sung Jin-Woo từ một hunter E-rank yếu nhất trở thành Shadow Monarch mạnh nhất thế giới.\n\n### Điểm mạnh:\n- Artwork tuyệt đẹp\n- Power progression hợp lý\n- Action scenes đỉnh cao\n\n### Điểm yếu:\n- Side characters thiếu chiều sâu\n- Ending hơi rushed\n\nTổng kết: MUST READ! 🔥',
    NULL, TRUE),
('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000011',
    'Chia sẻ: Tại sao Slice of Life là thể loại tuyệt vời nhất?',
    'tai-sao-slice-of-life-tuyet-voi',
    E'## Slice of Life - Thể loại bị đánh giá thấp\n\nMọi người thường bỏ qua Slice of Life vì nghĩ nó "chán", nhưng thực tế đây là thể loại mang lại cảm giác thư giãn và healing nhất.\n\n### Vì sao mình yêu SoL:\n1. **Healing**: Sau một ngày mệt mỏi, SoL giúp mình thư giãn\n2. **Nhân vật chân thực**: Không cần super power, chỉ cần cuộc sống bình thường\n3. **Cảm xúc sâu sắc**: Những khoảnh khắc nhỏ nhưng đầy ý nghĩa\n\nCác bạn có thích SoL không? Bộ SoL yêu thích của bạn là gì? 🌸',
    NULL, TRUE);

-- Post Reactions
INSERT INTO post_reactions (post_id, user_id, reaction) VALUES
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'like'),
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'love'),
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000012', 'like'),
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'love'),
('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000009', 'wow'),
('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000012', 'like'),
('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000009', 'love'),
('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000010', 'like');

-- Comments
INSERT INTO comments (id, user_id, target_type, target_id, parent_id, root_id, depth, content) VALUES
('11000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'post', 'f0000000-0000-0000-0000-000000000001', NULL, NULL, 0, 'Danh sách hay quá! Mình cũng đang đọc Mushoku Tensei, đỉnh thật 🔥'),
('11000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000012', 'post', 'f0000000-0000-0000-0000-000000000001', NULL, NULL, 0, 'Thiếu Konosuba rồi bạn ơi! Bộ đó hài vãi 😂'),
('11000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000009', 'post', 'f0000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', 1, 'Ôi đúng rồi! Mình quên mất Konosuba! Sẽ update thêm 😅'),
('11000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000009', 'post', 'f0000000-0000-0000-0000-000000000002', NULL, NULL, 0, 'Mình cũng cho 9/10. Ending hơi tiếc nhưng overall vẫn là masterpiece!'),
('11000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000011', 'post', 'f0000000-0000-0000-0000-000000000002', NULL, NULL, 0, 'Artwork cũng là điểm mạnh lớn nhất. Mỗi panel đều như wallpaper 🖼️');

-- Counters the old triggers kept
UPDATE comments SET reply_count = 1 WHERE id = '11000000-0000-0000-0000-000000000002';
UPDATE posts SET
    reaction_count = (SELECT COUNT(*) FROM post_reactions WHERE post_id = posts.id),
    comment_count = (SELECT COUNT(*) FROM comments WHERE target_type = 'post' AND target_id = posts.id);

-- Reports
INSERT INTO reports (reporter_id, target_type, target_id, reason, description, status) VALUES
('a0000000-0000-0000-0000-000000000009', 'comment', '11000000-0000-0000-0000-000000000001', 'spam', 'Comment này có vẻ là spam', 'pending');
UPDATE reports SET target_preview = left(c.content, 160) FROM comments c WHERE c.id = reports.target_id;

INSERT INTO legacy_imports (part) VALUES ('demo');
END $$;
