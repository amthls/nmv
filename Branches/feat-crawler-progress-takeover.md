# feat/crawler-progress-takeover

- **Mục tiêu:** Crawler: xem tiến trình/lỗi (--status), bật lại thì tắt crawler cũ đang chạy
- **Tạo từ:** `origin/main` @ 4627e05, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (chưa mở)
- **Plan:** (Plan/<tên>.md nếu có)

## Thay đổi
- scripts/crawler.py: ghi tiến trình vào logs/crawler-status.json (nhập/bỏ qua/lỗi theo nguồn, truyện đang xử lý, 8 lỗi gần nhất), dòng `progress x/y` trong log, tóm tắt lỗi cuối lượt, lệnh `--status`.
- Bật crawler khi crawler khác còn chạy: kiểm tra đúng là crawler.py (tránh PID bị tái sử dụng), tắt cái cũ (taskkill /T /F hoặc SIGTERM) rồi chạy tiếp. `--dry-run` không tắt ai, không khóa.
- Chỉ xóa lock nếu lock là của mình (crawler cũ không xóa nhầm lock của crawler mới).
- scripts/README.md ghi lại.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Chạy thật: crawler A (delay 6) đang chạy, bật crawler B -> A biến mất (log A không có `done`), B chạy xong 2 truyện, lock được dọn; `--status` hiện RUNNING/DONE đúng.
- Truyện A đang dở lúc bị tắt: DB không dính (ghi trong một transaction), chỉ có thể còn thư mục ảnh mồ côi.

## Ghi chú cho người review
-
