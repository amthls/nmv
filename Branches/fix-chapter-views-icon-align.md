# fix/chapter-views-icon-align

- **Mục tiêu:** Căn icon mắt lượt xem thẳng hàng giữa các dòng chương
- **Tạo từ:** `origin/main` @ 27cba8a, ngày 2026-10-12
- **Trạng thái:** đang làm
- **PR:** (chưa mở)
- **Plan:** không có

## Thay đổi
- `frontend/src/app/truyen/[slug]/page.tsx`: ô lượt xem mỗi chương đổi `justify-end` thành `justify-between`, icon mắt luôn ở lề trái ô, số lượt xem căn phải. Trước đây cả cụm icon+số dồn phải nên icon lệch theo độ dài số.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit` frontend sạch.

## Ghi chú cho người review
- Chỉ đổi CSS một dòng.
