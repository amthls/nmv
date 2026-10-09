# fix/story-hero-align

- **Mục tiêu:** Trang truyện: hàng nút luôn sát đáy ảnh bìa dù tiêu đề ngắn
- **Tạo từ:** `origin/main` @ 8fd95cd, ngày 2026-10-09
- **Trạng thái:** xong, chủ dự án đã duyệt, chờ review PR
- **PR:** (chưa mở)
- **Plan:** không cần (sửa 3 dòng)

## Thay đổi
- `frontend/src/app/truyen/[slug]/page.tsx`: cột thông tin trong banner cao bằng ảnh bìa (`md:items-stretch`, `flex flex-col`),
  hàng nút đọc + thanh công cụ đẩy xuống đáy (`md:mt-auto`). Truyện tiêu đề ngắn, không có tên gốc
  (vd `/truyen/ta-co-mot-son-trai`) không còn khoảng trống dưới các nút; truyện tiêu đề dài như cũ.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Typecheck frontend, build; xem trên trình duyệt `/truyen/ta-co-mot-son-trai` và
  `/truyen/nhung-co-vo-khac-chung-toc-cua-toi-khong-the-hoa-thuan-voi-nhau`: hàng nút sát đáy ảnh bìa ở cả hai.

## Ghi chú cho người review
- Điện thoại (một cột) không đổi: `md:` chỉ áp dụng từ màn hình vừa trở lên. Chưa xem trực quan ở khổ điện thoại.
