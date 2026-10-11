# Giai đoạn E: service messaging (Go)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Thiết kế chung: `Plan/microservices.md` (mục "Thiết kế messaging", giai đoạn E). Chia 4 nhánh, mỗi nhánh một PR vào main.

## E1 `feat/messaging-realtime`: WebSocket thường thay Socket.IO

**Hiện trạng (2026-10-10):** realtime chỉ đẩy tín hiệu "có gì đó đổi" (`notification`, `dm`, `group_message`), trình duyệt tự tải lại qua REST
(quyền nằm một chỗ). Backend phát qua `@socket.io/redis-emitter`; Socket.IO chạy trong backend.

**Thiết kế:**
- Service `services/messaging` (Go), một container, vai trò realtime trước (API tin nhắn/thông báo ở E2/E3). `GET /ws` (gateway `/api/msg/ws`):
  chỉ người đã đăng nhập (identity ký `X-User-Sig-Msg` bằng `USER_SIG_KEY_MESSAGING`; khách → 401, không mở kết nối).
- Thư viện `github.com/coder/websocket`. Gói tin `{type, data}`. Mỗi tab gửi `?tab=<id>` (sessionStorage): kết nối mới của cùng tab thay kết nối cũ;
  tối đa 10 kết nối/tài khoản (cũ nhất bị đóng).
- **Ping tầng giao thức do server gửi mỗi 30 giây**, chờ pong tối đa 45 giây (lỡ ~2 lần thì cắt); nginx `proxy_read_timeout 120s` > chu kỳ ping.
- Đường phát: mọi tiến trình (backend API, worker, sau này messaging) `PUBLISH rt:events {users:[…], type, data}` lên Redis; mọi bản messaging
  `SUBSCRIBE` và đẩy cho kết nối của những user đó (chạy nhiều bản được). `type: "_disconnect"` = đóng mọi kết nối của user (bị khóa/thu hồi phiên).
- **Không lấy bù theo id:** tín hiệu chỉ bảo "tải lại", Postgres là sự thật. Kết nối lại xong client phát giả mọi loại tín hiệu một lần
  để trang tải lại (không lỡ gì, không cần lưu sự kiện).
- Client (`frontend/src/lib/realtime.ts`): WebSocket thường, kết nối lại **chờ ngẫu nhiên tăng dần** (1 s → 30 s), bị từ chối (đóng 4401 /
  lỗi bắt tay) thì `refreshSession()` một lần; tab ẩn quá 5 phút thì đóng, hiện lại thì mở.
- Chịu tải: `ulimit nofile` 65536 cho gateway + messaging, nginx `worker_rlimit_nofile`, `worker_connections` 16384; giới hạn số kết nối mới/giây
  ở gateway (`limit_req` riêng cho `/api/msg/ws`).
- Bỏ Socket.IO: backend (`socket.io`, `@socket.io/redis-adapter`, `@socket.io/redis-emitter`), gateway `/socket.io/`, frontend `socket.io-client`.

- [x] `services/messaging`: cấu hình, log JSON, `/health` `/ready`, xác thực header, hub (tab, giới hạn, ping), Redis subscribe, test Go
- [x] identity ký `X-User-Sig-Msg`; gateway `/api/msg/ws` (+ `/api/msg/*` cho E2/E3); compose, launch.py (`USER_SIG_KEY_MESSAGING`), CI, deploy
- [x] Backend: `emitToUsers`/`disconnectUser` → `PUBLISH rt:events`; bỏ Socket.IO
- [x] Frontend: `lib/realtime.ts` WebSocket thường; bỏ `socket.io-client`
- [x] Thử: 2 tab cùng tài khoản nhận `dm`/`notification`, cùng tab mở lại thay kết nối cũ, khóa tài khoản → bị cắt, mất mạng → tự nối lại;
      thử tải nhỏ (Go client giả lập 2.000 kết nối, đo RAM/kết nối); README, Branches; PR, tự merge
  - Đo 2026-10-10 (`messaging loadtest 2000`): nối 2.000 kết nối trong 0,3 s, một lần phát tới cả 2.000: p50 19 ms, p95 20 ms;
    RAM ~37 KB/kết nối (2.000 ≈ 75 MB) → `mem_limit` mặc định 512m (~10k kết nối).
  - Bẫy: lớp ghi log bọc `ResponseWriter` phải có `Unwrap()`/`Hijack()`, không thì nâng cấp WebSocket trả 501 (test giờ đi qua lớp bọc).

## E2 `feat/messaging-conversations`: tin nhắn riêng + chat nhóm chuyển sang messaging

**Thiết kế (2026-10-10):**
- **API giữ nguyên hình dạng JSON**, chỉ đổi gốc: `/api/v1/messages/*` → `/api/msg/messages/*`, `/api/v1/groups/:id/messages*` →
  `/api/msg/groups/:id/messages*` (frontend chỉ đổi đường dẫn). Tin nhắn có `id` UUID như cũ.
- `messaging_db`: `conversations` (dm | group; dm có `dm_key` = cặp id đã sắp xếp, group có `group_id`), `conversation_members`
  (người dùng, `last_read_seq`, `last_read_at`; dm: 2 dòng; group: không lưu thành viên — quyền hỏi backend), `messages` (`id` UUID, `seq`
  BIGSERIAL để so đã đọc, `sender_id`, nội dung, `draft_id`, `pinned_at/by`), `user_blocks`, `dm_labels`, `dm_label_conversations`.
  `read_at` của tin dm = `last_read_at` của người nhận nếu `seq` ≤ `last_read_seq`.
- **Hồ sơ hiển thị và nhóm vẫn ở backend:** messaging hỏi API nội bộ backend (cache trong bộ nhớ 60 s):
  `POST /internal/users/profiles {ids}` / `{usernames}` → id, username, tên, ảnh, khóa/xóa; `GET /internal/groups/:id/members` → [{user_id, role}]
  (quyền đọc/gửi = có trong danh sách; xóa tin người khác = leader/mod; người nhận tín hiệu = mọi thành viên).
  shortcut: hỏi API thay vì giữ bản sao `ext_` theo sự kiện — backend chưa có outbox cho hồ sơ/nhóm; đổi khi làm catalog (giai đoạn I).
- Thẻ nháp trong tin nhắn (workspace chia sẻ nháp): backend gọi `POST /internal/dm {from, to, message, draft_id}` của messaging
  (`INTERNAL_KEY_MESSAGING`), messaging kiểm tra chặn → 403.
- **Chuyển dữ liệu một lần:** `messaging import-legacy` (như identity) đọc `novel_platform.direct_messages, group_messages, user_blocks,
  dm_labels, dm_label_conversations` bằng `LEGACY_DATABASE_URL` (chỉ lúc chuyển), giữ UUID; chạy lại an toàn (chỉ thêm phần thiếu).
  `scripts/migrate.sh` + `launch.py` chạy nó. Bảng cũ xóa ở nhánh sau khi đã chạy ổn.

- [x] Backend: `/internal/users/profiles`, `/internal/groups/:id/members`; `chapter.controller` gửi thẻ nháp qua messaging; bỏ code + route tin nhắn
- [x] messaging: DB + migration nhúng, API dm (hộp thư + lọc nhãn + tìm, luồng, gửi, nhãn, chặn, ghim), chat nhóm, `/internal/dm`, `import-legacy`, test tích hợp
- [x] Gateway `/api/msg/*`; compose (`messaging_db`, khóa), migrate.sh/launch.py chạy import; frontend đổi đường dẫn
- [x] Thử: chuyển dữ liệu thật (đếm khớp), hộp thư/luồng/nhãn/chặn/ghim/nhóm qua gateway, thẻ nháp; README, Branches; PR, tự merge

## E3 `feat/messaging-notifications`: hộp thông báo
- [ ] Bảng `notifications` mới (category, type chuỗi, actors, data ảnh chụp, group_key, seen/read), cài đặt nhóm × kênh, thông báo toàn site 1 dòng,
      dọn đã đọc 30 ngày / chưa đọc 60 ngày; messaging nhận job `novel.notifications` (thay worker backend) rồi dần chuyển sang sự kiện
- [ ] Chuông (chưa xem/chưa đọc, tab), trang `/thong-bao`; chuyển dữ liệu cũ từ enum

## E4 thử tải
- [ ] Client giả lập Go: 10k → 30k kết nối giữ lâu + phát hàng loạt; ghi RAM/CPU mỗi kết nối, độ trễ; ước tính giới hạn máy hiện tại
