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
- [ ] `messaging_db`: `conversations`, `conversation_members` (`last_read_message_id`, tắt tiếng, ghim, nhãn), `messages` (id tăng dần), `user_blocks`,
      `dm_labels`; bản sao người dùng `ext_users` (từ `identity.user.*`) và thành viên nhóm (từ backend, sự kiện `catalog.group.member_changed` mới)
- [ ] API `/api/msg/*` thay `/api/v1/messages/*` + chat nhóm; chuyển dữ liệu `direct_messages`, `group_messages`, nhãn, chặn, ghim (lệnh `messaging import`)
- [ ] Frontend `/tin-nhan`, chat nhóm; backend bỏ code tin nhắn + migration xóa bảng cũ sau khi chạy ổn

## E3 `feat/messaging-notifications`: hộp thông báo
- [ ] Bảng `notifications` mới (category, type chuỗi, actors, data ảnh chụp, group_key, seen/read), cài đặt nhóm × kênh, thông báo toàn site 1 dòng,
      dọn đã đọc 30 ngày / chưa đọc 60 ngày; messaging nhận job `novel.notifications` (thay worker backend) rồi dần chuyển sang sự kiện
- [ ] Chuông (chưa xem/chưa đọc, tab), trang `/thong-bao`; chuyển dữ liệu cũ từ enum

## E4 thử tải
- [ ] Client giả lập Go: 10k → 30k kết nối giữ lâu + phát hàng loạt; ghi RAM/CPU mỗi kết nối, độ trễ; ước tính giới hạn máy hiện tại
