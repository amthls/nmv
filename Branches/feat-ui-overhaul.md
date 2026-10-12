# feat/ui-overhaul

- **Mục tiêu:** Trang chủ: bỏ hàng ảnh minh họa, thêm hướng dẫn quy trình làm chương mở/đóng được
- **Tạo từ:** `origin/main` @ cd1e07c, ngày 2026-10-12
- **Trạng thái:** xong cụm A
- **PR:** (xem GitHub)
- **Plan:** Plan/ui-overhaul.md

## Thay đổi
- `frontend/src/app/page.tsx`: bỏ mục "Ảnh minh họa mới" (ảnh nền carousel giữ nguyên)
- `frontend/src/components/home/WorkflowGuide.tsx`: hướng dẫn 5 bước dạng `<details>`

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit` (frontend)

## Ghi chú cho người review
- Các cụm B–F của plan làm ở nhánh khác.
