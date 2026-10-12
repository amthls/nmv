# fix/story-source-columns

- **Mục tiêu:** Sửa lỗi crawler: cột stories.source_name không tồn tại trên DB cài mới
- **Tạo từ:** `origin/main` @ 778f01f, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (chưa mở)
- **Plan:** (Plan/<tên>.md nếu có)

## Thay đổi
- `sql/database.sql`: thêm stories.source_name/source_id/source_url, chapters.source_group và index uq_stories_source (bản cài mới thiếu nhưng 006 vẫn bị ghi là đã chạy -> crawler lỗi `column "source_name" does not exist`).
- Migration 029 chạy lại 006 (idempotent) để sửa DB đã cài.

## Migration / biến môi trường mới
- 029_story_sources_repair.sql (chạy qua launch.py / scripts/migrate.sh)

## Đã kiểm tra
- Tạo DB tạm từ database.sql + chạy 029: đủ 4 cột, không lỗi.

## Ghi chú cho người review
-
