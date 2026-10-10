# feat/ws-collab

- **Mục tiêu:** Workspace giai đoạn 4a: chia sẻ nháp, bản sao + nhận từng đoạn, giao nháp, nhận lại, quyền sửa + khóa, thẻ nháp trong tin nhắn
- **Tạo từ:** `origin/main` @ 52d5b04 (#59), ngày 2026-10-10
- **Trạng thái:** xong, đã thử local; tự merge
- **PR:** https://github.com/amthls/nmv/pull/60
- **Plan:** `Plan/chapter-workspace.md` (Giai đoạn 4a)

## Thay đổi
- Workspace: migration `004_collab.sql` (`draft_shares`, `draft_edits`, khóa sửa trên dòng nháp, `copied_from`/`copy_base`, trạng thái
  `offered`/`accepted`); `collab.go`: vai trò chủ / được sửa / được xem, khóa sửa 2 phút, chia sẻ, bản sao, gửi lại, nhận (diff3 hỏi mọi
  đoạn người giúp đổi) / không nhận, giao, nhận lại nháp người đã rời, nháp được nhờ, thẻ tin nhắn. Pull cho cả người được sửa.
- Quyền workspace chỉ cache kết quả "có tham gia" (người vừa được thêm vào không bị chặn 30 giây).
- Backend: migration `024_dm_draft_card.sql` (`direct_messages.draft_id`); `POST /drafts/:id/share|transfer|offer`; lưu nháp cho người được
  quyền sửa; thông báo `offered`/`transferred` (`draft_edit` → mở trình soạn thảo).
- Frontend: trình soạn thảo (xem / sửa chung có khóa, Chia sẻ + Giao, Tạo bản sao, Gửi cho chủ nháp, nhận bản gửi), thẻ nháp trong
  `/tin-nhan`, "Được nhờ" ở `/ws`, "Nháp của người đã rời" ở `/ws/truyen/[slug]`.

## Migration / biến môi trường mới
- `sql/migrations/024_dm_draft_card.sql` (chạy `sh scripts/migrate.sh`); workspace tự chạy `004_collab.sql`.

## Đã kiểm tra
- Go test tích hợp `TestCollaboration` (chia sẻ, xem, bản sao, gửi lại, nhận từng đoạn, khóa sửa, ai lưu, giao, nhận lại) + các test cũ.
- Typecheck, test backend; `scripts/workspace-smoke.py` 67/67 (thêm 14 ca làm chung; smoke tự dọn nháp sót của lần chạy dở).
- Trình duyệt: nút + hộp Chia sẻ trong trình soạn thảo.
