# fix/collaborator-lookup

- **Mục tiêu:** Thêm cộng tác viên lỗi 500: truy vấn cột users.email đã xóa ở migration 026
- **Tạo từ:** `origin/main` @ 42e7f25, ngày 2026-10-11
- **Trạng thái:** xong, chờ CI
- **PR:** https://github.com/amthls/nmv/pull/71
- **Plan:** không (sửa lỗi nhỏ)

## Thay đổi
- `POST /stories/:id/collaborators`: tìm người theo tên đăng nhập hoặc id (bỏ email: cột đã chuyển sang identity ở #63, và tra email
  của người khác làm lộ ai có tài khoản); bỏ qua tài khoản đã xóa.
- `scripts/workspace-smoke.py`: tin nhắn ở `/api/msg/messages/*` (E2), thông báo ở `/api/msg/notifications` (E3).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Không còn chỗ nào dùng cột migration 026 đã xóa (`email`, `password_hash`, `tokens_valid_after`, `last_login_at`, `auth_tokens`).
- `tsc` backend; `python scripts/workspace-smoke.py --user admin --story berserker-of-gluttony`: All checks passed
  (trước khi sửa: "add a collaborator" 500 và các bước đề xuất phía sau hỏng theo).

## Ghi chú cho người review
-
