# chore/request-id-logs

- **Mục tiêu:** Giai đoạn A (phần gateway + log + bảo mật nền): `request_id` xuyên suốt, log JSON che dữ liệu nhạy cảm, gateway chặn `/internal` và `X-User-*` giả, mật khẩu Elasticsearch, mốc đo độ trễ
- **Tạo từ:** `chore/backup` @ 64356d1 (xếp chồng: plan nằm ở nhánh đó, PR #51 chưa merge), ngày 2026-10-10. PR base = `chore/backup`
- **Trạng thái:** xong, chờ review PR
- **PR:** (chưa mở)
- **Plan:** `Plan/microservices.md` (Giai đoạn A)

## Thay đổi
- Gateway (`nginx/nginx.conf`): `X-Request-Id` sinh mới cho mọi yêu cầu (ghi đè của client), gửi backend + trả trình duyệt (một lần);
  log truy cập JSON (không query string, không IP, bỏ `/_next/static` và `/uploads`); `404` cho `/internal`, `/api/*/internal`;
  xóa `X-User-Id`/`X-User-Roles` client gửi. Sửa lỗi có sẵn: `location /` và `/socket.io/` khai báo `proxy_set_header` riêng nên mất
  `Host`/`X-Forwarded-For`/`X-Real-IP` (nginx không kế thừa) → lặp lại đủ.
- Backend: `utils/logger.ts` (nạp đầu tiên qua `config/env.ts`): mọi `console.*` thành JSON `{time, level, service, request_id, msg}`,
  tự che JWT/Bearer/mật khẩu trong URL/`password=`/email; middleware `requestContext` nhận `X-Request-Id`, ghi một dòng mỗi yêu cầu
  (chỉ đường dẫn); mã lỗi 5xx người dùng thấy = `request_id`. Bỏ `morgan`. Test `utils/logger.test.ts`.
- Elasticsearch bật mật khẩu (`ELASTIC_PASSWORD`, backend gửi Basic auth); healthcheck + `launch.py check` dùng mật khẩu.
- Gateway mặc định chỉ nghe `127.0.0.1` (`GATEWAY_BIND=0.0.0.0` để mở cho LAN).
- `scripts/bench.mjs`: đo p50/p95 trang truyện, đọc chương, API chính (mốc ghi trong plan + README).

## Migration / biến môi trường mới
- `ELASTIC_PASSWORD` (bắt buộc, `launch.py` tự sinh), `GATEWAY_BIND` (mặc định `127.0.0.1`), `SERVICE_NAME` (compose đặt cho worker).

## Đã kiểm tra
- Typecheck backend + frontend, `yarn test` backend (có test che dữ liệu), `nginx -t`, build backend/worker/export-worker.
- `X-Request-Id` trả về đúng một lần; client gửi `X-Request-Id` giả bị thay; `/api/v1/internal/x`, `/internal` → 404.
- Dừng PgBouncer → API 500 "Lỗi hệ thống… (mã 0c5e…)"; tìm mã trong log backend ra dòng lỗi + dòng request cùng mã.
- ES: không mật khẩu → 401; backend đánh index 100 truyện, tìm kiếm qua ES chạy; `launch.py check` qua hết.
- Gateway chỉ còn `127.0.0.1:3000`.

## Ghi chú cho người review
- **Đổi hành vi:** máy khác trong LAN không vào được web nữa trừ khi đặt `GATEWAY_BIND=0.0.0.0` (theo plan: cổng chỉ nghe máy/tunnel).
- Volume `es_data` cũ: mật khẩu `elastic` lấy từ `ELASTIC_PASSWORD` ở lần chạy đầu có bảo mật; đổi `.env` sau đó không tự đổi mật khẩu.
