# docs/self-merge-rule

- **Mục tiêu:** Quy trình git: Claude tự merge PR vào main, chủ dự án không cần duyệt
- **Tạo từ:** `origin/main` @ fd1b38d, ngày 2026-10-10
- **Trạng thái:** xong, tự merge
- **PR:** https://github.com/amthls/nmv/pull/58
- **Plan:** không

## Thay đổi
- `CLAUDE.md` mục Quy trình git, điều 4: làm xong + đã kiểm tra thì tự commit, push, PR vào `main`, tự merge (squash);
  không merge khi CI đỏ; không xếp chồng PR. Thay cho "Commit/push khi chủ dự án yêu cầu... không tự merge".

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Chỉ sửa tài liệu.
