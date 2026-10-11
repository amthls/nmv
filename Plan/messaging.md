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

**Thiết kế (2026-10-11):**
- **Backend vẫn quyết định "ai nhận gì"** (các hàm dựng `NotifyItem` giữ nguyên, controller không đổi) và đẩy job vào hàng `novel.notifications`
  như cũ; **messaging tiêu thụ hàng đó** thay worker backend. Trước khi đẩy, backend gắn `link` (đường dẫn bấm vào: truyện/chương/bài/nhóm/nháp)
  và `image` (bìa truyện) bằng một câu SQL = **ảnh chụp**, messaging không phải hỏi lại. Tắt thông báo theo bài (`post_notification_mutes`)
  vẫn lọc ở backend lúc đẩy. RabbitMQ không tới được → backend gọi thẳng `POST /internal/notifications/jobs` của messaging.
  shortcut: job từ backend thay vì sự kiện miền; chuyển sang sự kiện khi tách community/catalog (F, I).
- `type` là chuỗi, bảng loại trong code Go (`notifyTypes`): loại → `category` (`read`, `interaction`, `group`, `workspace`, `moderation`, `system`),
  có tắt được không, khóa gộp. Bỏ enum. Loại không tắt được: kết quả xin vào nhóm, đề xuất được gộp/trả lại, nội dung bị gỡ/khôi phục, cảnh báo Admin.
- `messaging_db.notifications`: user_id, type, category, title, message, link, image, `actors` (≤ 3 gần nhất) + `actor_count`, `count`, `data`
  (story_title, group_name…), `group_key`, `seen_at` (đã mở chuông), `read_at` (đã bấm), created_at, updated_at.
  **Gộp:** unique `(user_id, group_key) WHERE read_at IS NULL` → `ON CONFLICT DO UPDATE` (thêm người, `count+1`, đưa lên đầu, chưa xem lại).
  Gộp: chương mới theo truyện, cảm xúc/bình luận theo bài, xin vào nhóm theo nhóm. Tiêu đề gộp dựng lúc đọc ("Yuki và 12 người khác…",
  "Truyện X có 3 chương mới"). `notification_dedupe(key)` giữ chống trùng (job gửi lại không tạo trùng).
- Chương mới: messaging hỏi người theo dõi từ backend `GET /internal/stories/:id/followers?after=&limit=1000` (đã lọc `notify_updates`), lô 1000.
- Cài đặt: `notification_settings(user_id, category, web)`; chỉ có kênh web (email để sau). Chuyển từ `user_settings.notify_*` một lần
  (tương tác tắt khi cả 3 công tắc cũ tắt). `/tai-khoan` bỏ các công tắc, trỏ sang `/thong-bao`.
- Thông báo toàn site: `broadcasts` 1 dòng (hiện 30 ngày) + `broadcast_reads(user, broadcast, seen_at, read_at)`; Admin tạo/xóa ở `/thong-bao`.
- API `/api/msg/notifications`: `GET ?category=&unread=1&before=&limit=` (+ `unseen_count`, `unread_count`), `POST /seen`, `PUT /:id/read`,
  `PUT /read-all`, `DELETE /:id`, `GET|PUT /settings`; `GET|POST /api/msg/admin/broadcasts`, `DELETE /api/msg/admin/broadcasts/:id`.
- Dọn mỗi giờ: đã đọc > 30 ngày, chưa đọc > 60 ngày, khóa chống trùng > 60 ngày.
- Cảnh báo Admin (`notifyAdmins`, `backup.sh`) và thông báo từ sự kiện workspace cũng đi qua messaging. Chuyển dữ liệu: `import-legacy` chép
  `notifications` cũ (giữ id, link dựng từ bảng backend) + cài đặt. Bảng cũ xóa ở nhánh sau (cùng bảng tin nhắn cũ).

- [x] messaging: migration 002, bảng loại, xử lý job (lọc cài đặt, chống trùng, gộp, đẩy realtime), người theo dõi từ backend, consumer RabbitMQ
      (thử lại/DLQ như worker cũ), `/internal/notifications/jobs`, API người dùng + cài đặt + broadcast, dọn định kỳ, import-legacy, test
- [x] Backend: gắn link/ảnh khi đẩy, lọc tắt theo bài, fallback HTTP, loại cụ thể thay `system`, `/internal/stories/:id/followers`,
      `notifyAdmins`/workspaceSync qua hàng đợi, bỏ worker thông báo + controller/route cũ + `notify_*` ở cài đặt; `backup.sh` ghi vào messaging_db
- [x] Frontend: chuông (chưa xem, tab Tất cả/Chưa đọc/Nhóm dịch/Workspace, đã đọc hết), trang `/thong-bao` (lọc, tải thêm, cài đặt nhóm × kênh,
      broadcast cho Admin), `/tai-khoan` trỏ sang
- [x] Thử: chuyển dữ liệu (đếm khớp), bình luận/cảm xúc gộp, chương mới tới người theo dõi, cài đặt tắt, broadcast, realtime, Rabbit tắt → fallback;
      README, Branches; PR, tự merge
  - Thử 2026-10-11: 126/126 thông báo cũ chuyển sang (chạy lại: "already imported"); 3 người thả cảm xúc → 1 dòng "Administrator và 2 người
    khác…"; tắt Tương tác → bình luận mới không tới; chương mới → 12/12 người theo dõi trong 21 ms; dừng RabbitMQ → backend gửi thẳng
    `/internal/notifications/jobs`, bật lại → messaging/backend/worker tự nối lại; Redis nhận `{"type":"notification"}`; backup.sh ghi cảnh báo
    vào messaging_db (chạy 2 lần → 1); trình duyệt: chuông về 0 khi mở, tab, trang `/thong-bao`, công tắc cài đặt.
  - Bẫy: `import-legacy` chạy mỗi lần migrate → thứ đã xóa bên messaging (tin nhóm, thông báo, công tắc bật lại) bị chép lại. Sửa: bảng
    `legacy_imports`, mỗi phần chuyển một lần. amqplib khai báo TTL hàng retry kiểu `short`: Go phải dùng `int16(10000)` cho khớp.

## E4 thử tải
- [ ] Client giả lập Go: 10k → 30k kết nối giữ lâu + phát hàng loạt; ghi RAM/CPU mỗi kết nối, độ trễ; ước tính giới hạn máy hiện tại
