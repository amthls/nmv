# feat/workspace-history

- **Mục tiêu:** Giai đoạn C, workspace giai đoạn 1: lịch sử phiên bản chương (service Go `workspace`, `workspace_db`)
- **Tạo từ:** `feat/identity-cutover` + gộp `feat/no-approval`, ngày 2026-10-10
- **Trạng thái:** đã chuyển và thử trên máy local, README xong; chủ dự án đã duyệt giao diện (2026-10-10), mở PR
- **Biến môi trường mới:** `WORKSPACE_DB_PASSWORD` (launch.py tự sinh). **Migration:** `023_ws_chapter_versions.sql` + `workspace import`
- **PR:** (chưa mở)
- **Plan:** `Plan/chapter-workspace.md` (Thiết kế chốt + Giai đoạn 1)

## Thay đổi
- `services/workspace` (Go): đoạn lưu theo hash, phiên bản không bao giờ ghi đè (sửa/rewind/xóa/khôi phục), diff LCS, outbox `workspace.revision.merged`, `import`.
- Backend lọc HTML rồi gọi workspace; áp phiên bản vào `chapters` ngay + qua sự kiện (`ws_chapter_versions`, migration 023); `/internal/permissions`, `/internal/chapters/export`.
- Frontend: trang `/truyen/[slug]/lich-su/[chapterId]` (danh sách, so sánh theo từ, khôi phục), nút Lịch sử ở trang đọc, form sửa gửi `expected_version`.
- Sửa kèm cho #54: huy hiệu vai trò qua identity, `import-legacy` bỏ qua tài khoản tạo sau khi chuyển.

## Đã kiểm tra
- Go test (đơn vị + tích hợp + schema sự kiện), typecheck, test backend; nhập 158/158 chương; `scripts/workspace-smoke.py` 20/20; `scripts/auth-smoke.py` qua.
