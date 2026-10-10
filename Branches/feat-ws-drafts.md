# feat/ws-drafts

- **Mục tiêu:** Workspace giai đoạn 2: nháp riêng theo đoạn, cập nhật theo bản chính (diff3), trang /ws
- **Tạo từ:** `origin/main` @ 3b1481e, ngày 2026-10-10
- **Trạng thái:** đã thử trên máy local, chủ dự án đã duyệt giao diện (2026-10-10), mở PR
- **PR:** https://github.com/amthls/nmv/pull/57
- **Plan:** `Plan/chapter-workspace.md` (Giai đoạn 2)

## Thay đổi
- Workspace (Go): bảng `chapter_drafts` (migration `002_drafts.sql`); `merge.go` diff3 theo hash đoạn + gộp meta theo trường + áp lựa chọn;
  `drafts.go` API nội bộ (tạo/lưu/xem/đăng) và công khai (danh sách, xem, bỏ, pull xem trước/áp dụng).
- Hash đoạn bỏ `html` chỉ là `<p>` bọc đúng chữ (cùng hash với chương nhập cũ); bước một-lần `go:canonical_block_hash` chuyển đoạn cũ.
- Backend: `POST /drafts`, `PUT /drafts/:id`, `POST /drafts/:id/publish` (lọc HTML, quyền như trước, áp revision ngay).
- Frontend: `/dang-chuong` làm việc trên nháp (tự lưu, Đăng, Bỏ nháp, banner + hộp "Cập nhật theo bản chính"), bỏ nháp `localStorage`;
  trang `/ws`, `/ws/truyen/[slug]`; mục "Workspace" trong menu tài khoản.

## Migration / biến môi trường mới
- Workspace tự chạy `002_drafts.sql` + bước đổi hash khi khởi động. Không có biến môi trường mới.

## Đã kiểm tra
- Go: gofmt, vet, test đơn vị (diff3 11 ca, meta, hash) + tích hợp (vòng đời nháp, pull có/không xung đột, đăng, bỏ).
- Typecheck backend + frontend; `scripts/workspace-smoke.py` 38/38 (thêm 18 ca nháp: lọc HTML, tab cũ 409, người ngoài 403, đăng khi bản chính đã đổi 409, pull, đăng).
- Trình duyệt: `/ws`, `/ws/truyen/...`, Sửa → nháp, tự lưu, banner bản chính đổi, hộp cập nhật (không xung đột) → nháp có cả hai thay đổi.

## Ghi chú cho người review
- Giai đoạn 2 giữ quyền đăng như cũ; đề xuất/duyệt là giai đoạn 3.
