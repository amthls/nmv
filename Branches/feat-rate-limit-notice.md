# feat/rate-limit-notice

- **Mục tiêu:** 429: server báo thời gian chờ, giao diện đếm ngược, GET tự thử lại một lần
- **Tạo từ:** `origin/main` @ 7d6f634, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/load.md` (A6, B4)

## Thay đổi
- `nginx/nginx.conf`: `error_page 429 = @too_many` (JSON tiếng Việt + `Retry-After: 2`) cho chặn theo IP của nginx; 429 của service đi thẳng qua.
- `services/community/src/auth.ts`: 429 có `Retry-After` + `retry_after_seconds` như catalog.
- Mới `frontend/src/components/common/RateLimitNotice.tsx` (gắn trong layout): bắt 429 cùng origin của mọi `fetch`, hiện thông báo đếm ngược;
  GET chờ ≤ 5 s thì gửi lại một lần; thao tác ghi không tự gửi lại.

## Migration / biến môi trường mới
- Không có. nginx: `docker exec novel_gateway nginx -s reload` (đã chạy).

## Đã kiểm tra
- `npx tsc --noEmit` (frontend, community), `yarn test` community, `nginx -t`, `check-nav.sh`.
- Chrome: 120 XHR dồn → 429 có `Retry-After: 2` và câu tiếng Việt; 150 fetch dồn: 125 qua (có gửi lại), 25 vẫn 429; thông báo đếm ngược hiện.

## Ghi chú cho người review
- Identity / messaging (Go) chưa gửi `Retry-After` (thông báo vẫn hiện, đếm 2 s mặc định).
