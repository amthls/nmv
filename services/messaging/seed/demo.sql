-- Sample notifications and announcements for a fresh install (users from sql/database.sql / identity seed-demo).
-- launch.py runs it after import-legacy; it adds rows only once and only into an empty messaging_db.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM legacy_imports WHERE part = 'demo')
     OR EXISTS (SELECT 1 FROM notifications) OR EXISTS (SELECT 1 FROM broadcasts) THEN RETURN; END IF;
  INSERT INTO notifications (user_id, type, category, title, message, link, actors, actor_count) VALUES
  ('a0000000-0000-0000-0000-000000000009', 'system', 'system', '🎉 Chào mừng đến NovelHub!', 'Cảm ơn bạn đã đăng ký tài khoản. Hãy khám phá kho truyện đồ sộ của chúng tôi!', NULL, '[{"id":"a0000000-0000-0000-0000-000000000001","name":"Administrator"}]', 1),
  ('a0000000-0000-0000-0000-000000000010', 'system', 'system', '🎉 Chào mừng đến NovelHub!', 'Cảm ơn bạn đã đăng ký tài khoản. Hãy khám phá kho truyện đồ sộ của chúng tôi!', NULL, '[{"id":"a0000000-0000-0000-0000-000000000001","name":"Administrator"}]', 1),
  ('a0000000-0000-0000-0000-000000000011', 'system', 'system', '🎉 Chào mừng đến NovelHub!', 'Cảm ơn bạn đã đăng ký tài khoản. Hãy khám phá kho truyện đồ sộ của chúng tôi!', NULL, '[{"id":"a0000000-0000-0000-0000-000000000001","name":"Administrator"}]', 1),
  ('a0000000-0000-0000-0000-000000000012', 'system', 'system', '🎉 Chào mừng đến NovelHub!', 'Cảm ơn bạn đã đăng ký tài khoản. Hãy khám phá kho truyện đồ sộ của chúng tôi!', NULL, '[{"id":"a0000000-0000-0000-0000-000000000001","name":"Administrator"}]', 1),
  ('a0000000-0000-0000-0000-000000000008', 'group_invite', 'group', 'Lời mời tham gia nhóm dịch', 'Bạn đã được mời tham gia nhóm dịch "Neko Translation"', '/nhom-dich/neko-translation', '[{"id":"a0000000-0000-0000-0000-000000000004","name":"Neko Translation"}]', 1),
  ('a0000000-0000-0000-0000-000000000005', 'group_member_add', 'group', 'Thành viên mới trong nhóm', 'Usagi Editor đã tham gia nhóm "Neko Translation"', '/nhom-dich/neko-translation', '[]', 0);
  INSERT INTO broadcasts (created_by, title, message) VALUES
  ('a0000000-0000-0000-0000-000000000001', '📢 Cập nhật hệ thống v2.0', 'Chúng tôi vừa cập nhật giao diện mới với nhiều tính năng hấp dẫn. Hãy trải nghiệm ngay!'),
  ('a0000000-0000-0000-0000-000000000001', '🎊 Sự kiện đọc truyện mùa hè', 'Tham gia sự kiện đọc truyện mùa hè để nhận badge đặc biệt! Chi tiết tại trang sự kiện.');
  INSERT INTO legacy_imports (part) VALUES ('demo');
END $$;
