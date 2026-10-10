# feat/ws-schedule

- **Mục tiêu:** Workspace giai đoạn 4c: hẹn giờ đăng chương
- **Tạo từ:** `origin/main` sau #61, ngày 2026-10-10
- **Trạng thái:** xong, đã thử local; tự merge
- **PR:** (điền khi mở)
- **Plan:** `Plan/chapter-workspace.md` (4c) — plan workspace xong hết

## Thay đổi
- Workspace: migration `006_schedule.sql` (`scheduled`, `publish_at`, `scheduled_by/name`, `schedule_prev`, `schedule_error`); tách
  `publishTx` dùng chung cho đăng tay và đăng theo giờ; `schedule.go` (đặt / đổi giờ, hủy, vòng lặp 30 giây `SKIP LOCKED`, trả nháp về kèm lý do
  khi không đăng được); danh sách nháp / đề xuất / bảng việc có cả nháp đang hẹn.
- Backend: `POST /drafts/:id/publish {publish_at}` hẹn giờ thay vì đăng ngay (cùng kiểm tra quyền, nội dung, tập, truyện bị gỡ).
- Frontend: ô hẹn giờ cạnh Đăng (trình soạn thảo) và Gộp (trang duyệt), banner "sẽ đăng lúc…" + Hủy hẹn, lý do khi hẹn không thành,
  huy hiệu "Hẹn đăng" ở danh sách.

## Migration / biến môi trường mới
- Workspace tự chạy `006_schedule.sql`.

## Đã kiểm tra
- Go test `TestSchedule` (giờ không hợp lệ, khóa, chưa tới giờ, tới giờ đăng, đề xuất sửa trùng → về chờ duyệt kèm lý do, hủy hẹn).
- Typecheck, test backend; `scripts/workspace-smoke.py` 83/83 (thêm 5 ca hẹn giờ).
- Chạy thật: hẹn chương mới +65 giây → đăng sau ~95 giây, độc giả thấy (rồi xóa chương thử).
