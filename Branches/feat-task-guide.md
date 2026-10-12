# feat/task-guide

- **Mục tiêu:** Giao việc dễ hiểu + trang hướng dẫn có ảnh; bỏ hướng dẫn ở trang chủ; kiểm tra thông báo/tin nhắn của ws
- **Tạo từ:** `origin/main` @ afe2ed2, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền sau khi mở)
- **Plan:** Plan/ui-overhaul.md (B7)

## Thay đổi
- Trang chủ: bỏ `WorkflowGuide` (xóa file).
- `AssignForm`: 3 câu hỏi đánh số (Chương nào? / Ai làm? / Dặn dò), lựa chọn dạng thẻ, câu tóm tắt "Sẽ giao … cho …", nút tắt khi chưa đủ,
  link "Chưa rõ cách dùng? Xem hướng dẫn có ảnh". `Step` khai báo ngoài form (tránh mất focus khi gõ).
- `/ws/truyen/[slug]`: dải 3 bước + link hướng dẫn ở đầu; mục 1 Giao việc · 2 Việc đang chạy · 3 Bản dịch chờ bạn duyệt (luôn hiện, có hướng dẫn khi trống).
- `/huong-dan/lam-chuong` (mới): 8 mục, ảnh WebP chụp từ trang thật (`frontend/public/huong-dan/`).
- Link hướng dẫn ở `/nhom-dich/[slug]` (khung "Làm việc với nhóm", tab Quy trình) và `/ws/nhom/[slug]` (dải quy trình, truyện của nhóm).
- `scripts/workspace-smoke.py`: thêm kiểm tra thông báo draft_returned, draft_merged, draft_offered, draft_transferred và link của task_opened.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `tsc --noEmit` frontend; `workspace-smoke.py` 85/85.
- Trình duyệt (neko_trans, reader_yuki): khung giao việc, bảng việc nhóm, trang duyệt đề xuất, dòng phiên bản, chuông thông báo (tab Workspace,
  bấm mở đúng /ws/truyen/...), chia sẻ nháp → thẻ trong /tin-nhan → "Xem" mở nháp chỉ xem. Dữ liệu mẫu để chụp ảnh đã dọn.

## Ghi chú cho người review
- 6 chương mẫu không có nội dung ngay trong dữ liệu seed (Oshi 1–3, Slime 1, Mushoku Tensei 1, Dược sư 1): mở nháp sửa thì trống, người đọc cũng thấy trống.
