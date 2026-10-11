# feat/messaging-conversations

- **Mục tiêu:** Tin nhắn riêng + chat nhóm chuyển sang service messaging (giai đoạn E2)
- **Tạo từ:** `origin/main` @ d9d4e5c, ngày 2026-10-11
- **Trạng thái:** xong, chờ CI
- **PR:** https://github.com/amthls/nmv/pull/69
- **Plan:** `Plan/messaging.md` (E2), `Plan/microservices.md` (giai đoạn E)

## Thay đổi
- `services/messaging`: DB riêng `messaging_db` (migration nhúng `001_conversations.sql`: `conversations`, `conversation_members`,
  `messages` có `seq`, `user_blocks`, `dm_labels`, `dm_label_conversations`); API `/messages/*` (hộp thư + lọc nhãn + tìm, luồng,
  gửi, nhãn, chặn, ghim) và `/groups/:id/messages*`, JSON giữ nguyên như backend cũ; `POST /internal/dm`, `GET /internal/blocked`;
  lệnh `messaging import-legacy` (chép từ `novel_platform`, giữ UUID, chạy lại chỉ thêm phần thiếu).
- Hồ sơ hiển thị và thành viên nhóm hỏi backend: `POST /internal/users/profiles`, `GET /internal/groups/:id/members` (nhớ 60 s / 30 s).
- Backend: bỏ `message.controller.ts`, route tin nhắn và chat nhóm; chia sẻ nháp gửi thẻ qua `services/messagingClient.ts`.
- Gateway `/api/msg/*` (bỏ tiền tố, header ký `X-User-Sig-Msg`); frontend `/tin-nhan`, Navbar, chat nhóm đổi sang `/api/msg`.
- Compose (`messaging_db`, `INTERNAL_KEY_MESSAGING`), `scripts/migrate.sh` + `launch.py` chạy `import-legacy`; CI chạy test tích hợp với Postgres.

## Migration / biến môi trường mới
- Mới: `INTERNAL_KEY_MESSAGING`, `MESSAGING_DB_PASSWORD` (launch.py tự thêm). DB `messaging_db` do `db-init` tạo.
- Bảng cũ `direct_messages`, `group_messages`, `user_blocks`, `dm_labels`, `dm_label_conversations` ở backend **chưa xóa** (nhánh sau).

## Đã kiểm tra
- `go vet`, `go test` messaging kèm test tích hợp (`TestDirectMessages`, `TestGroupChat`, `TestImportLegacy`); `tsc` backend/frontend.
- Dữ liệu thật: 17/17 tin nhắn riêng, 2 nhãn, 2 hội thoại gắn nhãn đã có bên messaging (chạy lại import thêm 0).
- Qua gateway (admin ↔ neko_trans): hộp thư, chưa đọc, đọc xong có `read_at`, nhãn tạo/gắn/lọc/xóa, tìm theo nội dung, ghim/bỏ ghim,
  chặn → 403 "Không thể gửi…", bỏ chặn; chat nhóm: trưởng nhóm đọc/gửi/xóa, người ngoài 403; khách 401.
- Thẻ nháp: backend `dmBlocked` + `sendDraftCard` → messaging 201, người nhận thấy `draft_id`.
- Trình duyệt: `/tin-nhan` tải hộp thư, gửi tin hiện ngay trong luồng.

## Ghi chú cho người review
- shortcut: hồ sơ/thành viên nhóm hỏi API backend thay vì bản sao theo sự kiện; đổi khi làm catalog (giai đoạn I).
