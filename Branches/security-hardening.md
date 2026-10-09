# security/hardening

- **Mục tiêu:** Vá bảo mật: mật khẩu ngẫu nhiên bắt buộc, thu hồi token, đổi/quên mật khẩu, xác thực email, HTTPS-ready, container không chạy root, CSP.
- **Tạo từ:** `origin/main` @ 5e4dd41, ngày 2026-10-09 (cherry-pick commit `2f8a3af`, vốn bị push vào `feat/scale-phase1` sau khi PR #13 đã merge)
- **Trạng thái:** đã gộp vào `chore/bundle-pending-work` (PR cũ đóng)
- **PR:** https://github.com/amthls/nmv/pull/36
- **Plan:** `Plan/security-hardening.md`

## Thay đổi
- **Mật khẩu hệ thống:** `POSTGRES_PASSWORD`, `PGADMIN_DEFAULT_PASSWORD` bắt buộc (không còn mặc định `postgres`/`admin`); pgAdmin chỉ nghe `127.0.0.1`. `launch.py` tự thay mật khẩu mặc định trong `.env` cũ và áp vào volume Postgres bằng `ALTER USER`.
- **Thu hồi token:** cột `users.tokens_valid_after`; `requireAuth`, `optionalAuth`, socket từ chối token cấp trước mốc đó. `POST /auth/logout-all`.
- **Tài khoản:** `POST /auth/change-password`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`. Bảng `auth_tokens` chỉ lưu SHA-256 của token một lần. Mail qua `SMTP_URL` (nodemailer 7.0.13); chưa cấu hình thì link ghi vào log backend.
- **Giao diện:** `/quen-mat-khau`, `/dat-lai-mat-khau`, `/xac-thuc-email`, link "Quên mật khẩu?" trong form đăng nhập, tab **Bảo mật** ở `/tai-khoan`.
- **HTTPS-ready:** cookie tự `Secure` khi qua HTTPS, HSTS chỉ gửi cho khách HTTPS, service `cloudflared` (profile `tunnel`).
- **Container:** backend/worker/frontend chạy bằng user `node` (entrypoint chỉ dùng root để sửa quyền thư mục mount rồi hạ quyền). CSP cho các trang.

## Migration / biến môi trường mới
- `sql/migrations/015_account_security.sql` (đã chép vào `sql/database.sql`)
- Bắt buộc: `POSTGRES_PASSWORD`, `PGADMIN_DEFAULT_PASSWORD`. Tùy chọn: `SMTP_URL`, `MAIL_FROM`, `SITE_URL`, `COOKIE_SECURE`, `CLOUDFLARE_TUNNEL_TOKEN`.
- **Server deploy:** thêm `POSTGRES_PASSWORD` (đúng mật khẩu hiện tại của DB, hoặc đổi bằng `ALTER USER`) và `PGADMIN_DEFAULT_PASSWORD` vào `.env` trước khi deploy, nếu không compose sẽ dừng.

## Đã kiểm tra
- Typecheck 2 bên; CI xanh trên commit gốc `2f8a3af` (typecheck + smoke).
- Mật khẩu Postgres cũ bị từ chối từ container khác, mật khẩu mới vào được; app chạy bình thường.
- Luồng tài khoản (tài khoản test, đã xóa): đăng ký gửi mail xác thực; xác thực dùng một lần; đổi mật khẩu → token cũ 401, token mới 200; quên mật khẩu trả cùng câu cho email có/không có; đặt lại → token cũ 401, mật khẩu cũ sai, mới đúng; đăng xuất mọi thiết bị → 401; socket từ chối token cũ; DB không chứa token gốc.
- 4 container app chạy UID 1000; ghi được `uploads`, `exports`, `.cache`.
- HSTS chỉ có khi `X-Forwarded-Proto: https`; CSP không chặn ảnh, font, CKEditor (thử trên Chrome).
- Tắt PgBouncer: trình duyệt chỉ nhận câu lỗi chung (che lỗi 5xx vốn đã có sẵn, không đổi).

## Ghi chú cho người review
- Tài khoản mẫu vẫn dùng `password123` (chưa đổi, chờ chủ dự án quyết).
- Frontend vẫn giữ một bản token trong `localStorage` bên cạnh cookie `httpOnly`; CSP giảm rủi ro XSS nhưng chưa loại bỏ.
