# feat/identity-cutover

- **Mục tiêu:** Giai đoạn B, nhánh 2: chuyển hẳn đăng nhập sang service identity (gateway `auth_request`, backend đọc header ký + bản sao, frontend dùng cookie/refresh/CSRF)
- **Tạo từ:** `feat/identity-service` (xếp chồng trên #53 → #52 → #51), ngày 2026-10-10. PR base = `feat/identity-service`
- **Trạng thái:** đã chuyển và thử trên máy local; chờ chủ dự án duyệt giao diện
- **PR:** https://github.com/amthls/nmv/pull/54 (bản nháp)
- **Plan:** `Plan/identity.md` (nhánh 2)

## Thay đổi
- Gateway: `auth_request` → `identity /internal/verify` cho mọi `/api/v1/*` và `/socket.io/` (tắt cho trang web, ảnh, identity);
  gắn `X-User-Id/Roles/Exp/Sig`; `/api/identity/*` → identity (giới hạn tần suất riêng cho đăng nhập/đăng ký/mail); 403 CSRF và
  identity không trả lời → JSON.
- Backend: `auth.middleware` chỉ tin header có chữ ký HMAC (`AUTH_HEADER_KEY`), vai trò từ header, hồ sơ từ bảng `users` (bản sao);
  đọc xuyên `identity /internal/users/:id` khi sự kiện chưa tới. Worker nhận `identity.user.*` (inbox `processed_events` + so phiên bản,
  thử lại 5 lần qua hàng chờ 10 s, rồi `backend.identity.dlq`) và `identity.alert` (thông báo cho Admin). Xóa tài khoản: backend ẩn danh hồ sơ,
  rời nhóm, bỏ theo dõi, `purge_content`. `GET /internal/users/:id/delete-check` (không xóa Trưởng nhóm duy nhất).
  Bỏ API `/auth/login|register|logout|logout-all|change-password|forgot-password|reset-password|verify-email|resend-verification`,
  `/users/admin/all`, `/users/:id/roles|ban|unban`, `DELETE /users/:id`; email không còn trong phản hồi backend. Socket xác thực bằng header ký.
  Bỏ `JWT_SECRET`/`jsonwebtoken` khỏi đường đăng nhập.
- Frontend: `lib/session.ts` (cookie, `X-CSRF-Token`, 401 → refresh một lần rồi thử lại); `AuthContext` không token, không `localStorage` token
  (chỉ cache tên/ảnh, không email); đăng nhập/đăng ký/đăng xuất/quên/đặt lại/xác thực qua `/api/identity`; tab Bảo mật thêm **danh sách thiết bị**
  (đăng xuất từng thiết bị); quản trị (phân quyền, khóa, mở khóa, xóa) **hộp thoại nhập lại mật khẩu**; email người dùng cho staff lấy từ identity;
  upload ảnh/trang manga gửi CSRF + làm mới khi 401; socket làm mới phiên rồi kết nối lại; gợi ý: `sendBeacon` → `fetch keepalive`; mật khẩu tối thiểu 8.
- `scripts/migrate.sh` + `launch.py` chạy `identity import-legacy` (chỉ thêm tài khoản còn thiếu). `scripts/auth-smoke.py`: kiểm tra bảo mật qua gateway.
- README, CLAUDE.md (lệnh gọi API như người dùng, bẫy mới).

## Migration / biến môi trường mới
- `sql/migrations/022_identity_copy.sql` (019–021 đã dùng ở #50): `users.email`/`password_hash` cho phép NULL, `users.identity_version`,
  bảng `processed_events`. Cột cũ chưa xóa (đường lui), xóa ở nhánh sau khi xác nhận.
- Bỏ `JWT_SECRET`, `JWT_EXPIRES_IN`. Backend + worker cần `AUTH_HEADER_KEY`, `IDENTITY_INTERNAL_URL` (compose đặt sẵn).

## Đã kiểm tra
- Typecheck backend + frontend, test backend (header ký, giả mạo, hết hạn, auth nội bộ), test Go của identity.
- Chuyển trên máy local: backup trước, `migrate.sh` (snapshot + 022 + import 212/212 tài khoản, 221 vai trò, 1 token), build, `up`, reload gateway.
- `scripts/auth-smoke.py --admin admin --admin-password …` qua gateway: 23/23 qua (đăng ký, cookie, backend thấy người dùng mới qua đọc xuyên,
  ghi không CSRF → 403, giả `X-User-*` qua gateway và thẳng backend → khách, `/internal` 404, người thường không xem được email người khác,
  xoay vòng refresh, dùng lại refresh cũ → thu hồi cả phiên, đăng xuất, khóa tạm sau 5 lần sai, admin tìm theo email, khóa với mật khẩu sai → 403,
  khóa → bản sao backend cập nhật qua sự kiện, xóa).
- Các trang `/`, `/tai-khoan`, `/quen-mat-khau`, `/dat-lai-mat-khau`, `/xac-thuc-email`, `/nguoi-dung/admin`, trang truyện: 200.
- **Chưa thử trên trình duyệt** (tiện ích Chrome không kết nối): cần chủ dự án xem giao diện.
- Tài khoản thử đã xóa (xóa mềm, còn dòng "Người dùng đã xóa").

## Ghi chú cho người review
- Mọi người phải đăng nhập lại một lần sau khi chuyển (token JWT cũ không còn được nhận).
- Socket đang mở không bị đóng khi người dùng tự "đăng xuất mọi thiết bị" (chỉ khi bị khóa/xóa); lần kết nối lại bị từ chối.
- Tài khoản mẫu vẫn mật khẩu `password123` (đăng nhập được vì là mật khẩu cũ; đặt mới phải theo quy tắc mới).
