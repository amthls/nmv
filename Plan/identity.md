# Giai đoạn B: service identity (Go)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Thiết kế chung: `Plan/microservices.md` (mục Phiên/cookie, Mail, Bảo mật, Nhất quán dữ liệu). File này là cách làm cụ thể.

## Quyết định (2026-10-10)
- **identity là chủ**: tên đăng nhập, email, mật khẩu, xác thực email, vai trò site, khóa/xóa tài khoản, phiên đăng nhập,
  token tài khoản (đặt lại mật khẩu, xác thực email), nhật ký bảo mật, mail tài khoản.
- **Hồ sơ hiển thị** (tên hiển thị, ảnh, banner, giới thiệu) và **cài đặt đọc** tạm ở lại backend (đã có code, form, ảnh qua upload).
  Chuyển sang identity ở bước sau nếu cần; identity không cần chúng để xác thực.
- **Backend giữ bảng `users` làm bản sao** (lệch plan chung: không đổi tên thành `ext_user_profiles`). Lý do: hàng trăm truy vấn
  JOIN `users` + khóa ngoại `uploader_id REFERENCES users(id)`… Viết lại hết là rủi ro lớn mà không được gì.
  Bản sao cập nhật từ sự kiện `identity.user.*`; cột nhạy cảm (`password_hash`, `email`, `tokens_valid_after`) **bị xóa khỏi backend**
  sau khi chuyển. `user_roles` ở backend cũng thành bản sao (đọc nhiều để hiện huy hiệu vai trò).
- Đọc xuyên khi bản sao chưa kịp có người dùng mới (sự kiện trễ vài ms–s): backend gọi `GET identity /internal/users/:id` rồi ghi bản sao.
- **Token:** truy cập = JWT HS256 15 phút `{sub, sid}` trong cookie `nh_access` (httpOnly, Lax, path `/`); làm mới = chuỗi ngẫu nhiên
  32 byte trong `nh_refresh` (httpOnly, Strict, path `/api/identity`), 30 ngày, **xoay vòng** mỗi lần dùng, chỉ lưu băm.
  Dùng lại token làm mới cũ (ngoài 30 giây ân hạn cho nhiều tab) → thu hồi cả phiên. `nh_csrf` (JS đọc được) gửi lại qua header
  `X-CSRF-Token` cho mọi request ghi. **Không token nào trong `localStorage`.**
- **Gateway `auth_request`** → `identity /internal/verify` cho `/api/v1/*` và `/socket.io/`: đọc `nh_access`, kiểm tra chữ ký, phiên bị thu hồi
  (Redis `revoked:{sid}`), CSRF cho request ghi; trả `X-User-Id`, `X-User-Roles`, `X-User-Sig` (HMAC bằng `AUTH_HEADER_KEY`, có hạn 2 phút).
  Không đăng nhập/token hết hạn → 200 không có header (backend coi là khách; API cần đăng nhập trả 401 → frontend gọi refresh rồi thử lại).
  Backend **chỉ tin header khi chữ ký đúng** (chống mọi đường lách gateway). Thiếu CSRF → 403.
- Gateway: `/api/identity/*` → identity (bỏ tiền tố); `/internal` vẫn 404 từ ngoài.
- Mật khẩu: **argon2id** (m=19 MiB, t=2, p=1, theo OWASP); băm bcrypt cũ được nhận và **đổi sang argon2id khi đăng nhập**.
  Mật khẩu mới: ≥ 8 ký tự, ≤ 128, không nằm trong danh sách mật khẩu phổ biến (nhúng sẵn), không trùng tên đăng nhập/email.
  Sai 5 lần/15 phút cho một tài khoản → khóa tạm 15 phút (ngoài giới hạn theo IP ở gateway).
- **Thao tác nguy hiểm nhập lại mật khẩu:** đổi vai trò, khóa/mở khóa, xóa tài khoản, thu hồi mọi phiên toàn hệ thống.
- **Sự kiện:** outbox trong `identity_db` → exchange topic `novelhub.events` (bền, xác nhận) → routing key `identity.user.created|updated|deleted`.
  Sự kiện mang ảnh chụp công khai `{id, version, username, display_name, roles[{role,is_visible}], is_banned, ban_reason, banned_at,
  banned_by, deleted_at, created_at}` (**không email**). Backend nhận trong worker: inbox (event_id) + chỉ áp dụng `version` mới hơn.
- **Mail tài khoản** gửi từ identity: `mail_outbox` ghi cùng transaction với token → goroutine gửi, thử lại chờ tăng dần ~1 giờ,
  hỏng hẳn → đánh dấu + sự kiện `identity.alert` (backend tạo thông báo cho Admin). Mail mới: "mật khẩu vừa đổi".
- Nhật ký bảo mật `security_log` (đăng nhập đúng/sai, khóa tạm, đổi mật khẩu, đổi vai trò, khóa tài khoản, thu hồi phiên; IP + trình duyệt),
  giữ 90 ngày. Sai mật khẩu hàng loạt (> 50 lần/10 phút toàn hệ thống) → `identity.alert`.
- Database riêng `identity_db`, user Postgres riêng `identity` (`IDENTITY_DB_PASSWORD`), không đọc được `novel_platform`.
  Migration của service ở `services/identity/migrations/`, `scripts/migrate.sh` + `launch.py` chạy cho mọi `services/*/migrations`.
- **Chuyển dữ liệu một lần:** lệnh `identity import-legacy` đọc `novel_platform.users/user_roles/auth_tokens` (chỉ đọc, user superuser
  chỉ dùng lúc chuyển), ghi vào `identity_db` (giữ nguyên UUID, băm bcrypt), idempotent. Phiên cũ (JWT 30 ngày) **hết hiệu lực**: mọi người
  đăng nhập lại một lần.
- Để sau (ghi ở plan chung): Turnstile (cần khóa Cloudflare của chủ dự án), đổi email, xác thực 2 lớp, chặn tài khoản chưa xác thực.

## Chia nhánh
1. `feat/identity-service`: service + DB + migration + mọi API + test; chạy trong compose nhưng **chưa nhận traffic** (không đổi gì cho người dùng).
2. `feat/identity-cutover`: chuyển dữ liệu, gateway `auth_request` + định tuyến, backend đọc header + bản sao + bỏ API auth cũ,
   frontend dùng cookie/refresh/CSRF, socket, test bảo mật.

## Checklist: nhánh 1 `feat/identity-service`
- [x] Hạ tầng DB theo service: container một-lần `db-init` (`postgres/provision.sh`, chạy mỗi lần `up`, nên launch/CI/migrate đều có) tạo role +
      database `<svc>_db`; service tự chạy migration nhúng lúc khởi động (một transaction + khóa); secrets tự sinh; backup đã dump mọi database
- [x] Schema `identity_db`: users, user_roles, sessions, refresh_tokens, account_tokens, security_log, outbox, mail_outbox
- [x] Go: cấu hình, log JSON + che dữ liệu (cùng quy tắc TS), `/health` + `/ready`, `X-Request-Id`
- [x] Mật khẩu: argon2id + nhận bcrypt cũ + đổi băm khi đăng nhập; kiểm tra mật khẩu yếu; khóa tạm
- [x] Phiên + token: đăng nhập, đăng ký, làm mới (xoay vòng, phát hiện dùng lại), đăng xuất, đăng xuất mọi thiết bị, danh sách thiết bị
- [x] `/internal/verify` (JWT + Redis `revoked:` + CSRF + chữ ký header), `/internal/users/:id`
- [x] Token tài khoản + mail: quên/đặt lại mật khẩu, xác thực email, gửi lại; đổi mật khẩu (+ mail báo); `mail_outbox` + goroutine gửi
- [x] Quản trị: vai trò, khóa/mở khóa, xóa (ẩn danh), tra cứu theo email (Admin/Mod), nhập lại mật khẩu; thu hồi mọi phiên toàn hệ thống (Admin)
- [x] Outbox → RabbitMQ `novelhub.events` (xác nhận), sự kiện `identity.user.*`, `identity.alert`; JSON Schema trong `events/`
- [x] Nhật ký bảo mật + dọn 90 ngày + cảnh báo sai mật khẩu hàng loạt
- [x] `import-legacy`
- [x] Test Go (băm, token, xoay vòng/dùng lại, CSRF, chữ ký, mật khẩu yếu, khóa tạm) + test tích hợp với Postgres/Redis thật
- [x] Dockerfile (`scratch`, user nobody), compose `identity` (mạng `edge` + `data`, `mem_limit`), CI build/test thư mục `services/identity`
- [x] README, Branches, PR

## Checklist: nhánh 2 `feat/identity-cutover`
- [x] Backend: middleware đọc `X-User-*` + kiểm chữ ký; consumer `identity.user.*` → `users`/`user_roles` (inbox + version); đọc xuyên
- [x] Backend: bỏ API `/auth/*` cũ, quản trị người dùng gọi sang identity; migration bỏ cột nhạy cảm + `auth_tokens`
- [x] Gateway: `auth_request` cho `/api/v1/` + `/socket.io/`, định tuyến `/api/identity/`
- [x] Frontend: AuthContext không token, refresh khi 401, header CSRF, đường dẫn mới; socket; upload XHR; trang quên/đặt lại/xác thực;
      tab Bảo mật: danh sách thiết bị; quản trị: nhập lại mật khẩu
- [x] Chuyển dữ liệu thật + thử: đăng nhập, khóa, thu hồi phiên, đặt lại mật khẩu, giả header, đổi id trên URL, CSRF, dùng lại refresh
- [x] README, Branches, PR
- [x] ~~Chủ dự án duyệt giao diện~~ (từ 2026-10-10 không duyệt nữa, tự merge: CLAUDE.md); đã chạy thật từ PR #56

## Checklist: nhánh 3 `security/drop-legacy-credentials`
Bản cài mới: `database.sql` seed tài khoản mẫu kèm mật khẩu rồi chính file đó xóa cột → `import-legacy` không còn gì để chép.
Nên tài khoản mẫu do identity tự tạo: `identity seed-demo` (chỉ khi `identity_db` chưa có tài khoản nào, nên không bao giờ thêm lại
tài khoản mẫu vào bản cài đang chạy thật).
- [x] Migration `026_drop_legacy_credentials.sql` (+ `database.sql`): xóa `users.email/password_hash/tokens_valid_after/last_login_at`, bảng `auth_tokens`
- [x] identity: `seed-demo` thay `import-legacy` (xóa `legacy.go`, `LegacyURL`); `migrate.sh`, `launch.py` gọi `seed-demo`; bỏ seeder `seed-passwords.js`
- [x] Backend: thêm thành viên nhóm chỉ theo tên đăng nhập (bản sao không còn email), `RETURNING email`, `simulateReaders` không ghi mật khẩu
- [x] Thử: migrate trên bản sao DB thật (chạy trên DB thật bị chặn, chủ dự án chạy `scripts/migrate.sh`), bản cài mới (DB trống) đăng nhập `admin`/`password123`, typecheck, go test; README, Branches; PR, tự merge

## Bẫy
- Nginx `auth_request` đặt ở cấp server phải tắt (`auth_request off`) trong chính location `/_auth`, nếu không subrequest gọi lại chính nó.
- `error_page 403 = @…` ở cấp server chỉ bắt 403 do nginx tạo (subrequest), không bắt 403 của backend (không bật `proxy_intercept_errors`).
- `sendBeacon` không gắn được header → request ghi bị chặn CSRF khi đã đăng nhập; dùng `fetch(..., { keepalive: true })`.
- `export-worker` nạp `auth.middleware` gián tiếp (qua realtime): kiểm `AUTH_HEADER_KEY` lúc khởi động API (`server.ts`), không ở cấp module.
- Script Python gọi `localhost` trên Windows chậm ~10 s/lần (gateway chỉ IPv4): dùng `127.0.0.1`.
- Thư viện Go mới (x/crypto 0.57) đòi `go 1.26` → image build `golang:1.26.8-alpine3.24`; máy local Go 1.25 tự tải toolchain.
- `docker compose up --wait` chấp nhận container một-lần (`db-init`) thoát mã 0.
- Logger TS mới (PR #52) che `token=…` nên **link đặt lại mật khẩu không còn đọc được trong log backend** khi chưa có SMTP; identity giữ mail trong
  `mail_outbox` thay vì ghi log. Sửa riêng cho backend cũ ở nhánh #52.
- Quy tắc "mật khẩu không chứa tên đăng nhập" bắt cả dữ liệu test: đừng tạo mật khẩu thử từ tên người dùng.
- PgBouncer chế độ transaction: identity nói chuyện thẳng với Postgres (không qua PgBouncer) cho tới khi PgBouncer có pool theo database.
- `auth_request` chỉ chấp nhận 2xx/401/403 từ subrequest; không gửi body → CSRF kiểm theo header + method gốc (`X-Original-Method`).
