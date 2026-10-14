# feat/group-profile-edit

- **Mục tiêu:** Cho trưởng nhóm/mod nhóm sửa hồ sơ nhóm dịch
- **Tạo từ:** `origin/main` @ bec5e83, ngày 2026-10-14
- **Trạng thái:** chờ duyệt
- **PR:** (chưa mở)
- **Plan:** không có

## Thay đổi
- `CreateGroupModal` nhận prop `group?`: có thì là chế độ sửa (điền sẵn, tiêu đề "Sửa hồ sơ nhóm", `PUT /groups/:id`, nút Lưu), chỉ gửi trường đã đổi, ô xóa trắng gửi null, lỗi API hiện trong modal.
- `/nhom-dich/[slug]`: nút "Sửa hồ sơ" cho leader/mod nhóm, lưu xong cập nhật `group` tại chỗ; `#sua-ho-so` mở sẵn modal.
- `/ws/nhom/[slug]`: link "Sửa hồ sơ nhóm" cho leader/mod.
- Không sửa backend (`PUT /groups/:id` đã có).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `tsc --noEmit` sạch, `yarn test` pass, `check-nav` ok (`yarn lint` chưa cấu hình ESLint).
- API qua gateway: leader PUT 200, website_url `javascript:` 400, reader_yuki 403.
- Trình duyệt (neko_trans): nút, modal điền sẵn, sửa mô tả, Lưu, trang cập nhật, console sạch. Dữ liệu nhóm đã trả về giá trị gốc.

## Ghi chú cho người review
- `docker compose up -d --build frontend` build cả catalog (depends_on); dùng `docker compose build frontend && docker compose up -d --no-deps frontend`.
