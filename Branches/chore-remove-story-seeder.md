# chore/remove-story-seeder

- **Mục tiêu:** Bỏ seeder truyện mẫu cũ, crawler lo phần truyện
- **Tạo từ:** `origin/main` @ 824cd4b, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** không có

## Thay đổi
- Xóa `catalog/scripts/seed-stories.ts` (8 truyện mẫu, chương không có nội dung/phiên bản workspace; chạy trước crawler ở máy cài mới,
  `--seed` ghi đè chỉnh sửa trên các truyện đó).
- `launch.py`: bỏ `SEEDERS`, `run_seeders`, `story_count`, cờ `--seed`/`--no-seed`; giữ `identity seed-demo` (tài khoản mẫu).
  Truyện mẫu chỉ còn do `scripts/crawler.py` nhập (chia cho các nhóm dịch, PR #101).
- `scripts/README.md`, docstring `launch.py`, thông báo lỗi crawler: cập nhật theo.

## Migration / biến môi trường mới
- Không có. Truyện đã có trong DB không bị đụng.

## Đã kiểm tra
- `python launch.py check`: tất cả check xanh.

## Ghi chú cho người review
- Ai còn gõ `--seed`/`--no-seed` sẽ bị argparse báo lỗi tham số lạ.
