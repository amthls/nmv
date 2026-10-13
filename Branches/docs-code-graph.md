# docs/code-graph

- **Mục tiêu:** Cài Understand-Anything và lưu biểu đồ kiến thức codebase
- **Tạo từ:** `origin/main` @ 5a65e48, ngày 2026-10-13
- **Trạng thái:** xong
- **PR:** (xem PR của nhánh này)
- **Plan:** không có

## Thay đổi
- Thêm `.ua/knowledge-graph.json` (1.427 node, 2.171 cạnh, 17 layer, tour 11 bước) cùng `config.json`, `meta.json`, `fingerprints.json` do `/understand` sinh ra.
- Bỏ `.ua/intermediate/` (file tạm) khỏi git.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Validation của plugin: 0 lỗi. Không đụng code chạy, không cần test.

## Ghi chú cho người review
- Plugin `understand-anything` 2.9.7 cài ở phạm vi user (ngoài repo). Xem biểu đồ: `/understand-dashboard`.
- Ít cạnh `calls` (6), nhiều tóm tắt hàm theo mẫu.
