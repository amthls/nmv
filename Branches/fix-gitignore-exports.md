# fix/gitignore-exports

- **Mục tiêu:** Commit module exports bị .gitignore bỏ sót
- **Tạo từ:** `origin/main` @ 1f7f273, ngày 2026-10-14
- **Trạng thái:** chờ merge
- **PR:** (chưa mở)
- **Plan:** (Plan/<tên>.md nếu có)

## Thay đổi
- .gitignore: `exports/`, `logs/`, `build/` neo vào gốc (`/exports/`...) vì mẫu cũ nuốt cả catalog/src/modules/exports và services/media/src/modules/exports
- Thêm 7 file module exports chưa từng được commit (catalog 4, media 3)

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Clone sạch: tsc, go build, docker build (xem PR)

## Ghi chú cho người review
-
