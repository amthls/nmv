# feat/no-approval

- **Mục tiêu:** Bỏ khâu duyệt truyện, chương, blog, nhóm dịch; admin/mod chỉ xoá/gỡ nội dung vi phạm
- **Tạo từ:** `origin/main` @ e3c8402, ngày 2026-10-09
- **Trạng thái:** xong, chủ dự án đã duyệt giao diện (2026-10-10), chờ review PR
- **PR:** https://github.com/amthls/nmv/pull/50
- **Plan:** `Plan/no-approval.md`

## Thay đổi
- Truyện, chương, bài Fandom, nhóm dịch: đăng là hiện ngay, không ai duyệt (kể cả leader/mod nhóm).
- Admin/Mod không còn sửa truyện, chương, bài viết của người khác và không đăng truyện vào nhóm mình không ở.
  Còn lại: xoá truyện, xoá chương, xoá bài viết, gỡ (ẩn kèm lý do) và khôi phục bài viết.
- Bài bị gỡ: tác giả sửa vẫn không hiện lại, chỉ Admin/Mod khôi phục.
- Đăng chương trùng số chương đã có → 409 (trước đây leader ghi đè được).
- Bỏ API: `POST /stories/:id/approve|reject`, `GET /groups/:id/pending-stories`, `GET /chapters/submissions`,
  `POST /chapters/submissions/:id/approve-active|reject`, `POST /posts/bulk-approve|bulk-reject`, `POST /groups/:id/approve|reject`.
- Giao diện: bỏ banner/nút duyệt truyện, tab "Duyệt bản dịch chương", khối "Truyện đang chờ duyệt", tab "Hàng chờ duyệt" nhóm,
  feed "Cần xem lại" + chọn hàng loạt ở Fandom; Admin/Mod chỉ thấy nút xoá ở trang truyện/chương, menu bài viết không còn "Sửa".

## Migration / biến môi trường mới
- `sql/migrations/019_no_approval.sql` (đã chép vào `sql/database.sql`): truyện pending/rejected và nhóm pending → approved,
  bài pending → approved + published, bản dịch chương pending/rejected → draft.

## Đã kiểm tra
- Typecheck backend + frontend, build lại container, `scripts/migrate.sh`.
- API (script 16 bước): thành viên thường đăng truyện nhóm + chương → hiện ngay; trùng số chương → 409;
  mod sửa truyện/chương/bài → 403; mod đăng vào nhóm không ở → 403; mod xoá chương, truyện → 200;
  người thường tạo nhóm → approved; mod gỡ bài → tác giả sửa vẫn bị gỡ → mod khôi phục; các route đã bỏ → 404.
- Trình duyệt (đăng nhập mod): trang truyện chỉ còn "Xóa truyện" và nút xoá chương; menu bài Fandom chỉ Ghim/Gỡ/Xóa;
  `/nhom-dich` không còn tab chờ duyệt; trang nhóm không còn tab "Duyệt bản dịch chương".

## Ghi chú cho người review
- Bản nháp chương trên server chưa có chỗ xem lại (ghi trong README, Hạn chế).

## Phần 2: chỉ gỡ mềm, trang "Đã gỡ", admin hết quyền trong nhóm
- Admin/Mod không xóa hẳn nữa: gỡ truyện (`POST /stories/:id/remove|restore`) và bài viết (`/posts/:id/reject|approve`),
  `DELETE /stories/:id` chỉ người đăng, `DELETE /posts/:id` chỉ tác giả, Admin/Mod không xóa chương.
- Trang `/da-go` (link trong menu tài khoản của Admin/Mod) + `GET /moderation/removed`: lọc loại, tìm theo mã/tên/nội dung/người đăng, khôi phục.
- Trang truyện đã gỡ: nhóm đăng truyện và Admin/Mod vẫn mở được, có banner lý do; Admin/Mod có nút "Khôi phục".
- Admin site không còn quyền gì trong nhóm dịch (sửa nhóm, thành viên, chat, duyệt người xin vào).
- Migration `020_soft_remove.sql`: `stories`, `posts` thêm `removed_by`, `removed_at`.
- Đã kiểm tra: typecheck, build, migrate; API 14 bước (mod xóa truyện/chương/bài → 403, gỡ → khách 404, mod/chủ vẫn xem,
  explore không thấy, tìm trong `/da-go` theo tên/mã/nội dung, khôi phục, admin sửa nhóm/đọc chat → 403);
  trình duyệt: trang `/da-go` có truyện + bài đã gỡ, trang truyện đã gỡ có banner + "Khôi phục". Dữ liệu thử đã xóa.

## Phần 3: báo cáo vi phạm
- Sửa: nút "Báo cáo" ở banner truyện mở hộp thoại bị kẹt trong thanh công cụ (backdrop-filter) → `ReportButton` vẽ hộp thoại qua portal.
- Chống spam: migration `021_report_spam.sql` (unique index một báo cáo đang chờ/người/nội dung, đóng các bản trùng cũ),
  tối đa 30 báo cáo/24h/người, chờ 24h sau khi báo cáo cũ về cùng nội dung được xử lý (ngoài giới hạn 10/giờ có sẵn).
- `GET /reports` + trang `/bao-cao`: lọc loại nội dung, tìm theo mã báo cáo/mã nội dung/tên/mô tả, hiện mã nội dung,
  số báo cáo đang chờ cùng nội dung, nội dung đã gỡ.
- Đã kiểm tra: typecheck, build, migrate; gửi báo cáo trên trình duyệt ở `/truyen/quai-luc-loan-than` thành công;
  5 yêu cầu song song → 201 + 4×409, chỉ 1 dòng; báo cáo lại sau khi bị bỏ qua → 429; quá 30/ngày → 429;
  lọc/tìm theo loại, mã truyện, tên, mô tả đúng; `/bao-cao` hiển thị đúng. Dữ liệu thử đã xóa.

