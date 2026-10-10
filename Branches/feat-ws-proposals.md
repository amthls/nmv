# feat/ws-proposals

- **Mục tiêu:** Workspace giai đoạn 3: đề xuất, góp ý theo đoạn, trả lại, gộp; thông báo
- **Tạo từ:** `origin/main` @ bca40d1, ngày 2026-10-10
- **Trạng thái:** xong, đã thử local; tự merge
- **PR:** https://github.com/amthls/nmv/pull/59
- **Plan:** `Plan/chapter-workspace.md` (Giai đoạn 3)

## Thay đổi
- Workspace: migration `003_proposals.sql` (`draft_rounds`, `draft_comments`, trạng thái `submitted`); `proposals.go` (gửi, rút, trả lại,
  danh sách đề xuất, trang duyệt, góp ý); publish nhận đề xuất và tự gộp diff3 khi không sửa trùng; `can_merge` trong `GET /drafts/:id`.
- Diff3: đoạn kề nhau do hai bên sửa (cùng số đoạn) gộp từng đoạn thay vì báo cả cụm xung đột.
- Backend: `storyRole` dùng chung (người giữ / người đóng góp / danh sách người giữ); `publish` chỉ người giữ truyện; `submit|withdraw|return`;
  thông báo `draft` qua hàng đợi; đăng/sửa thẳng truyện chữ qua đường cũ chỉ còn cho người giữ truyện.
- Frontend: trình soạn thảo Gửi đề xuất / Đăng theo quyền, banner chờ duyệt / bị trả lại; trang `/ws/de-xuat/[id]`; đề xuất chờ gộp ở
  `/ws/truyen/[slug]`; huy hiệu "Chờ duyệt"; thông báo mở trang duyệt; component diff dùng chung (gập đoạn không đổi, cả trang lịch sử).

## Migration / biến môi trường mới
- Workspace tự chạy `003_proposals.sql`. Không có biến mới.

## Đã kiểm tra
- Go test đơn vị + tích hợp (`TestProposals`: gửi, khóa, danh sách, duyệt, góp ý, trả lại, vòng 2, tự gộp, xung đột → 409, rút lại).
- Typecheck backend + frontend, test backend; `scripts/workspace-smoke.py` 53/53 (thêm 15 ca đề xuất, có thông báo qua hàng đợi).
- Trình duyệt: trang duyệt đề xuất (gập đoạn, góp ý vòng trước, các lần gửi).
