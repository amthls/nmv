# fix/chapter-row-spacing

- **Mục tiêu:** Danh sách chương: cột phải sát nhau, thẳng hàng, không cách xa
- **Tạo từ:** `origin/main` @ 66eb2e8, ngày 2026-10-12
- **Trạng thái:** đã merge vào main (squash, không qua PR vì máy không có gh)
- **PR:** không có (merge thẳng bằng git)
- **Plan:** (Plan/<tên>.md nếu có)

## Thay đổi
- Danh sách chương: bản trước dùng cột rộng cố định nên cách xa nhau. Giờ mỗi dòng là một lưới 3–4 cột nhỏ giống hệt nhau (số chữ 4,5rem | lượt xem 4,25rem | Đọc ngay 3,5rem | sửa/xóa 3,5rem), khoảng cách gap-2, nên mọi dòng thẳng hàng và gọn Danh sách chương: bản trước đặt cột rộng cố định nên cách xa nhau; giờ khoảng cách nhỏ (gap-2.5), cột số chữ và lượt xem chỉ có độ rộng tối thiểu và căn phải, "Đọc ngay" lại như cũ

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- tsc sạch; trên trình duyệt (1920px) hai dòng chương có đúng cùng vị trí từng cột; chụp ảnh thấy gọn tsc sạch, build lại frontend

## Ghi chú cho người review
-
