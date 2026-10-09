# Kế hoạch: Vá bảo mật (mục 2–8 trong báo cáo 2026-10-09)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Nhánh: `security/hardening` (cherry-pick từ `feat/scale-phase1`, vì commit ở đó bị push sau khi PR #13 đã merge). Mục 1 (mật khẩu `password123` của tài khoản mẫu) **chưa làm, chờ chủ dự án quyết**.

## Checklist

### 2. pgAdmin
- [x] compose: cổng `127.0.0.1:${PGADMIN_PORT}`, `PGADMIN_DEFAULT_PASSWORD: ${...:?}` (bỏ mặc định `admin`)
- [x] launch.py: .env cũ thiếu/`admin` → tự sinh; .env mới sinh ngẫu nhiên. `.env.example`, CI `.env` cập nhật

### 3. Mật khẩu Postgres
- [x] compose: `${POSTGRES_PASSWORD:?}` ở mọi chỗ (postgres, pgbouncer, backend, worker, export-worker), bỏ `:-postgres`
- [x] Đổi trên DB đang chạy: `ALTER USER postgres PASSWORD '<hex>'`, ghi `.env` (cả `DATABASE_URL` cho chạy ngoài Docker), restart pgbouncer/backend/workers
- [x] launch.py: .env có `postgres`/thiếu → sinh mật khẩu mới, sau khi Postgres chạy thì `ALTER USER` qua `docker compose exec` (socket nội bộ, không cần mật khẩu cũ) rồi restart các service phụ thuộc
- [x] `.env.example`, CI `.env`

### 4. Không lộ lỗi DB ra trình duyệt — ĐÃ CÓ SẴN, báo cáo trước nhầm
`maskServerErrors` (security.ts) đã che mọi 5xx khi production (Docker luôn production), kèm mã tra log. Đã thử: tắt pgbouncer → trình duyệt chỉ thấy "Lỗi hệ thống... (mã xxxx)". Wrapper thêm vào server.ts bị gỡ lại (trùng).
- [x] server.ts: bọc `res.json` — status ≥ 500 thì ghi log thông báo gốc, trả câu chung "Lỗi máy chủ, vui lòng thử lại sau." (một chỗ, phủ ~80 handler)
- [x] Global error handler: 500 không trả `err.message`

### 5. HTTPS-ready
- [x] Cookie `Secure` theo `req.secure` (trust proxy + X-Forwarded-Proto) hoặc `COOKIE_SECURE=true`, thay vì `NODE_ENV`
- [x] nginx: HSTS chỉ gửi khi `X-Forwarded-Proto: https`
- [x] compose: service `cloudflared` (profile `tunnel`, `CLOUDFLARE_TUNNEL_TOKEN`) → cách bật HTTPS nhanh nhất; README hướng dẫn

### 6. Thu hồi token
- [x] Migration 015: `users.tokens_valid_after timestamptz`
- [x] requireAuth / optionalAuth / socket: token có `iat` < `tokens_valid_after` → coi như hết hạn
- [x] `POST /auth/logout-all` (đăng xuất mọi thiết bị)

### 7. Đổi / quên mật khẩu, xác thực email
- [x] Migration 015: bảng `auth_tokens(token_hash, user_id, purpose, expires_at, used_at)` — chỉ lưu SHA-256 của token
- [x] `services/mailer.ts`: nodemailer qua `SMTP_URL`, `MAIL_FROM`, `SITE_URL`; không cấu hình SMTP thì ghi link vào log backend
- [x] `POST /auth/change-password` (cần mật khẩu cũ; thu hồi token cũ, cấp cookie mới)
- [x] `POST /auth/forgot-password` (luôn trả cùng một câu, chống dò email; rate limit) + `POST /auth/reset-password` (token 1 giờ, dùng 1 lần, thu hồi token đăng nhập cũ)
- [x] `POST /auth/verify-email` + `POST /auth/resend-verification`; đăng ký xong tự gửi mail; `/auth/me` trả `email_verified`
- [x] Frontend: `/quen-mat-khau`, `/dat-lai-mat-khau`, `/xac-thuc-email`; link "Quên mật khẩu?" trong form đăng nhập; tab "Bảo mật" ở `/tai-khoan` (đổi mật khẩu, trạng thái email + gửi lại, đăng xuất mọi thiết bị)

### 8. Container không chạy root + CSP
- [x] backend: entrypoint chạy bằng root chỉ để sửa quyền thư mục ghi (`uploads`, `exports`, `.cache`) khi user `node` không ghi được, rồi `setpriv` xuống `node`
- [x] frontend: `USER node` (chown `.next`)
- [x] CSP trong `next.config.mjs` (script/style 'self' + 'unsafe-inline' vì Next chèn script inline; img https:; connect 'self' + ws/wss; object-src 'none'; frame-ancestors 'self'); thử trên Chrome không có vi phạm CSP

### Hoàn tất
- [x] Typecheck 2 bên, `docker compose up -d --build`, migrate, thử từng mục
- [x] README (biến môi trường mới, API mới, trang mới, lộ trình bảo mật, hạn chế đã biết)
- [x] Commit + push, CI xanh

## Ghi chú
- `.env` dùng mật khẩu hex để khỏi phải escape trong URL.
- Docker Desktop (Windows): thư mục bind mount báo chủ sở hữu root nhưng quyền 777 → kiểm tra "ghi được không" thay vì "ai sở hữu", tránh `chown -R` mỗi lần khởi động.
- nginx tin `CF-Connecting-IP` từ 172.16.0.0/12 → container cloudflared trong mạng Docker được tin đúng.
