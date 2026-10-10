# security/drop-legacy-credentials

- **Mục tiêu:** Xóa cột mật khẩu/email/token cũ khỏi DB backend (identity là chủ); tài khoản mẫu do identity seed-demo tạo
- **Tạo từ:** `origin/main` @ 9ef3bdb, ngày 2026-10-10
- **Trạng thái:** xong, chờ CI
- **PR:** https://github.com/amthls/nmv/pull/63
- **Plan:** `Plan/identity.md` (nhánh 3)

## Thay đổi
- Migration `026_drop_legacy_credentials.sql` (+ cuối `sql/database.sql`): xóa `users.email`, `password_hash`, `tokens_valid_after`,
  `last_login_at`, bảng `auth_tokens`. DB backend không còn giữ băm mật khẩu.
- identity: lệnh `seed-demo` (12 tài khoản mẫu, `password123`, chỉ khi `identity_db` trống) thay `import-legacy` (xóa `legacy.go`, `LEGACY_DATABASE_URL`).
  `scripts/migrate.sh`, `launch.py` gọi `seed-demo`; bỏ seeder `backend/scripts/seed-passwords.js`.
- `launch.py`: kiểm tra đăng nhập mẫu đổi sang `/api/identity/login` (đường cũ `/api/v1/auth/login` đã bỏ từ PR #56).
- Backend: thêm thành viên nhóm chỉ theo tên đăng nhập; bỏ `RETURNING email`; `simulateReaders` không ghi email/mật khẩu.

## Migration / biến môi trường mới
- `026_drop_legacy_credentials.sql` (xóa dữ liệu không dùng; `migrate.sh` chụp backup trước khi chạy)
- Bỏ `LEGACY_DATABASE_URL`

## Đã kiểm tra
- Migration trên bản sao `pg_dump` của DB thật (chạy 2 lần, idempotent); `database.sql` trên DB trống (12 tài khoản mẫu, không còn cột).
- `seed-demo` trên `identity_db` trống: thêm 12; chạy lại: không thêm. Test tích hợp `TestSeedDemoOnlyIntoEmptyDB` (đăng nhập admin/password123).
- `go test` (cả tích hợp), `tsc` backend + frontend; build lại, đăng nhập qua gateway 200, `/api/v1/auth/me` 200, trang chủ 200.

## Ghi chú cho người review
- Migration 026 **chưa chạy trên DB local** (lệnh bị chặn vì xóa dữ liệu): chạy `sh scripts/migrate.sh` khi đồng ý.
