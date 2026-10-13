# fix/ws-origin-port

- **Mục tiêu:** WebSocket realtime bị 403 khi vào site qua cổng :3000 (nginx bỏ cổng khỏi Host)
- **Tạo từ:** `origin/main` @ 0f78921, ngày 2026-10-13
- **Trạng thái:** xong, đã kiểm tra trên máy
- **PR:** (chưa mở)
- **Plan:** (Plan/<tên>.md nếu có)

## Thay đổi
- `nginx/nginx.conf` block `/api/msg/ws`: `Host $host` → `Host $http_host` (giữ cổng). Thư viện WebSocket của messaging (`websocket.Accept` ở `hub.go:146`) so Origin với Host; `$host` bỏ cổng nên khi vào bằng `http://máy:3000` bị 403, thông báo/tin nhắn mất realtime, chỉ còn hỏi định kỳ.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `nginx -t` + reload. Đăng nhập reader_hana qua :3000, bắt tay WebSocket: Origin `http://127.0.0.1:3000` → 101 (trước là 403), Origin không cổng → 403, Origin site lạ → 403 (vẫn chặn khác nguồn).

## Ghi chú cho người review
-
