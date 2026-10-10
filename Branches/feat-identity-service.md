# feat/identity-service

- **Mục tiêu:** Giai đoạn B, nhánh 1: service identity (Go) + database riêng, chạy trong compose nhưng chưa nhận traffic
- **Tạo từ:** `chore/request-id-logs` @ ed6d0ce (xếp chồng trên #52 → #51; plan nằm ở đó), ngày 2026-10-10. PR base = `chore/request-id-logs`
- **Trạng thái:** xong, chờ review PR
- **PR:** (chưa mở)
- **Plan:** `Plan/identity.md` (nhánh 1), `Plan/microservices.md` (Giai đoạn B)

## Thay đổi
- `services/identity/` (Go 1.26, net/http, pgx, go-redis, golang-jwt, x/crypto, amqp091): đăng ký, đăng nhập (argon2id, nhận bcrypt cũ
  rồi đổi băm), khóa tạm sau 5 lần sai/15 phút, phiên mỗi thiết bị + cookie `nh_access`/`nh_refresh`/`nh_csrf`, làm mới xoay vòng và phát hiện
  dùng lại, đăng xuất/đăng xuất mọi nơi/thu hồi từng thiết bị, đổi/quên/đặt lại mật khẩu (+ mail "mật khẩu vừa đổi"), xác thực email,
  quản trị (vai trò, khóa, xóa, tra email, thu hồi mọi phiên) có nhập lại mật khẩu, `/internal/verify` (header ký HMAC), `/internal/users/:id`,
  nhật ký bảo mật 90 ngày + cảnh báo đăng nhập sai hàng loạt, outbox → `novelhub.events`, `mail_outbox` + gửi SMTP có thử lại, `import-legacy`.
- `events/`: JSON Schema (`envelope`, `identity.user`, `identity.alert`) + test hợp đồng.
- Container một-lần `db-init` (`postgres/provision.sh`): role + database riêng mỗi service, bỏ `CONNECT` mặc định trên `novel_platform`.
- Compose: `db-init`, `identity` (mạng `edge` + `data`, `mem_limit` 128m, healthcheck). CI: job `identity` (gofmt, vet, test với Postgres/Redis),
  quét image identity bằng Trivy, `.env` thử có biến mới. `launch.py` tự sinh biến mới.

## Migration / biến môi trường mới
- Database mới `identity_db` (tự tạo bởi `db-init`, bảng do service tạo). Không đổi `novel_platform` (chỉ bỏ quyền CONNECT của PUBLIC).
- `IDENTITY_DB_PASSWORD`, `IDENTITY_JWT_SECRET`, `AUTH_HEADER_KEY` (bắt buộc, `launch.py` tự sinh).

## Đã kiểm tra
- `gofmt`, `go vet`, test đơn vị (băm, mật khẩu yếu, JWT kể cả `alg=none`/hết hạn/sai khóa, chữ ký header, CSRF, quy tắc quyền, che log).
- Test tích hợp với Postgres + Redis thật và chỉ Postgres: đăng ký/đăng nhập/me, CSRF bắt buộc khi ghi, xoay vòng + nhiều tab + dùng lại → thu hồi,
  khóa tạm, `/internal/verify` (khách, đã đăng nhập, thiếu CSRF), đăng xuất mọi nơi, khóa tài khoản thu hồi phiên ngay, mod không động được admin,
  xóa tài khoản phát `user.deleted` + `purge_content`, bcrypt → argon2id, quên/đặt lại mật khẩu, mọi sự kiện khớp schema.
- `import-legacy` vào DB thử: 212/212 người dùng, 221/221 vai trò, chạy lại không thêm; đăng nhập `admin` bằng mật khẩu cũ → đổi sang argon2id.
- Compose: `db-init` tạo `identity_db`; role `identity` bị từ chối khi vào `novel_platform`; identity healthy, ~24 MB; `/ready` ok;
  từ ngoài gateway chưa vào được; `docker compose up --wait` thành công; web vẫn chạy như cũ.

## Ghi chú cho người review
- Chưa ai dùng service này: chuyển hẳn (gateway, backend, frontend, chuyển dữ liệu) ở nhánh `feat/identity-cutover`.
- Hồ sơ hiển thị (tên, ảnh, giới thiệu) và cài đặt đọc tạm ở lại backend (ghi trong plan).
