# Kế hoạch: Mở rộng giai đoạn 1 (vài nghìn người online) + CI/CD + nền tảng bảo mật

> **Cách dùng:** làm xong mục nào thì đổi `[ ]` thành `[x]`. Hết token hoặc mở phiên mới thì đọc file này trước,
> rồi làm tiếp mục `[ ]` đầu tiên. Mục "Ghi chú kỹ thuật" ở cuối giải thích các bẫy đã phát hiện, **đọc trước khi sửa code**.
>
> Bắt đầu: 2026-10-08. Nhánh hiện tại: `fix/notification-checks` (có rất nhiều thay đổi chưa commit của việc khác, **đừng commit/revert khi chưa hỏi chủ dự án**).

## Mục tiêu

- Chịu được **2–20 nghìn người online** mà không viết lại app (giữ Express + Next.js + Postgres).
- Sau này mở rộng tiếp (nhiều bản backend, nhiều máy) chỉ cần đổi cấu hình, không sửa kiến trúc.
- **CI/CD** tự động: mỗi lần push thì kiểm tra + build; push lên `main` thì build image và (tùy chọn) deploy.
- **Bảo mật nâng cấp được**: mọi lớp bảo vệ nằm ở chỗ cố định (nginx, middleware, mạng Docker, CI quét lỗ hổng).

## Kiến trúc đích

```
Trình duyệt ── (Cloudflare sau này) ── nginx gateway :3000
                                         ├── /socket.io  ──> backend (WebSocket)
                                         ├── /api, /uploads ─> backend ×N ──> PgBouncer ──> Postgres
                                         └── còn lại ───────> frontend (Next.js)
backend, worker ──> Redis (cache, đếm lượt xem, rate limit, phát realtime giữa các bản)
worker ──> Postgres trực tiếp (giữ advisory lock + batch lớn)
Mạng Docker: "edge" (gateway, frontend, backend) | "data" (postgres, pgbouncer, redis, rabbitmq, search, workers, backend)
```

## Checklist

### 0. Đã xong trước đó
- [x] Tính năng tin nhắn riêng (`/tin-nhan`, `direct_messages`, migration 014) — xem README
- [x] Đọc hạ tầng: docker-compose, nginx, security.ts, worker.ts, notification.service.ts, recommender
- [x] Phân tích điểm nghẽn (đọc chương, polling, trang chủ, recommender, nhiều backend)

### 1. Redis (nền móng)
- [x] `yarn add` ở backend: `ioredis@^5 socket.io@^4.8 @socket.io/redis-adapter@^8 @socket.io/redis-emitter@^5 rate-limit-redis@^4`
- [x] `yarn add` ở frontend: `socket.io-client@^4.8`
- [x] docker-compose: service `redis` (`redis:7.4-alpine`, `--requirepass ${REDIS_PASSWORD}`, `--appendonly yes`, `--maxmemory 256mb`, healthcheck, volume `redis_data`, cổng chỉ `127.0.0.1`)
- [x] Thêm `REDIS_PASSWORD` vào `.env.example`, `.env` (giá trị ngẫu nhiên hex), và `launch.py` (chỗ tự sinh `.env`, cạnh `RABBITMQ_PASSWORD`; `.env` cũ thiếu thì launch.py tự thêm). Cổng host: `127.0.0.1:6380`
- [x] Biến `REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379` cho backend + worker
- [x] `backend/src/config/redis.ts`: client ioredis dùng chung; **không có REDIS_URL thì trả `null`** và mọi tính năng tự lùi về cách cũ (giống cách app đang xử lý Elasticsearch/RabbitMQ)

### 2. Rate limit dùng chung qua Redis
- [x] `middlewares/security.ts`: hàm `limiter()` dùng `RedisStore` (prefix riêng cho từng limiter, ví dụ `rl:login:`) khi có Redis; `passOnStoreError: true` để Redis chết thì site vẫn chạy
- [x] Kiểm tra: đăng nhập sai 11 lần → 429; restart backend → vẫn còn bị chặn (chứng tỏ lưu ở Redis)

### 3. Đếm lượt xem qua Redis (sửa luôn bug lượt xem)
- [x] `story.controller.ts` (~dòng 786, hàm đọc chương): bỏ câu SQL 3 lệnh, thay bằng `recordView(storyId, chapterId)` → `HINCRBY views:stories`, `HINCRBY views:chapters`
- [x] Không có Redis: ghi thẳng DB bằng **1 câu SQL** (CTE), không dùng nhiều lệnh trong 1 query có tham số
- [x] worker.ts: mỗi 60 giây `RENAME` hash → hash tạm, `HGETALL`, cộng vào `stories.total_views`, `chapters.total_views` và upsert `story_views_daily` (view_date = hôm nay) bằng `unnest`
- [x] Ngừng ghi từng dòng vào `story_views` (không ai đọc, chỉ phình to)
- [x] Cập nhật README: `story_views_daily` giờ đã được dùng (để dồn vào mục 10)
- [x] Kiểm tra: mở 1 chương 3 lần → sau ≤60s `total_views` tăng 3, `story_views_daily` có dòng hôm nay

Code: `backend/src/services/viewCounter.ts` (recordView, flushViews). Đã thử: 3 lượt xem → `total_views` +3 sau ≤60s.

### 4. Cache API công khai
- [x] Middleware `cacheJson(ttlGiây)` (lưu body JSON theo URL vào Redis, chỉ cache status 200, header `X-Cache: HIT/MISS`)
- [x] Gắn cho: `GET /stories/trending` (120s), `/stories/recently-updated` (60s), `/stories/illustrations` (300s), `/tags` (600s)
- [x] Kiểm tra: gọi 2 lần → lần 2 có `X-Cache: HIT`

Code: `backend/src/middlewares/cache.ts`. Rate limit: prefix `rl:<hash>:` trong Redis, đã thử 429 vẫn giữ sau restart.

### 5. Realtime (Socket.IO) thay polling
- [x] `backend/src/services/realtime.ts`:
  - `attachRealtime(httpServer)`: Socket.IO path `/socket.io`, adapter Redis; xác thực bằng JWT (cookie `token` hoặc `handshake.auth.token`), kiểm tra user không bị khóa; vào phòng `user:<id>`
  - `emitToUsers(userIds, event, payload)`: dùng `@socket.io/redis-emitter` → chạy được cả trong worker; không có Redis thì bỏ qua
- [x] server.ts: gọi `attachRealtime(server)`
- [x] nginx: `location /socket.io/` → backend, có header Upgrade/Connection, `proxy_read_timeout 120s`
- [x] Phát sự kiện:
  - [x] `notification`: sau `insertNotifications` (thêm `RETURNING user_id`) và `fanOutChapterNotifications` (RETURNING user_id trong CTE `ins`)
  - [x] `dm`: trong `sendDirectMessage` (gửi cho cả 2 người)
  - [x] `group_message`: trong `sendGroupMessage`, gửi tới user id các thành viên nhóm (nhóm nhỏ nên đủ)
- [x] Frontend `lib/realtime.ts`: 1 socket dùng chung, chỉ kết nối khi đã đăng nhập, ngắt khi logout; hook `useRealtime(event, handler)`
- [x] Navbar: nghe `notification`/`dm` → tải lại; polling dự phòng 25s → **120s**
- [x] `/tin-nhan`: nghe `dm` → tải lại; polling 4s/15s → **30s/60s**
- [x] Nhóm dịch chat: nghe `group_message` → tải lại; polling 4s → **30s**
- [x] Kiểm tra: 2 tài khoản, gửi DM → bên kia hiện ngay không cần chờ

Code: `backend/src/services/realtime.ts`, `frontend/src/lib/realtime.ts` (kết nối/ngắt trong AuthContext). Chỉ dùng transport websocket (không cần sticky session khi nhiều backend). Đã thử: token sai bị từ chối, DM đến ngay, worker emit qua Redis tới trình duyệt. Lưu ý: emit trước khi Redis `ready` sẽ bị bỏ (chỉ ảnh hưởng script chạy 1 lần). `next dev` không qua gateway thì không có socket → vẫn chạy nhờ polling dự phòng.

### 6. PgBouncer
- [x] docker-compose: service `pgbouncer` (`edoburu/pgbouncer:v1.26.0-p0`, `POOL_MODE=transaction`, `AUTH_TYPE=scram-sha-256`, `MAX_CLIENT_CONN=1000`, `DEFAULT_POOL_SIZE=20`, healthcheck)
- [x] **Chỉ backend** đi qua pgbouncer (`DATABASE_URL=...@pgbouncer:5432/...`); worker + export-worker vẫn nối thẳng `postgres`
- [x] `recommender/train.ts` `trainRecommender()`: đổi `pg_try_advisory_lock` (theo phiên) → `BEGIN` + `pg_try_advisory_xact_lock` + `COMMIT` trong `finally` (vì API gọi hàm này qua endpoint admin)
- [x] `config/db.ts`: `max` đọc từ `DB_POOL_MAX` (mặc định 50 như cũ)
- [x] Kiểm tra: site chạy bình thường; `SHOW POOLS` trong pgbouncer có kết nối
Đã thử: backend chỉ còn nối Postgres qua pgbouncer (pg_stat_activity), đọc/ghi/transaction OK, train gợi ý qua API OK (lần đầu `skipped` vì worker đang train — đúng như mong đợi). `SHOW POOLS` cần cấu hình ADMIN_USERS (chưa làm, không cần).

### 7. Bảo mật nền tảng
- [x] Tách mạng Docker `edge` / `data` (gateway, frontend **không** thấy postgres/redis/rabbitmq). Không dùng `internal: true` vì sẽ mất các cổng `127.0.0.1` đang dùng cho pgAdmin/scripts
- [x] `security_opt: [no-new-privileges:true]` cho các container app
- [x] Redis bắt buộc mật khẩu (`${REDIS_PASSWORD:?...}` như RabbitMQ)
- [x] `config/env.ts`: production mà thiếu `REDIS_URL` thì chỉ cảnh báo (không chặn)
- [x] README: mục "Lộ trình bảo mật" (làm ở mục 10) — các bước sau: chạy container bằng user không phải root (cần `chown` volume `image_cache` cũ), thu hồi token (Redis denylist), CSP cho frontend, HTTPS/Cloudflare, đổi mật khẩu mặc định Postgres
Đã thử: gateway không resolve được `postgres`/`redis`; backend thấy redis; mọi trang 200. Mạng mới tên `nmv_edge`, `nmv_data` (mạng cũ `nmv_novel_network` có thể còn sót, xóa bằng `docker network rm` khi rảnh).

### 8. Migration tự động (cần cho CD)
- [x] `scripts/migrate.sh`: bảng `schema_migrations(name, applied_at)`; **lần đầu (chưa có bảng) thì đánh dấu mọi file hiện có là đã chạy** (baseline — vì DB hiện tại và `database.sql` đã chứa đủ 001–014); các lần sau chạy file mới theo thứ tự tên, mỗi file trong 1 transaction (`psql -v ON_ERROR_STOP=1 --single-transaction`)
- [x] README: thay hướng dẫn chạy migration thủ công bằng `scripts/migrate.sh` (làm ở mục 10)

Đã thử: DB đang chạy đã baseline 14 file; file mới được chạy + ghi lại; file lỗi rollback, không ghi lại, exit ≠ 0.

### 9. CI/CD (GitHub Actions, repo `amthls/nmv`)
- [x] `.github/workflows/ci.yml` (push + PR):
  - backend: `yarn install --frozen-lockfile`, `tsc --noEmit`, `yarn build`
  - frontend: `yarn install --frozen-lockfile`, `tsc --noEmit`, `next build`
  - smoke test: tạo `.env` test, `docker compose up -d --build`, chạy `scripts/migrate.sh`, chờ `/api/v1/health` 200, `curl /` 200, `docker compose down -v`
  - quét image bằng Trivy (`severity: CRITICAL`, `ignore-unfixed: true`, fail nếu có) — chạy thử Trivy local trước
- [x] `.github/workflows/deploy.yml` (push `main`): build + push image lên GHCR (`ghcr.io/amthls/nmv-backend`, `nmv-frontend`, tag = sha + latest); job deploy qua SSH **chỉ chạy khi có secret `DEPLOY_HOST`** (`git pull`, `docker compose pull`, `scripts/migrate.sh`, `docker compose up -d`)
- [x] docker-compose: thêm `image: ${IMAGE_REGISTRY:-nmv}/backend:${IMAGE_TAG:-local}` (và frontend) để server pull được
- [x] `.github/dependabot.yml`: npm (backend, frontend), docker, github-actions — hằng tuần
- [x] Trivy chạy thử local: bắt được CRITICAL thật → đã sửa: `apt-get upgrade` trong 2 Dockerfile (perl), `proxy-addr` 2.0.8 (backend), frontend Node 20 (hết hạn hỗ trợ) → 22 (hết `tar` cũ), tắt Next image optimizer (`images.unoptimized`) + nginx chặn `/_next/image`
- [x] `.trivyignore`: 2 CVE của Next 14 (chỉ sửa ở Next 15/16), có hạn `exp:2026-11-30`
- [ ] **Trước 2026-11-30: nâng Next.js 14 → 15** (việc riêng, cần test kỹ toàn site), rồi xóa 2 dòng trong `.trivyignore`

Đã thử local: YAML hợp lệ; `yarn install --frozen-lockfile` OK; Trivy 0 CRITICAL; `docker compose up -d --wait` exit 0; mọi trang 200. **Chưa chạy trên GitHub** (chưa commit/push). Deploy chỉ chạy khi đặt biến repo `DEPLOY_ENABLED=true` + secrets `DEPLOY_HOST/USER/SSH_KEY/PATH`.

### 10. Hoàn tất
- [x] Typecheck backend + frontend
- [x] `docker compose up -d --build`, chạy lại các mục "Kiểm tra" ở trên
- [x] Cập nhật README (kiến trúc, container mới, biến môi trường, API cache, realtime, CI/CD)
- [x] Báo cáo lại cho chủ dự án; **không commit nếu chưa được yêu cầu**

## Ghi chú kỹ thuật (bẫy đã phát hiện)

1. **Bug lượt xem có sẵn:** `story.controller.ts` ~dòng 786 chạy 3 câu SQL trong 1 `pool.query` *có tham số* → Postgres từ chối ("cannot insert multiple commands into a prepared statement"), lỗi bị `.catch(() => {})` nuốt. Bảng `story_views` đang có 0 dòng, `total_views` không tăng. Mục 3 sửa việc này.
2. **PgBouncer chế độ transaction** không giữ trạng thái theo phiên: không dùng được advisory lock theo phiên, `SET` không có `LOCAL`, `LISTEN`, prepared statement có tên. Đã grep: chỉ có advisory lock trong `recommender/train.ts` (mục 6 xử lý). Lệnh nhiều câu không tham số vẫn ổn.
3. Postgres dùng `scram-sha-256` → PgBouncer phải `AUTH_TYPE=scram-sha-256`.
4. Image đã kiểm tra tồn tại (2026-10-08): `edoburu/pgbouncer:v1.26.0-p0` (PgBouncer 1.26.0), `redis:7.4-alpine`.
5. Bộ đếm rate limit hiện tại nằm trong RAM → mất khi restart, không chia sẻ giữa nhiều backend (mục 2).
6. Backend/frontend chạy image production: sửa code xong phải `docker compose up -d --build backend frontend` (thêm `worker` nếu sửa worker).
7. Đăng nhập thử: mật khẩu tài khoản `sim_reader_*` không rõ → tạo JWT ngắn hạn trong container:
   `docker exec novel_backend node -e "console.log(require('jsonwebtoken').sign({id:'<uuid>'},process.env.JWT_SECRET,{expiresIn:'10m'}))"`
8. Không chạy container bằng user thường ngay bây giờ: volume `image_cache` cũ thuộc root → app sẽ không ghi được cache ảnh.
9. `launch.py` tự sinh `.env` và có cơ chế phát hiện build cũ (`.build-stamp.json`) — khi thêm biến môi trường mới nhớ sửa cả ở đó.

### Kết quả mục 10 (2026-10-09)
Typecheck 2 bên OK; `docker compose up -d --build --wait` mọi container healthy. Kiểm tra lại: các trang 200; 4 API cache MISS→HIT; `/_next/image` 404; gateway không thấy postgres/redis; backend chỉ nối Postgres qua pgbouncer; 3 lượt đọc → `total_views` +3 và `story_views_daily` = 3; DM đẩy realtime tới người nhận, token sai bị từ chối; `migrate.sh` 0 file mới; key `rl:*` có trong Redis (không spam đăng nhập sai lần nữa để khỏi khóa IP). README đã khớp code. Còn mở: nâng Next 15 (hạn 2026-11-30), chưa commit/push nên CI chưa chạy trên GitHub.
