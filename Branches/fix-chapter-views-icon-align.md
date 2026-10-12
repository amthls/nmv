# fix/chapter-views-icon-align

- **Mục tiêu:** Căn icon mắt lượt xem thẳng hàng giữa các dòng chương
- **Tạo từ:** `origin/main` @ 27cba8a, ngày 2026-10-12
- **Trạng thái:** đang làm
- **PR:** (chưa mở)
- **Plan:** không có

## Thay đổi
- `frontend/src/app/truyen/[slug]/page.tsx`: ô lượt xem mỗi chương đổi thứ tự thành số trước, icon mắt sau (căn phải), nên icon mắt luôn thẳng hàng ở mép phải. Trước đây icon đứng trước số nên lệch theo độ dài số.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit` frontend sạch.

## Ghi chú cho người review
- Chỉ đổi CSS một dòng.
