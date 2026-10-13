# chore/graph-viewer-bat

- **Mục tiêu:** Thêm .ua/xem-bieu-do.bat mở dashboard biểu đồ không cần Claude
- **Trạng thái:** xong
- **PR:** xem PR của nhánh này

## Thay đổi
- `.ua/xem-bieu-do.bat`: tìm plugin understand-anything trong ~/.claude/plugins, chạy Vite dashboard ở cổng 5199 (token cố định `local`, chỉ 127.0.0.1) và mở trình duyệt.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Chạy .bat: trang và knowledge-graph.json trả 200 trên 127.0.0.1:5199. Chưa xem bằng mắt trong trình duyệt.
