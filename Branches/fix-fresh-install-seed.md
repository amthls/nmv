# fix/fresh-install-seed

- **Mục tiêu:** Cài mới: thêm cột stories.allow_download (migration 030) và dữ liệu mẫu (Fandom, bình luận, follow, thông báo) qua seed-demo của từng service
- **Tạo từ:** `origin/main` @ d99d65f, ngày 2026-10-13
- **Trạng thái:** xong, đã kiểm tra trên máy
- **PR:** (chưa mở)
- **Plan:** (Plan/<tên>.md nếu có)

## Thay đổi
- `sql/database.sql`: thêm cột `stories.allow_download` (thiếu từ migration 007). Thiếu cột này, bản cài mới không đọc được chương, không tạo/sửa được truyện, không tải được EPUB/PDF, crawler lỗi ở bước bật tải xuống.
- `sql/migrations/030_allow_download_repair.sql`: sửa các máy đã cài mới (007 bị ghi nhận là đã chạy nhưng thực ra chưa chạy).
- Bỏ khối INSERT follow/thông báo/bài Fandom/bình luận/báo cáo trong `database.sql`: phần 027 cuối file xóa các bảng đó trước khi service kịp chép, nên bản cài mới trống.
- Dữ liệu mẫu chuyển vào `services/{library,messaging,community}/seed/demo.sql` (theo schema của từng service). `launch.py` và `scripts/migrate.sh` nạp sau `import-legacy`; mỗi file chỉ chạy một lần (`legacy_imports.part = 'demo'`) và chỉ vào DB còn trống.
- README: thêm ghi chú về dữ liệu mẫu.

## Migration / biến môi trường mới
- `030_allow_download_repair.sql` (idempotent)

## Đã kiểm tra
- So schema của DB sạch tạo từ `database.sql` mới với DB đang chạy (cột, index, ràng buộc, trigger, hàm): không còn khác biệt.
- DB sạch tạo từ `database.sql` cũ, chạy 030 hai lần: có cột, lần 2 bỏ qua.
- DB trống của community/messaging/library, nạp seed 2 lần: 3 bài (mã P-DS-26-000x, đếm reaction/bình luận đúng), 8 reaction, 5 bình luận, 1 báo cáo; 6 thông báo, 2 thông báo chung; 8 follow, không trùng. Xóa bài rồi nạp lại: bài không quay lại.
- `python launch.py check --no-crawl` trên máy đang chạy: tất cả đạt, 030 đã chạy, seed bỏ qua vì DB đã có dữ liệu (community vẫn 24 bài).

## Ghi chú cho người review
-
