# security/catalog-write-quota-per-user

- **Mục tiêu:** Hạn mức ghi catalog theo người dùng (phút + giờ), không chặn chung một IP
- **Tạo từ:** `origin/main` @ a450866, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/load.md` (B2)

## Thay đổi
- `catalog/src/middlewares/security.ts`: `writeLimiter` (120/phút) đếm theo tài khoản (header ký đã kiểm), khách theo IP;
  mới `writeHourLimiter` 600/giờ, không tính tự lưu nháp `PUT /drafts/:id`.
- `catalog/src/server.ts`: gắn `writeHourLimiter`.
- README mục chống lạm dụng: hạn mức ghi của catalog và workspace.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit`, `yarn test` (10/10).
- 120 `POST /stories` rỗng (400, không tạo gì) của một tài khoản qua, lần 121 → 429 `Retry-After: 59`; tài khoản khác cùng IP vẫn được.

## Ghi chú cho người review
- Khóa Redis của `writeLimiter` giữ prefix cũ; bộ đếm theo IP cũ tự hết sau 1 phút.
