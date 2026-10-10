# chore/foundation-gaps

- **Mục tiêu:** Đồng bộ checklist microservices; phần nền móng còn thiếu: quy tắc schema, trang lỗi gateway, phát lại sự kiện, đối soát
- **Tạo từ:** `origin/main` @ 9ef3bdb, ngày 2026-10-10
- **Trạng thái:** xong, chờ CI
- **PR:** (chưa mở)
- **Plan:** `Plan/microservices.md` (giai đoạn A)

## Thay đổi
- `Plan/microservices.md`: đánh dấu phần đã làm (giai đoạn B identity, C workspace, phần lớn A), ghi rõ phần bỏ/hoãn và lý do.
- `identity republish [user-id]`, `workspace republish [chapter-id]`: phát lại ảnh chụp hiện tại qua outbox (không tăng version) để dựng lại bản sao.
- `GET /internal/stats` ở identity và workspace (số dòng, tổng version, outbox chưa gửi).
- Worker backend: job đối soát 6 giờ/lần (`backend/src/services/reconcile.ts`): lệch bản sao, outbox dồn, hàng `.dlq` có tin → thông báo Admin
  (`notifyAdmins` tách từ xử lý `identity.alert`).
- Gateway: 502/504 → 503 có mã yêu cầu (trang HTML cho web, JSON cho `/api/`).
- `seed-demo` phát `identity.user.created` để bản sao của bản cài mới khớp.
- README: mục "Sự kiện giữa các service" (đường đi, tên, quy tắc đổi schema, phát lại, đối soát).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `go test` identity + workspace (tích hợp với Postgres thật): stats, republish (mọi sự kiện phát lại khớp schema), seed-demo phát sự kiện.
- `tsc` backend. Chạy thật: đối soát phát hiện lệch (212 tài khoản chuyển bằng import-legacy chưa có sự kiện) → thông báo Admin;
  `identity republish` (234 sự kiện) → đối soát lại sạch.
- Gateway: dừng workspace → `/api/ws/*` trả 503 JSON có mã; dừng frontend → trang 503 HTML; bật lại → 200.

## Ghi chú cho người review
- Máy chạy thật cần chạy `docker compose run --rm identity republish` một lần sau khi cập nhật (bản sao cũ chưa có version).
