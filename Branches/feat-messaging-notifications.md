# feat/messaging-notifications

- **Mục tiêu:** Giai đoạn E3: hộp thông báo chuyển sang service messaging
- **Tạo từ:** `origin/main` @ 5b8c589, ngày 2026-10-11
- **Trạng thái:** xong, chờ CI
- **PR:** (chưa mở)
- **Plan:** `Plan/messaging.md` (E3), `Plan/microservices.md` (giai đoạn E)

## Thay đổi
- `services/messaging`: migration `002_notifications.sql` (`notifications`, `notification_dedupe`, `notification_settings`, `broadcasts`,
  `broadcast_reads`, `legacy_imports`); `notify.go` (bảng loại → nhóm/tắt được/gộp, xử lý job: lọc cài đặt, chống trùng, gộp bằng
  `ON CONFLICT` trên chỉ mục `(user_id, group_key) WHERE read_at IS NULL`, đẩy realtime; chương mới hỏi người theo dõi từ backend; consumer
  `novel.notifications` có thử lại/DLQ; dọn mỗi giờ); `notify_api.go` (chuông, đã xem/đã đọc, cài đặt, broadcast cho Admin,
  `/internal/notifications/jobs`); `import-legacy` chép thông báo + cài đặt cũ, mỗi phần chỉ một lần.
- Backend: bỏ worker thông báo, `notification.controller` + route; `queue.service` gắn link/ảnh, lọc tắt theo bài, broker hỏng thì gửi
  thẳng messaging; loại cụ thể thay `system`; `GET /internal/stories/:id/followers`; `notifyAdmins` + workspace qua hàng đợi;
  `/users/settings` bỏ `notify_*`.
- `backup.sh`: cảnh báo Admin ghi vào `messaging_db`.
- Frontend: chuông (số chưa xem, tab, link), trang `/thong-bao` (lọc, tải thêm, xóa, cài đặt nhóm × kênh, broadcast cho Admin),
  `/tai-khoan` trỏ sang.
- Compose: messaging nhận `RABBITMQ_URL`, chờ rabbitmq.

## Migration / biến môi trường mới
- messaging_db migration 002 (tự chạy khi messaging khởi động). Không có biến môi trường mới.
- Bỏ: `NOTIFY_FANOUT_CHUNK`, `NOTIFY_FANOUT_PAUSE_MS`, `NOTIFY_MAX_ATTEMPTS`, `NOTIFY_RETRY_DELAY_MS`, `WORKER_*` (worker không còn tiêu thụ thông báo).
- Bảng cũ `notifications`, `broadcast_notifications`, cột `user_settings.notify_*` ở backend **chưa xóa** (nhánh sau, cùng bảng tin nhắn cũ).

## Đã kiểm tra
- `go vet`, `go test` messaging với Postgres (`TestNotifications`: gộp + chống trùng, chưa xem/chưa đọc, dòng đã đọc không gộp nữa,
  cài đặt tắt + loại không tắt được, chương mới gộp theo truyện và bỏ người đăng, broadcast chỉ Admin; `TestImportLegacy`: link/ảnh/nhóm,
  cài đặt, khóa chống trùng cũ, chạy lại không chép lại thứ đã xóa); `tsc` + `npm test` backend, `tsc` frontend.
- Máy thật: 126/126 thông báo cũ chuyển sang; cảm xúc của 3 người → 1 dòng gộp qua RabbitMQ; tắt Tương tác → bình luận không tới;
  chương mới → 12/12 người theo dõi (21 ms); dừng RabbitMQ → gửi thẳng messaging, bật lại tự nối; Redis nhận tín hiệu `notification`;
  backup.sh ghi cảnh báo (chống trùng); trình duyệt: chuông về 0 khi mở, tab Workspace, trang `/thong-bao`, công tắc cài đặt.

## Ghi chú cho người review
- shortcut: job từ backend thay vì sự kiện miền; người theo dõi hỏi API backend; tắt theo bài vẫn lọc ở backend (đổi ở giai đoạn F/H).
- `actor_count` có thể đếm một người hai lần nếu người đó không nằm trong 3 người gần nhất (ghi chú trong `notify.go`).
