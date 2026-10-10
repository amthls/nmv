# 📚 NovelHub - Light Novel & Manga Platform

Nền tảng đọc **Light Novel (truyện chữ)** và **Manga (truyện tranh)** trực tuyến, có nhóm dịch, diễn đàn Fandom, bookmark từng dòng và tìm kiếm bằng **Elasticsearch**.

> README này được đối chiếu trực tiếp với mã nguồn và CSDL đang chạy (routes trong `backend/src/routes/api.routes.ts`, schema thật trong PostgreSQL). Mục [Hạn chế đã biết](#-hạn-chế-đã-biết) ghi rõ những gì chưa làm.

## 📑 Mục lục
1. [Kiến trúc & Công nghệ](#-kiến-trúc--công-nghệ)
2. [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
3. [Khởi chạy](#-khởi-chạy)
4. [Biến môi trường](#-biến-môi-trường)
5. [Chống lạm dụng & DDoS](#-chống-lạm-dụng--ddos) · [Hiệu năng & mở rộng](#-hiệu-năng--mở-rộng-redis-realtime-pgbouncer) · [CI/CD & migration](#-cicd--migration) · [Lộ trình bảo mật](#-lộ-trình-bảo-mật)
6. [Hàng đợi thông báo (RabbitMQ)](#-hàng-đợi-thông-báo-rabbitmq)
7. [Tìm kiếm với Elasticsearch](#-tìm-kiếm-với-elasticsearch)
8. [Trình soạn thảo rich text](#️-trình-soạn-thảo-rich-text-ckeditor-5) · [Độ phân giải ảnh](#-độ-phân-giải-ảnh-cho-người-đọc) · [Hiệu ứng tải trang](#-hiệu-ứng-tải-trang)
9. [Chức năng & Trang giao diện](#-chức-năng--trang-giao-diện)
10. [Phân quyền](#-phân-quyền)
11. [Cơ sở dữ liệu](#-cơ-sở-dữ-liệu)
12. [API Endpoints](#-api-endpoints-apiv1)
13. [Tài khoản mẫu](#-tài-khoản-mẫu)
14. [Hạn chế đã biết](#-hạn-chế-đã-biết)

---

## 🛠 Kiến trúc & Công nghệ

| Tầng | Công nghệ |
|:---|:---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Lucide Icons, CKEditor 5 (trình soạn thảo rich text) |
| Backend | Node.js 22, Express, TypeScript, JWT (cookie + header), bcryptjs, multer (upload ảnh), sharp (đổi kích thước ảnh), sanitize-html |
| Database | PostgreSQL 16 (khóa chính UUID), truy vấn bằng `pg` (raw SQL); Prisma chỉ dùng cho `db pull/generate/studio` |
| Tìm kiếm | Elasticsearch 9.5 (1 node, đã tối ưu RAM; tùy chọn, có fallback về SQL `ILIKE`) |
| Hàng đợi | RabbitMQ 3.13 + worker (gửi thông báo), có dự phòng chạy trực tiếp khi broker chết |
| Cache / realtime | Redis 7.4 (`ioredis`): cache API công khai, đếm lượt xem, bộ đếm rate limit dùng chung; Socket.IO 4.8 + Redis adapter/emitter đẩy thông báo và tin nhắn |
| Gom kết nối DB | PgBouncer 1.26 (transaction pooling) giữa API và Postgres |
| Cổng vào | nginx 1.27 (giới hạn tần suất, IP thật, cache ảnh, WebSocket) + helmet / express-rate-limit ở backend |
| Hạ tầng | Docker Compose (2 mạng: `edge`, `data`), GitHub Actions (CI/CD), image trên GHCR |

```
                      (duy nhất cổng 3000 mở ra ngoài)
Trình duyệt ──> nginx gateway ──┬── /api/v1, /uploads, /socket.io ──> Express API ──> PgBouncer ──> PostgreSQL
                                │                                       │  ├──> Redis (cache, đếm, rate limit, pub/sub)
                                │                                       │  └──> Elasticsearch (tùy chọn)
                                └── còn lại ──> Next.js                 └─ publish ─> RabbitMQ ──> worker ──> PostgreSQL
                                                                                    worker ──> Redis (gộp lượt xem, đẩy realtime)
mạng "edge": gateway, frontend, backend
mạng "data": backend, postgres, pgbouncer, redis, rabbitmq, search, worker, export-worker
```

**10 container** (`docker compose ps`): `gateway`, `frontend`, `backend`, `worker`, `export-worker`, `postgres`, `pgbouncer`, `redis`, `search`, `rabbitmq`, cộng `pgadmin` khi bật profile `tools` và `cloudflared` (HTTPS qua Cloudflare Tunnel) khi bật profile `tunnel`. Chỉ `gateway` (cổng 3000) mở ra mạng; backend, Postgres, Redis, Elasticsearch và giao diện quản trị RabbitMQ chỉ nghe trên `127.0.0.1`, còn frontend, pgbouncer và các worker không mở cổng nào. Gateway và frontend **không** nằm trong mạng `data`, nên không chạm được tới Postgres/Redis/RabbitMQ.

Trình duyệt gọi `/api/v1/...` và `/uploads/...` cùng origin; qua gateway các đường dẫn này đi thẳng tới backend. Khi chạy frontend riêng (không có gateway), `frontend/next.config.mjs` vẫn chuyển tiếp sang `http://backend:5000` (địa chỉ **viết cứng**, biến `API_URL` không được dùng).

## 📂 Cấu trúc thư mục

```
├── backend/
│   ├── src/
│   │   ├── config/db.ts              # pg Pool + PrismaClient
│   │   ├── controllers/              # auth, story, chapter, comment, group, post, bookmark, history,
│   │   │                             # notification, tag, upload, user
│   │   ├── middlewares/              # auth (requireAuth/optionalAuth/requireRole), upload
│   │   ├── services/search.service.ts# tích hợp Elasticsearch
│   │   ├── services/image.service.ts # đổi độ phân giải ảnh theo ?w= (cache trên đĩa)
│   │   ├── utils/richText.ts         # lọc HTML từ trình soạn thảo (sanitize-html)
│   │   ├── routes/api.routes.ts      # toàn bộ route /api/v1
│   │   └── server.ts
│   ├── scripts/                      # seed / migrate / import (chạy thủ công bằng tsx)
│   └── prisma/
├── frontend/src/
│   ├── app/                          # các trang (xem bảng bên dưới)
│   ├── components/                   # Navbar, auth, explore, reader, story, groups, fandom, comments...
│   └── context/AuthContext.tsx
│   ├── main.go                       # HTTP server, route REST tương thích với search.service.ts
│   ├── index.go                      # index trong bộ nhớ, chấm điểm multi-field/fuzzy/prefix
│   ├── text.go                       # bỏ dấu tiếng Việt, tokenize, edge-ngram, Levenshtein
│   └── store.go                      # snapshot ra đĩa để sống sót qua restart container
├── sql/database.sql                  # schema + dữ liệu mẫu, tự nạp khi tạo volume Postgres mới
├── uploads/                          # ảnh người dùng tải lên (mount vào backend và frontend)
├── docker-compose.yml
└── .env / .env.example
```

## 🚀 Khởi chạy

```bash
cp .env.example .env         # BẮT BUỘC đặt JWT_SECRET, POSTGRES_PASSWORD, RABBITMQ_PASSWORD, REDIS_PASSWORD, PGADMIN_DEFAULT_PASSWORD (openssl rand -hex 24); compose không chạy nếu thiếu
docker compose up -d --build # toàn bộ 10 container
sh scripts/migrate.sh        # chạy các migration mới (xem mục CI/CD & migration)
```
`python3 launch.py` làm tất cả các bước trên (tự sinh `.env` với mật khẩu ngẫu nhiên; `.env` cũ còn mật khẩu mặc định `postgres`/`admin` thì tự đổi sang mật khẩu ngẫu nhiên và áp luôn vào volume Postgres đang có bằng `ALTER USER`).

| Dịch vụ | Địa chỉ | Ghi chú |
|:---|:---|:---|
| Website (gateway) | http://localhost:3000 | Cổng vào duy nhất; frontend và backend đều chạy Node 22 |
| Backend API | `127.0.0.1:5000/api/v1` | Chỉ máy chủ; kiểm tra `/api/v1/health` (có trường `queue`: `up`/`down`/`disabled`) |
| PostgreSQL | `127.0.0.1:5432` | Chỉ máy chủ; user `postgres`, DB `novel_platform` |
| RabbitMQ quản trị | http://127.0.0.1:15673 | Chỉ máy chủ; đăng nhập bằng `RABBITMQ_USER` / `RABBITMQ_PASSWORD` |
| Redis | `127.0.0.1:6380` | Chỉ máy chủ; cần mật khẩu `REDIS_PASSWORD` (`redis-cli -p 6380 -a ...`) |
| Elasticsearch (search) | `127.0.0.1:9201` | **chỉ bind localhost**; tắt xác thực (`xpack.security.enabled=false`) nên tuyệt đối không mở ra ngoài |
| pgAdmin | http://localhost:5050 | Chỉ máy chủ (`127.0.0.1`); tùy chọn: `docker compose --profile tools up -d pgadmin`, mật khẩu `PGADMIN_DEFAULT_PASSWORD` trong `.env` |

Lần đầu tạo volume, Postgres tự nạp `sql/database.sql`. Backend tự tạo index trong Elasticsearch và đồng bộ toàn bộ truyện khi khởi động.

Chạy không qua Docker (cần Postgres sẵn): `yarn dev:local` (backend + frontend), các script `yarn db:check | db:import | db:studio`.

## ⚙️ Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|:---|:---|:---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | `postgres` / *(không có)* / `novel_platform` / `5432` | **Bắt buộc** `POSTGRES_PASSWORD` (hex ngẫu nhiên). Volume giữ mật khẩu lúc tạo: đổi trong `.env` thì phải `ALTER USER` (launch.py tự làm) |
| `PORT` | `5000` | Cổng backend |
| `JWT_SECRET` | *(không có)* | **Bắt buộc**, tối thiểu 32 ký tự. Ở production backend từ chối khởi động nếu thiếu hoặc còn là giá trị mặc định cũ |
| `JWT_EXPIRES_IN` | `7d` | Có trong compose, nhưng code hiện ký token 30 ngày cố định |
| `CORS_ORIGIN` | `http://localhost:3000` | Đổi thành domain thật khi đưa lên tunnel/domain |
| `RABBITMQ_URL` / `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | compose tự ghép URL từ hai biến sau | **Bắt buộc** `RABBITMQ_PASSWORD`. Để trống `RABBITMQ_URL` (chạy ngoài Docker) thì thông báo được xử lý trực tiếp, không qua hàng đợi |
| `ENABLE_DEMO_ACCOUNTS` | `false` | `true` mới hiện danh sách tài khoản demo và gợi ý mật khẩu trên form đăng nhập |
| `PGADMIN_DEFAULT_PASSWORD` | *(không có)* | **Bắt buộc** (kể cả khi không bật pgAdmin, vì compose đọc cả file) |
| `SMTP_URL` / `MAIL_FROM` | *(trống)* / `NovelHub <no-reply@novelhub.local>` | Gửi mail quên mật khẩu, xác thực email, ví dụ `smtps://user:app-password@smtp.gmail.com:465`. Để trống: không gửi, link được ghi vào log backend (`docker compose logs backend \| grep mail`) |
| `SITE_URL` | `http://localhost:3000` | Địa chỉ công khai của web, dùng để tạo link trong email |
| `COOKIE_SECURE` | `false` | `true` ép cờ `Secure` cho cookie. Không cần khi đi qua Cloudflare/HTTPS proxy: cookie tự `Secure` khi `X-Forwarded-Proto: https` |
| `CLOUDFLARE_TUNNEL_TOKEN` | *(trống)* | Token của Cloudflare Tunnel cho service `cloudflared` (profile `tunnel`), xem [Lộ trình bảo mật](#-lộ-trình-bảo-mật) |
| `NOTIFY_*`, `WORKER_*` | xem bên dưới | Tinh chỉnh hàng đợi và worker |
| `SEARCH_URL` | `http://search:9200` (trong compose) | **Để trống để tắt Elasticsearch** và dùng SQL `ILIKE` |
| `SEARCH_INDEX` | `novel_stories` | Tên index |
| `SEARCH_PORT` | `9201` | Cổng publish trên máy host (localhost) |
| `REDIS_PASSWORD` / `REDIS_PORT` | *(không có)* / `6380` | **Bắt buộc** `REDIS_PASSWORD`. Compose tự ghép `REDIS_URL` cho backend và worker |
| `REDIS_URL` | compose tự ghép | Để trống (chạy ngoài Docker) thì app vẫn chạy: không cache, rate limit trong RAM, ghi lượt xem thẳng DB, không đẩy realtime (trang tự hỏi lại định kỳ) |
| `DB_POOL_MAX` | `50` | Số kết nối tối đa của mỗi tiến trình Node tới Postgres/PgBouncer |
| `PGBOUNCER_MAX_CLIENT_CONN` / `PGBOUNCER_POOL_SIZE` / `PGBOUNCER_MAX_DB_CONN` | `1000` / `20` / `60` | Kết nối từ app vào PgBouncer / kết nối thật tới Postgres |
| `VIEW_FLUSH_MS` | `60000` | Chu kỳ worker ghi lượt xem từ Redis xuống Postgres |
| `IMAGE_REGISTRY` / `IMAGE_TAG` | `local` / `latest` | Tên image; trên server deploy đặt `IMAGE_REGISTRY=ghcr.io/<owner>` để kéo image do CI build |
| `PGADMIN_*` | | Chỉ dùng với profile `tools` |

## 🛡 Chống lạm dụng & DDoS

Chống DDoS băng thông lớn phải làm ở rìa mạng (Cloudflare, tường lửa nhà mạng); phần dưới đây là những gì ứng dụng tự bảo vệ được. Ba lớp:

**1. Không lộ ra ngoài.** Chỉ `gateway` mở cổng. Backend/Postgres/Elasticsearch/RabbitMQ chỉ nghe `127.0.0.1`, nên không ai trong LAN hay Internet gọi thẳng API hoặc chọc vào DB được. Danh sách tài khoản demo (`/auth/accounts`) và dòng gợi ý "mật khẩu mặc định" tắt mặc định. Lỗi 5xx ở production chỉ trả "Lỗi hệ thống (mã xxxx)", chi tiết SQL/đường dẫn nằm trong log. `helmet`, `X-Powered-By` ẩn, header `nosniff`/`X-Frame-Options`/`Referrer-Policy` ở cả gateway và API.

**2. nginx gateway (`nginx/nginx.conf`)** chặn trước khi yêu cầu tới Node:

| Đường dẫn | Giới hạn theo IP |
|:---|:---|
| `/api/v1/auth/login` | 30 lần/phút, burst 8 |
| `/api/v1/auth/register` | 6 lần/phút, burst 3 |
| `/api/v1/upload/*` | 30 lần/phút, burst 10, thân tối đa 26MB |
| `/api/v1/*` | 20 yêu cầu/giây, burst 80 |
| `/uploads/*` (ảnh) | 20/giây, burst 200, **cache ở gateway** (ảnh thu nhỏ `?w=` chỉ tính một lần) |
| Trang web | 30/giây, burst 120 |

Ngoài ra: tối đa 60 kết nối đồng thời/IP, hết hạn 10s cho header và 20s cho thân yêu cầu (chống slowloris), thân yêu cầu thường tối đa 2MB. Vượt giới hạn trả `429`. **IP thật** do gateway xác định: `X-Forwarded-For` gửi kèm được ghi đè, và `CF-Connecting-IP` chỉ được tin khi yêu cầu đến từ tunnel Cloudflare cục bộ (kẻ trong LAN gửi header giả sẽ bị bỏ qua). Ghi chú: Next.js chuyển nguyên `X-Forwarded-For` của người gửi, đó là lý do backend không tự tin header đó.

**3. Backend (`middlewares/security.ts`)** giới hạn theo ngữ cảnh (bộ đếm lưu trong **Redis**: còn nguyên sau khi khởi động lại và dùng chung giữa nhiều bản backend; Redis lỗi thì cho qua thay vì chặn cả site), dựa trên IP do gateway cấp: đăng nhập sai 10 lần/15 phút cho mỗi cặp (IP, tài khoản), đăng ký 5 lần/giờ, bình luận 30 lần/5 phút, đăng bài 20 lần/giờ, thả cảm xúc 60/phút, báo cáo 10/giờ, chat nhóm 30/phút (theo tài khoản), tìm kiếm 90/phút, ảnh thu nhỏ 300/phút. Thêm: JSON tối đa 2MB, từ khóa tìm kiếm ≤ 120 ký tự, `page` ≤ 1000, tối đa 3 tiến trình `sharp` cùng lúc, `headersTimeout`/`requestTimeout` cho server. **Upload yêu cầu đăng nhập**; đuôi file lấy từ loại MIME đã kiểm (không lấy tên do người dùng đặt) và nội dung phải giải mã được thành ảnh, nếu không bị xóa ngay (chặn "file HTML giả làm PNG" gây XSS lưu trữ).

## ⚡ Hiệu năng & mở rộng (Redis, realtime, PgBouncer)

Mục tiêu: chịu được vài nghìn đến vài chục nghìn người online mà không đổi code khi thêm bản backend. Mọi phần dưới đây đều **tự lùi về cách cũ** nếu Redis không có.

| Vấn đề | Cách làm | Code |
|:---|:---|:---|
| Mỗi lượt đọc chương ghi DB nhiều lần, tranh khóa dòng `stories` của truyện hot | Lượt xem cộng vào Redis (`HINCRBY`), worker mỗi phút ghi gộp vào `stories.total_views`, `chapters.total_views` và `story_views_daily`. Không ghi từng dòng vào `story_views` nữa | `services/viewCounter.ts`, `worker.ts` |
| Trang chủ truy vấn nặng cho mọi người | Cache JSON trong Redis: `/stories/trending` 120s, `/stories/recently-updated` 60s, `/stories/illustrations` 300s, `/tags` 600s (header `X-Cache: HIT/MISS`) | `middlewares/cache.ts` |
| Trình duyệt hỏi server liên tục (thông báo 25s, chat 4s) | Socket.IO đẩy tín hiệu `notification`, `dm`, `group_message` vào phòng `user:<id>`; trang nhận được thì tải lại qua REST. Hỏi định kỳ chỉ còn là dự phòng (120s / 30–60s) | `services/realtime.ts`, `frontend/src/lib/realtime.ts` |
| Nhiều bản backend × pool 50 làm hết kết nối Postgres | API đi qua PgBouncer (transaction pooling). Worker nối thẳng Postgres | `docker-compose.yml` |

- **Realtime:** chỉ dùng transport WebSocket (không long-polling) nên chạy nhiều bản backend không cần sticky session; xác thực bằng JWT (cookie hoặc `auth.token`) với cùng điều kiện như API (tài khoản tồn tại, không bị khóa/xóa). Worker phát sự kiện qua `@socket.io/redis-emitter`. `next dev` chạy riêng (không qua gateway) thì không có socket, trang vẫn chạy nhờ hỏi định kỳ.
- **PgBouncer chế độ transaction** không giữ trạng thái theo phiên: không dùng advisory lock theo phiên, `SET` không `LOCAL`, `LISTEN`, prepared statement có tên, hay nhiều lệnh SQL có tham số trong một `query`. Train gợi ý dùng `pg_try_advisory_xact_lock` vì lý do này.
- **Thêm bản backend:** bỏ `container_name` của `backend`, rồi `docker compose up -d --scale backend=3` (nginx tự phân giải tên `backend` qua DNS của Docker).

## 🔁 CI/CD & migration

- **Migration:** `sh scripts/migrate.sh` chạy các file mới trong `sql/migrations/` theo thứ tự tên, mỗi file một transaction, ghi vào bảng `schema_migrations`; file lỗi được rollback và script dừng với mã lỗi. Lần chạy đầu (chưa có bảng) chỉ **ghi nhận** các file hiện có là đã chạy (vì `sql/database.sql` và các DB cũ đã có chúng). Thêm migration mới: tạo file số tiếp theo, đồng thời thêm nội dung tương ứng vào `sql/database.sql` cho cài đặt mới.
- **CI** (`.github/workflows/ci.yml`, mọi push/PR): typecheck backend + frontend, test backend (`yarn test`: `tsx --test src/**/*.test.ts`) → `docker compose build` → quét image bằng Trivy (lỗi **CRITICAL đã có bản vá** thì fail; ngoại lệ có lý do và hạn dùng ở `.trivyignore`) → khởi động cả stack → `migrate.sh` → kiểm tra `/api/v1/health`, trang chủ, `/stories/trending`.
- **CD** (`.github/workflows/deploy.yml`, push lên `main`): build và đẩy `ghcr.io/<owner>/nmv-backend` và `nmv-frontend` (tag = commit SHA và `latest`). Bước deploy qua SSH **chỉ chạy khi** biến repo `DEPLOY_ENABLED=true` và có secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH`: `git pull` → `docker compose pull` → `migrate.sh` → `up -d` → kiểm tra health. Server cần `IMAGE_REGISTRY=ghcr.io/<owner>` trong `.env` và đã `docker login ghcr.io`.
- **Dependabot** (`.github/dependabot.yml`): mỗi tuần mở PR cập nhật npm, Docker và GitHub Actions; CI chạy trên từng PR.

## 🔐 Lộ trình bảo mật

Đã có: một cổng vào duy nhất, 2 mạng Docker tách tầng, `no-new-privileges`, **container app chạy bằng user `node`** (backend khởi động bằng root chỉ để sửa quyền thư mục `uploads`/`exports`/`.cache` khi cần rồi hạ quyền, xem `backend/docker-entrypoint.sh`), mật khẩu ngẫu nhiên bắt buộc cho Postgres/RabbitMQ/Redis/pgAdmin, rate limit dùng chung, lỗi 5xx bị che ở production (`maskServerErrors`: chỉ trả câu chung kèm mã tra log), **thu hồi token** (đổi/đặt lại mật khẩu, "đăng xuất mọi thiết bị": cột `users.tokens_valid_after`, áp cho cả API và socket), **Content-Security-Policy** (`frontend/next.config.mjs`), cookie tự `Secure` + HSTS khi truy cập qua HTTPS, quét lỗ hổng image trong CI, Dependabot.

1. **Bật HTTPS khi đưa lên mạng**: tạo tunnel trong Cloudflare Zero Trust, trỏ hostname về `http://gateway:8080`, đặt `CLOUDFLARE_TUNNEL_TOKEN` và `SITE_URL=https://<tên miền>` trong `.env`, rồi `docker compose --profile tunnel up -d`. Không cần mở cổng nào trên router.
2. Cấu hình `SMTP_URL` để mail quên mật khẩu/xác thực email gửi thật (chưa cấu hình thì link chỉ nằm trong log backend).
3. CSP chặt hơn: hiện còn `'unsafe-inline'` cho script/style (Next chèn script inline, CKEditor dùng style inline); bỏ được khi chuyển sang nonce.
4. Đổi hoặc khóa các tài khoản mẫu (`password123`), kể cả `admin`.

## 📬 Hàng đợi thông báo (RabbitMQ)

Gửi thông báo cho hàng nghìn người theo dõi không còn chạy trong yêu cầu HTTP. API chỉ ghi nhận "đã có chương mới" rồi trả lời ngay; `worker` (cùng image backend, chạy `node dist/worker.js`) lo phần còn lại.

| Sự kiện | Ai được thông báo | Loại |
|:---|:---|:---|
| Chương được xuất bản | Người theo dõi truyện (trừ người đăng, tôn trọng cài đặt tắt thông báo) | `chapter_update` |
| Bình luận bài viết | Tác giả bài viết | `post_comment` |
| Trả lời bình luận | Tác giả bình luận gốc | `comment_reply` |
| Thả/đổi cảm xúc bài viết | Tác giả bài viết (mỗi người một thông báo mỗi bài) | `post_reaction` |
| Admin/Mod gỡ / khôi phục bài viết hoặc truyện | Tác giả bài viết / người đăng truyện | `system` |

- **Chống quá tải:** chương gửi theo từng khối 1000 người (phân trang theo khóa, nghỉ 25ms giữa các khối), tối đa 2 chương chạy cùng lúc; các thông báo lẻ (bình luận, cảm xúc...) được gộp lại, mỗi 200ms hoặc 100 tin thành **một** câu `INSERT`. Đo trên máy này: chương có 20.000 người theo dõi, API trả lời sau 55ms và đủ 20.000 thông báo sau 2,8 giây; 5 chương đăng cùng lúc (100.000 thông báo) xử lý xong không lỗi.
- **Không mất, không trùng:** tin nhắn được lưu bền (`persistent`) và chỉ được xác nhận sau khi ghi DB; mỗi thông báo có `dedupe_key` duy nhất (bảng `notifications`, migration `sql/migrations/002_notification_queue.sql`), nên worker sập giữa chừng hoặc tin bị giao lại sẽ không tạo bản trùng (theo thiết kế; kịch bản giết worker giữa chừng chưa được thử thực tế).
- **Lỗi:** thất bại thì vào hàng đợi chờ 10 giây rồi thử lại, tối đa 5 lần, sau đó vào `novel.notifications.dlq` để kiểm tra thủ công (xem ở giao diện quản trị RabbitMQ).
- **Dự phòng:** RabbitMQ chưa cấu hình hoặc chết thì API tự xử lý ngay trong tiến trình (tối đa 2 việc cùng lúc) và yêu cầu của người dùng vẫn thành công; backend và worker tự kết nối lại khi broker sống lại.
- **Mở rộng:** `docker compose up -d --scale worker=3` (bỏ dòng `container_name` của worker trước). Biến tinh chỉnh: `NOTIFY_FANOUT_CHUNK`, `NOTIFY_FANOUT_PAUSE_MS`, `NOTIFY_MAX_ATTEMPTS`, `NOTIFY_RETRY_DELAY_MS`, `WORKER_PREFETCH`, `WORKER_BATCH_MAX`, `WORKER_FLUSH_MS`, `WORKER_MAX_HEAVY`.

## 🔎 Tìm kiếm với Elasticsearch

Tìm kiếm truyện dùng **Elasticsearch 9** (container `search`, image chính thức `elasticsearch:9.5.3`, 1 node). Code tích hợp nằm trong `backend/src/services/search.service.ts`, gọi REST API bằng `fetch` có sẵn (không thêm thư viện).

- PostgreSQL vẫn là nguồn dữ liệu chính. Elasticsearch chỉ xử lý ô tìm kiếm chữ (`q`) của `GET /stories/explore`: trả về danh sách id truyện xếp theo độ liên quan (BM25), còn mọi bộ lọc khác (loại, tình trạng, thể loại, số chương, sắp xếp...) vẫn chạy bằng SQL.
- **Trường được tìm:** tên truyện (ưu tiên cao nhất), tên gốc, tác giả, họa sĩ, thể loại, tên nhóm dịch, tóm tắt.
- **Tiếng Việt:** analyzer `vi_fold` (`lowercase` + `asciifolding`) bỏ dấu khi so khớp (`nguoi cua` tìm ra "Người Cưa", `đ` ↔ `d`), chịu sai chính tả nhẹ (`fuzziness: AUTO`, chỉ trên tên/tác giả), gõ dở từ đầu (`chain`) nhờ sub-field `title.prefix` dùng edge-ngram 2-15 ký tự. Index được backend tự tạo với cấu hình này.
- **Sắp xếp:** khi có từ khóa, mặc định `sort=relevance` (theo độ liên quan). Frontend trang Khám phá có mục "Liên quan / Mới cập nhật".
- **Đồng bộ:** tự index lại toàn bộ khi backend khởi động (thử lại nền tối đa ~5 phút nếu Elasticsearch chưa sẵn sàng); tự cập nhật khi tạo, sửa (kể cả thể loại) hoặc xóa truyện.
- **Dự phòng:** Elasticsearch tắt hoặc lỗi thì tự quay về `ILIKE` trên SQL, API vẫn trả kết quả.
- **Lưu trữ:** volume `es_data`. Backend luôn reindex toàn bộ khi khởi động nên xóa volume này không mất dữ liệu.
- **Tối ưu RAM** (trong `docker-compose.yml`): heap 256MB (`-Xms256m -Xmx256m`), giới hạn direct memory 128MB và JIT code cache 64MB, `node.processors: 2` (ít thread hơn), tắt ML, tải GeoIP, ngưỡng dung lượng đĩa và các index log nội bộ (deprecation, ILM history); **không** bật `bootstrap.memory_lock` (nó ghim toàn bộ vùng nhớ JVM đã đặt trước, làm RAM thực tăng ~200MB). Container bị giới hạn cứng `mem_limit: 768m`; đo thực tế ~590MB sau khi tải. Khi kho truyện lớn (vài chục nghìn truyện trở lên) thì tăng cả `-Xms`/`-Xmx` lên 512m và `mem_limit` lên ~1g.
- **Không cần sửa DB.** Nếu bạn sửa dữ liệu truyện trực tiếp bằng SQL thì khởi động lại backend để index lại.

## ✍️ Trình soạn thảo rich text (CKEditor 5)

Dùng `ckeditor5` 48 + `@ckeditor/ckeditor5-react` 11, giao diện tiếng Việt, tông tối. Thanh công cụ: hoàn tác, tiêu đề, **đậm**, *nghiêng*, gạch chân, gạch ngang, liên kết, danh sách, trích dẫn, đường kẻ, **chèn ảnh**. Component dùng chung: `components/common/RichTextEditor.tsx` (tải theo yêu cầu, chỉ chạy ở trình duyệt) và `components/common/RichContent.tsx` (hiển thị).

| Nơi dùng | Trường |
|:---|:---|
| Bài viết Fandom (tạo và sửa) | `posts.content` |
| Đăng/sửa truyện | `stories.synopsis` (tóm tắt) |
| Tạo nhóm dịch | `translation_groups.description`, `translation_groups.rules` |

**Cố ý không dùng** cho: nội dung chương (đọc truyện dựa vào từng đoạn để bookmark theo dòng, ghi chú dịch giả và ảnh minh họa, HTML tự do sẽ làm hỏng cơ chế này), bình luận, chat nhóm, tiểu sử, form báo cáo (văn bản ngắn).

- **An toàn:** HTML được lọc ở **backend khi lưu** (`backend/src/utils/richText.ts`), chỉ giữ `p, br, strong/b, em/i, u, s, h2-h4, ul/ol/li, blockquote, a, hr`; liên kết chỉ nhận `http`, `https`, `mailto` và tự thêm `rel="noopener noreferrer nofollow"`. Script, iframe, `onerror`, `style`, `javascript:` bị loại. Frontend hiển thị bằng `dangerouslySetInnerHTML` dựa vào lần lọc này, nên **mọi đường ghi vào các trường trên phải đi qua `sanitizeRichText`**.
- **Dữ liệu cũ:** nội dung không có thẻ HTML vẫn hiển thị như văn bản thường (giữ xuống dòng).
- **Xem trước/tìm kiếm:** thẻ trong thẻ truyện, trang chủ, danh sách bài viết và danh sách nhóm được bỏ đi (`stripHtml`); Elasticsearch chỉ index phần chữ của tóm tắt.
- **Giấy phép:** CKEditor 5 phát hành kép, GPL v2+ hoặc giấy phép thương mại của CKSource. Code đang dùng `licenseKey: 'GPL'`. Nếu dự án này không phát hành theo GPL-tương-thích thì cần mua giấy phép thương mại.
- **Chèn ảnh:** nút chèn ảnh, kéo thả hoặc dán ảnh đều tải lên `POST /upload/image` (tối đa 25MB) rồi chèn đường dẫn `/uploads/posts/...`. Có chú thích ảnh, chữ thay thế (alt) và đổi cỡ 25/50/75%/gốc. Bộ lọc backend chỉ nhận ảnh nằm trong `/uploads/` của site (ảnh gắn từ trang khác, đường dẫn có `..` hoặc `javascript:` đều bị bỏ), nên bài viết chỉ có ảnh ngoài sẽ bị coi là rỗng.

## 🖼 Độ phân giải ảnh cho người đọc

Mọi ảnh đã tải lên đều lấy được bản thu nhỏ qua tham số `?w=`:

```
GET /uploads/posts/anh.png?w=800   ->  WebP rộng tối đa 800px
```

- Chỉ nhận `w` = **480, 800, 1280, 1920** (giá trị khác trả 400). Ảnh gốc không bị sửa; ảnh vốn nhỏ hơn `w`, ảnh GIF và ảnh không tồn tại được trả nguyên bản. Bản đã tạo được lưu ở `/app/.cache/images` (volume `image_cache`, xóa được bất cứ lúc nào) với `Cache-Control: immutable`.
- Người đọc chọn ở **Cài đặt đọc truyện → Độ phân giải ảnh**: Tiết kiệm (480), Cân bằng (800), **Cao (1280, mặc định)**, Gốc. Lựa chọn lưu trong trình duyệt (`localStorage`), áp dụng cho ảnh manga, ảnh minh họa trong chương và ảnh trong bài viết/tóm tắt.
- Chỉ ảnh trong `/uploads/` được đổi; ảnh ngoài (Unsplash, avatar mẫu...) giữ nguyên. Nếu bản thu nhỏ lỗi, trình duyệt tự dùng ảnh gốc.
- `POST /upload/image` trả thêm `width` và `height` của ảnh.
- Không cần sửa CSDL.

## ⏳ Hiệu ứng tải trang

Tự viết bằng CSS, không cần thư viện. Không hiện gì nếu tải nhanh (chờ 250ms), và tôn trọng chế độ "giảm chuyển động" của hệ điều hành.

| Thành phần | Khi nào hiện |
|:---|:---|
| Thanh chạy trên đầu trang (`NavigationProgress`) | Đang chuyển trang hoặc có yêu cầu `/api/v1` chưa xong quá 250ms |
| Thông báo nổi "Đang tải dữ liệu..." góc phải dưới | Vẫn chưa xong sau 1,5 giây; sau 10 giây đổi thành "Mạng đang chậm, vui lòng đợi thêm..." |
| Cuốn sách lật trang (`BookLoader`, `PageLoader`) | Trang đang chuẩn bị (`app/loading.tsx`), kiểm tra quyền, tải trình soạn thảo; sau 8 giây báo "mất nhiều thời gian hơn bình thường" |

Các trang danh sách/chi tiết vẫn giữ khung xám nhấp nháy (skeleton) như trước. Dùng `BookLoader` ở chỗ mới: `<BookLoader label="Đang tải..." delayMs={250} />`. Lưu ý `NavigationProgress` bọc `window.fetch` để đếm các yêu cầu `/api/v1` (bỏ qua `/history` và `/notifications` vì chạy nền).

## ✨ Chức năng & Trang giao diện

| Đường dẫn | Chức năng |
|:---|:---|
| `/` | Trang chủ: truyện thịnh hành, mới cập nhật, ảnh minh họa nổi bật |
| `/kham-pha` | Khám phá: tìm kiếm, lọc (loại, tình trạng, ngôn ngữ, số chương, thể loại gồm/loại trừ), sắp xếp, xem lưới/danh sách, phân trang |
| `/truyen/[slug]` | Chi tiết truyện: danh sách tập/chương (kèm mục "Chưa phân tập"), banner (thống kê lượt xem, người theo dõi, chương; đọc tiếp/đọc từ đầu/chương mới nhất; thanh công cụ theo dõi, lưu vào album, thảo luận Fandom, tải xuống, báo cáo vi phạm), thanh Quản lý dưới banner cho nhóm truyện/Admin/Mod, tag thể loại rồi đến tóm tắt, bình luận; người quản lý được sửa/xóa chương, đổi tên/xóa/sắp xếp lại tập |
| `/truyen/[slug]/[chapterSlug]` | Đọc truyện chữ (cỡ chữ, font, nền, giãn dòng) và manga, bookmark từng dòng, ghi chú dịch giả, bình luận theo chương, báo cáo, sửa/xóa chương |
| `/bookmark` | Tủ truyện theo dõi và danh sách dòng đã bookmark |
| `/lich-su` | Lịch sử đọc, "đọc tiếp", xóa từng mục hoặc toàn bộ |
| `/dang-truyen`, `/dang-truyen/sua/[slug]` | Đăng truyện mới, sửa thông tin truyện, thể loại, cộng tác viên |
| `/dang-chuong` | Soạn và nộp chương (văn bản hoặc ảnh), lưu nháp. Thêm `?edit=<chapterId>` để **sửa chương đã đăng** (tiêu đề, số chương, tập, nội dung) |
| `/nhom-dich`, `/nhom-dich/[slug]` | Danh sách nhóm dịch, tạo nhóm, thành viên và vai trò, kênh chat nhóm, duyệt người xin gia nhập |
| `/fandom`, `/fandom/[slug]` | Diễn đàn: đăng/sửa/xóa bài, phản ứng cảm xúc, bình luận; Admin/Mod gỡ hoặc khôi phục bài vi phạm |
| `/tin-nhan` | Tin nhắn riêng giữa hai người (kiểu Reddit chat): hộp thư bên trái, cuộc trò chuyện bên phải (`?u=<username>`), tin mới được đẩy ngay qua Socket.IO, đánh dấu "Đã xem". **Nhãn** riêng của mỗi người để phân loại cuộc trò chuyện (lọc bằng hàng chip, quản lý ở nút "Nhãn"), ô **tìm kiếm** theo tên và nội dung tin trong phạm vi nhãn đang chọn, **ghim** tin (cả hai người cùng thấy, thanh "Đã ghim" ở đầu khung chat), **chặn** người dùng. Mở từ nút **Nhắn tin** ở trang cá nhân hoặc biểu tượng cạnh tên tác giả bài Fandom |
| `/ma/:code` | Mở trang của một mã (truyện, chương, người dùng, nhóm, bài viết, album, báo cáo); mã hiện thành huy hiệu trên các trang đó (bấm để chép, rê chuột để xem giải nghĩa): mã người dùng ai cũng thấy trên trang hồ sơ, các mã khác chỉ Admin/Mod thấy |
| `/quen-mat-khau`, `/dat-lai-mat-khau`, `/xac-thuc-email` | Quên mật khẩu (link "Quên mật khẩu?" trong form đăng nhập), đặt mật khẩu mới từ link trong email, xác thực email |
| `/bao-cao` | Danh sách báo cáo vi phạm cho Admin/Mod: lọc theo loại nội dung (truyện, chương, bài viết, bình luận) và trạng thái, tìm theo mã báo cáo, mã/tên nội dung, mô tả; mỗi báo cáo hiện mã báo cáo, lý do, mô tả, người báo cáo, mã + link nội dung, số báo cáo đang chờ cho cùng nội dung, nội dung đã gỡ chưa; đánh dấu "đã xử lý" hoặc "bỏ qua" |
| `/da-go` | Nội dung đã gỡ (chỉ Admin/Mod): truyện và bài viết bị gỡ, lọc theo loại, tìm theo mã, tên, nội dung hoặc người đăng, xem và khôi phục |
| `/tai-khoan` | Hồ sơ, avatar, cài đặt đọc truyện, thông báo; tab quản lý vai trò (admin) |
| Navbar | Tìm nhanh, biểu tượng tin nhắn kèm số tin chưa đọc, chuông thông báo (đánh dấu đã đọc, xóa), đăng nhập/đăng ký, tài khoản demo, lối vào `/bao-cao` và `/da-go` cho Admin/Mod |

## 🔐 Phân quyền

**Không có khâu duyệt nội dung** (từ migration `019_no_approval.sql`): truyện, chương, bài Fandom và nhóm dịch đăng là hiện ngay.
Admin/Mod **không sửa, không xóa hẳn** nội dung của người khác: họ chỉ **gỡ** (xóa mềm, kèm lý do) truyện và bài viết vi phạm.
Mọi thứ bị gỡ nằm ở trang `/da-go` (chỉ Admin/Mod), tìm được theo mã, tên, nội dung, người đăng và khôi phục được.
Admin/Mod cũng không có quyền gì đặc biệt trong nhóm dịch (sửa nhóm, quản lý thành viên, chat, duyệt người xin vào): chỉ Trưởng nhóm/Mod nhóm.

- Vai trò người dùng nằm ở bảng `user_roles` (một người có nhiều vai trò): `admin`, `mod`, `translator`, `author`, `reader`. Đăng ký mới mặc định là `reader`.
- Vai trò trong nhóm dịch (`group_members.role`): `leader`, `mod`, `member`, `translator`, `editor`, `raw_provider`, `proofreader`.
- **Đăng truyện**: ai cũng đăng được truyện độc lập; đăng dưới tên nhóm thì phải là thành viên nhóm (kể cả Admin/Mod). Truyện hiện ngay; người đăng nhận danh hiệu `author` (truyện độc lập) hoặc `translator` (truyện của nhóm).
- **Được quản lý một truyện** (sửa thông tin, đăng chương, quản lý tập, cộng tác viên): người đăng truyện, thành viên nhóm dịch được gán, hoặc cộng tác viên của truyện.
- **Đăng chương** (`POST /chapters/submissions`): ai quản lý được truyện thì đăng, chương xuất bản ngay. Có thể lưu `draft`. Số chương đã có thì bị từ chối (409): sửa chương đó thay vì đăng đè.
- Khi chương được xuất bản, hệ thống tạo thông báo `chapter_update` cho người theo dõi truyện.
- **Xóa truyện** (xóa hẳn): chỉ người đăng truyện. **Gỡ truyện**: Admin/Mod (`POST /stories/:id/remove`, `approval_status = rejected`, ghi `removed_by/removed_at`), mọi danh sách, tìm kiếm, gợi ý bỏ qua nó; trang truyện vẫn mở được cho nhóm đăng truyện và Admin/Mod, kèm banner. Khôi phục: `POST /stories/:id/restore`.
- **Xóa chương**: người đăng chương, chủ truyện, leader/mod của nhóm (Admin/Mod không xóa chương, họ gỡ cả truyện).
- **Sửa chương đã đăng** (`PUT /chapters/:id`): người đăng chương, chủ truyện, leader/mod của nhóm. Sửa trực tiếp, có hiệu lực ngay, **không** gửi lại thông báo và không đổi `last_chapter_at`. Đổi sang số chương đã tồn tại sẽ bị từ chối (409).
- **Quản lý tập**: ai quản lý được truyện thì đổi tên, xóa, sắp xếp lại được các tập. Xóa tập **không xóa chương**: các chương chuyển sang mục "Chưa phân tập" (API trả về ở `unassigned_chapters`).
- **Bình luận**: chỉ tác giả được sửa; tác giả hoặc Admin/Mod được xóa (xóa mềm, kéo theo các trả lời và trừ lại bộ đếm).
- **Báo cáo vi phạm**: mọi người dùng đã đăng nhập báo cáo được truyện, chương, bình luận, bài viết (mỗi người một báo cáo đang chờ cho mỗi nội dung); chỉ Admin/Mod xem và xử lý. Chống spam: tối đa 10 báo cáo/giờ và 30 báo cáo/24 giờ mỗi người; mỗi người chỉ một báo cáo đang chờ cho mỗi nội dung (unique index `uq_reports_pending`, bấm nhiều lần cũng chỉ ghi một); báo cáo cũ vừa được xử lý thì phải chờ 24 giờ mới báo cáo lại nội dung đó.
- **Bài Fandom**: chỉ tác giả sửa và xóa. Admin/Mod gỡ bài vi phạm (`POST /posts/:id/reject`, trạng thái `rejected`, tác giả sửa bài vẫn không hiện lại) và khôi phục (`POST /posts/:id/approve`).
- **Nhóm dịch**: tạo là có ngay, người tạo là Trưởng nhóm. Người xin gia nhập vẫn do Trưởng nhóm/Mod nhóm duyệt.

## 🗄 Cơ sở dữ liệu

Schema thật gồm 31 bảng và 2 view (`sql/database.sql`). Nhóm chính:

| Nhóm | Bảng |
|:---|:---|
| Người dùng | `users`, `user_roles`, `user_settings`, `user_follows`*, `user_favorites`, `auth_tokens` (link đặt lại mật khẩu / xác thực email) |
| Truyện | `stories`, `volumes`, `chapters`, `chapter_pages`, `chapter_submissions`, `story_tags`, `tags`, `tag_categories`, `story_collaborators`, `story_views`, `story_views_daily` |
| Nhóm dịch | `translation_groups`, `group_members`, `group_join_requests`, `group_messages` |
| Tin nhắn riêng | `direct_messages` (migration `014_direct_messages.sql`; cột `pinned_at`, `pinned_by`), `dm_labels`, `dm_label_conversations`, `user_blocks` (migration `016_dm_labels_block_pin.sql`) |
| Tương tác | `bookmarks`, `reading_history`, `comments`, `comment_likes`, `notifications`, `broadcast_notifications`* |
| Fandom | `posts`, `post_tags`, `post_reactions` |
| Kiểm duyệt | `reports` |
| View | `v_trending_stories`, `v_recently_updated_stories` |

`*` = bảng đã có trong DB nhưng **chưa có API hay giao diện nào dùng** (xem Hạn chế).

**Migration cho DB đã tồn tại:** `sql/database.sql` chỉ chạy khi tạo volume mới. Với DB đang chạy: `sh scripts/migrate.sh` (xem [CI/CD & migration](#-cicd--migration)); bảng `schema_migrations` ghi lại file nào đã chạy. Lượt xem nằm ở `stories.total_views`, `chapters.total_views` và `story_views_daily` (theo ngày); bảng `story_views` (từng lượt) không còn được ghi.

**Mã thông minh** (migration `017_smart_codes.sql`): `users`, `translation_groups`, `stories`, `posts`, `albums`, `reports` có cột `code_no` (số cố định, duy nhất, cấp theo thứ tự tạo) và `code` (mã hiển thị). UUID vẫn là khóa chính. Trigger trong DB tự cấp và cập nhật mã; phần thông tin tự đổi khi dữ liệu đổi, còn số thì không, nên tra mã chỉ dựa vào số (mã cũ vẫn tra được).

| Đối tượng | Mẫu | Các phần |
|:---|:---|:---|
| Người dùng | `U-AD-26-0007` | vai trò cao nhất (AD, MO, TR dịch giả, AU tác giả, RD độc giả, cập nhật khi cấp/thu vai trò) · năm tham gia · số |
| Nhóm dịch | `G03` | số nhóm |
| Truyện | `LN-JA-G03-0042` | LN/MG · ngôn ngữ gốc · nhóm dịch hiện tại (G00 = không nhóm) · số |
| Chương | `LN-JA-G03-0042-C12` | mã truyện · số chương (`C12.5`); ghép khi trả API, không lưu cột |
| Bài viết | `P-RV-26-0015` | mục (DS, RV, FA, TH, NW, QA) · năm · số |
| Album | `AL-0007-26-0184` | số người dùng chủ album · năm · số |
| Báo cáo | `RP-CM-26-0001` | loại bị báo cáo (ST, CH, CM, PO) · năm · số |

Ghi chú thực tế: bảng `users` **không có** cột `role`, `coins`, `exp_points` (vai trò ở `user_roles`; hệ thống xu/kinh nghiệm chưa tồn tại). Bình luận (`comments`) hỗ trợ đích là `story`, `chapter` và `post` (giá trị `story` được thêm bằng `sql/migrations/001_story_comments.sql`; DB tạo mới đã có sẵn). Hệ thống này miễn phí, **không có** xu, mua chương hay cấp độ và cũng không dự định làm. Enum: `story_type` (novel/manga), `story_status` (ongoing/completed/hiatus/dropped), `approval_status` (pending/approved/rejected).

## 📡 API Endpoints (`/api/v1`)

`Auth` = cần đăng nhập; `opt` = đăng nhập không bắt buộc (nhưng ảnh hưởng quyền xem).

**Hệ thống & Auth**
- `GET /health`
- `POST /auth/login` (body: `identifier`, `password`), `POST /auth/register` (gửi kèm mail xác thực), `POST /auth/logout`, `GET /auth/me` (có `email_verified`)
- `GET /auth/accounts`: danh sách tài khoản demo (công khai, chỉ nên dùng khi dev)
- `POST /auth/change-password` (Auth; `current_password`, `new_password`): đổi mật khẩu, thu hồi token ở thiết bị khác, trả token mới cho thiết bị này
- `POST /auth/logout-all` (Auth): thu hồi mọi token, đóng socket đang mở
- `POST /auth/forgot-password` (`email`): luôn trả cùng một câu (không lộ email nào có tài khoản), gửi link `/dat-lai-mat-khau?token=` hiệu lực 1 giờ (mỗi tài khoản tối đa 1 mail mỗi 2 phút, ngoài giới hạn theo IP); `POST /auth/reset-password` (`token`, `new_password`): token dùng một lần, thu hồi mọi phiên
- `POST /auth/verify-email` (`token`, hiệu lực 24 giờ), `POST /auth/resend-verification` (Auth). Giới hạn: gửi mail 5 lần/giờ, thử token/mật khẩu hiện tại 20 lần/15 phút. DB chỉ lưu SHA-256 của token (bảng `auth_tokens`, migration `015_account_security.sql`)

**Truyện**
- `GET /stories`, `GET /stories/explore` (cùng một handler; hỗ trợ `q, type, status, tags, exclude_tags, language, min_chapters, sort, page, limit`; `sort` = `relevance | updated | views | favorites | newest | title_asc | title_desc`)
- `GET /stories/trending`, `/stories/recently-updated`, `/stories/illustrations`, `/stories/manageable` (Auth)
- `GET /stories/:slug` (opt), `GET /stories/:slug/chapters/:chapterSlug` (opt)
- `POST /stories` (Auth), `PUT /stories/:id` (Auth), `DELETE /stories/:id` (Auth, chỉ người đăng)
- `POST /stories/:id/remove` (Admin/Mod gỡ truyện, `reason` tùy chọn), `POST /stories/:id/restore` (Admin/Mod khôi phục)
- `GET|POST /stories/:id/collaborators`, `DELETE /stories/:id/collaborators/:userId`
- `POST /stories/:storyId/volumes` (Auth), `PUT /stories/:storyId/volumes/reorder` (Auth, body `{ order: [volumeId, ...] }`)
- `PUT /volumes/:id` (Auth, đổi tên/mô tả/bìa), `DELETE /volumes/:id` (Auth, giữ lại các chương)
- `GET /tags`

**Chương**
- `POST /chapters/submissions` (Auth, đăng chương: xuất bản ngay, hoặc lưu nháp với `is_draft`)
- `GET /chapters/:id` (Auth, dữ liệu để sửa), `PUT /chapters/:id` (Auth, sửa chương đã đăng), `DELETE /chapters/:id` (Auth)

**Theo dõi, Bookmark, Lịch sử**
- `GET /favorites`, `POST /favorites/toggle`, `GET /favorites/status/:storyId`
- `GET|POST /bookmarks`, `DELETE /bookmarks/:id`
- `GET|POST /history`, `DELETE /history/:id`, `DELETE /history`

**Thông báo**
- `GET /notifications`, `PUT /notifications/read-all`, `PUT /notifications/:id/read`, `DELETE /notifications/:id`

**Bình luận & Fandom**
- `GET /comments?target_type=&target_id=`, `POST /comments`, `POST /comments/:id/like`, `PUT /comments/:id` (sửa của mình), `DELETE /comments/:id` (tác giả hoặc Admin/Mod)
- `GET /posts` (opt), `GET /posts/:slug` (opt), `POST /posts`, `PUT /posts/:id`, `DELETE /posts/:id`
- `DELETE /posts/:id` chỉ tác giả. `POST /posts/:id/react`, `POST /posts/:id/reject` (Admin/Mod gỡ bài, `reason` tùy chọn), `POST /posts/:id/approve` (Admin/Mod khôi phục bài đã gỡ)

**Báo cáo vi phạm**
- `POST /reports` (Auth; body `target_type` = `story|chapter|comment|post`, `target_id`, `reason` = `spam|inappropriate|copyright|wrong_info|harassment|other`, `description`)
- `GET /reports?status=pending|resolved|dismissed|all&type=story|chapter|post|comment&q=` (Admin/Mod; mỗi dòng có `target_code`, `target_preview`, `target_path`, `target_removed`, `target_pending_count`), `PUT /reports/:id/resolve` (Admin/Mod, body `status` = `resolved|dismissed`, `resolution_note`)
- `GET /moderation/removed?type=all|story|post&q=&page=` (Admin/Mod): truyện và bài viết đã bị gỡ, mới nhất trước, 30 mục/trang; `q` khớp mã, tên, tóm tắt/nội dung bài, username người đăng

**Nhóm dịch**
- `GET /groups`, `GET /groups/:slug`, `POST /groups`, `PUT /groups/:id`
- `POST /groups/:id/members`, `PUT|DELETE /groups/:id/members/:memberUserId` (thành viên tự `DELETE` chính mình để rời nhóm; Mod nhóm chỉ quản lý được thành viên thường, chỉ Trưởng nhóm mới bổ nhiệm Trưởng nhóm/Mod; các Trưởng nhóm không hạ cấp hay xóa được nhau, chỉ chính người đó; ai cũng tự thôi chức được miễn nhóm còn ít nhất một Trưởng nhóm)
- Xin gia nhập nhóm (trưởng nhóm/mod nhóm duyệt): `POST /groups/:id/join-requests` (người dùng gửi, kèm lời nhắn tùy chọn; bị từ chối thì chờ 24 giờ mới gửi lại), `DELETE /groups/:id/join-requests/me` (hủy), `GET /groups/:id/join-requests` (danh sách chờ duyệt), `POST /groups/:id/join-requests/:requestId/approve|reject`
- `GET|POST /groups/:id/messages`, `DELETE /groups/:id/messages/:messageId` (chỉ thành viên nhóm)

**Tin nhắn riêng** (Auth)
- `GET /messages?label=&q=`: hộp thư (mỗi người một dòng, tin mới nhất, số chưa đọc, `label_ids`, `blocked`) và `unread_count` (luôn là tổng, bất kể bộ lọc). `label` lọc theo nhãn của mình; `q` tìm theo tên người và nội dung tin (trả `match_message` là tin khớp mới nhất)
- `GET /messages/:username`: 100 tin gần nhất với người đó, mọi tin đã ghim (`pinned`, kể cả tin cũ hơn), `label_ids`, `blocked_by_me`, `can_message`; mở ra là đánh dấu đã đọc
- `POST /messages/:username` (body `message`, tối đa 2000 ký tự; không tự nhắn cho mình, không nhắn tài khoản đã xóa; một trong hai đã chặn người kia → 403 "Không thể gửi tin nhắn cho người này", không lộ ai chặn ai)
- Nhãn (riêng từng người, người kia không thấy): `GET /messages/labels` (kèm số cuộc trò chuyện), `POST /messages/labels` (`name` ≤ 30 ký tự, không trùng tên; `color`: sky, emerald, amber, rose, fuchsia, teal, orange, lime; tối đa 20 nhãn), `PATCH|DELETE /messages/labels/:id` (xóa nhãn không xóa tin nhắn), `PUT /messages/:username/labels` (`label_ids`: thay toàn bộ nhãn của cuộc trò chuyện)
- Chặn: `POST|DELETE /messages/:username/block`. Chặn hai chiều: không ai gửi được cho ai, tin cũ vẫn đọc được
- Ghim: `POST|DELETE /messages/:username/pins/:messageId` (cả hai người đều ghim/bỏ ghim được và cùng thấy; tối đa 10 tin ghim mỗi cuộc trò chuyện)

**Người dùng & Upload**
- `GET /profile/me`, `PUT /profile/me`, `PUT /profile/me/settings`
- `GET /users`, `GET /users/admin/all`, `POST /users/:userId/roles`
- `GET /codes/:code`: tra mã thông minh → `{ type, path }` (không phân biệt hoa thường, chỉ dựa vào số). Nội dung ẩn trả 404 như mã sai: bài nháp hoặc bị gỡ (trừ tác giả/staff), album riêng tư (trừ chủ), người bị khóa/xóa và báo cáo (trừ Admin/Mod)
- `GET /users/:username`: hồ sơ công khai (trang `/nguoi-dung/:username`), chỉ gồm tên, ảnh, giới thiệu, vai trò công khai, thống kê, nhóm dịch và truyện đã đăng; không có email/cài đặt/lịch sử. Admin/Mod nhận thêm khối `moderation` (email, trạng thái khóa, các thao tác được phép)
- Quản trị người dùng (Admin/Mod): `POST /users/:userId/ban` (kèm `reason`), `POST /users/:userId/unban`, `DELETE /users/:userId` (xóa mềm: ẩn danh hóa và khóa tài khoản, giữ truyện; `purge_content: true` ẩn luôn bài viết và bình luận). Không ai tác động lên chính mình hoặc Admin; Mod chỉ tác động lên người dùng thường; Admin và Mod đều cấp được quyền Mod cho người dùng thường, chỉ Admin thu hồi quyền Mod (migration `sql/migrations/005_user_soft_delete.sql`)
- `POST /upload/image`, `POST /upload/images` (tối đa 10 ảnh)

## 👥 Tài khoản mẫu

Mật khẩu chung cho mọi tài khoản mẫu: **`password123`** (đã kiểm tra đăng nhập thành công). Danh sách này **không còn hiện trên form đăng nhập** trừ khi đặt `ENABLE_DEMO_ACCOUNTS=true`; các tài khoản vẫn đăng nhập được, xem mục Hạn chế.

| Username | Vai trò |
|:---|:---|
| `admin` | admin, reader |
| `mod_sakura`, `mod_kaito` | mod, reader |
| `kitsune_group`, `neko_trans`, `tanuki_san`, `usagi_editor` | translator, reader |
| `author_minh` | author, reader |
| `reader_yuki` | reader, translator |
| `reader_hana`, `reader_ryu`, `reader_sora` | reader |

Email có dạng `<tên ngắn>@novelhub.vn` (ví dụ `admin@novelhub.vn`, `sakura@novelhub.vn`, `yuki@novelhub.vn`); đăng nhập bằng username hoặc email đều được. **Xóa tài khoản mẫu và tắt `/auth/accounts` trước khi chạy thật.**

## ⚠️ Hạn chế đã biết

**Chưa có chức năng**
- Sửa chương chưa có lịch sử phiên bản (sửa là ghi đè).
- Bản nháp chương lưu trên server (`chapter_submissions` trạng thái `draft`) chưa có trang nào để xem lại; nháp trong trình duyệt (`localStorage`) thì trang đăng chương tự gợi ý khôi phục.
- Chương không gỡ riêng được: Admin/Mod chỉ gỡ cả truyện. Bài viết do tác giả tự xóa hoặc bị ẩn khi xóa tài khoản (`purge_content`) không nằm trong `/da-go`.
- Báo cáo vi phạm chưa tự ẩn/xóa nội dung: Admin/Mod phải tự xử lý rồi đánh dấu báo cáo.
- Các bảng `user_follows`, `broadcast_notifications` chưa được code sử dụng.
- Tin nhắn riêng chưa có xóa/sửa tin, gửi ảnh hay báo cáo tin nhắn; chặn chỉ áp dụng cho tin nhắn (người bị chặn vẫn thấy bài viết, bình luận của bạn).
- Test tự động mới chỉ có `isTokenRevoked` (`backend/src/middlewares/auth.middleware.test.ts`) và `parseCode` (`backend/src/controllers/code.controller.test.ts`).
- Web miễn phí nên **không làm** hệ thống xu, nạp tiền, mua chương hay cấp độ.

**Bảo mật (cần xử lý trước khi chạy thật)**
- **Tài khoản mẫu vẫn dùng mật khẩu `password123`** (kể cả `admin`), bất kể danh sách demo đang tắt. Nếu website đang mở ra Internet (ví dụ qua tunnel), hãy đổi mật khẩu hoặc xóa các tài khoản này.
- Đổi `JWT_SECRET` làm mọi phiên đăng nhập hiện có hết hiệu lực (người dùng phải đăng nhập lại). Token sống 30 ngày; thu hồi được qua đổi mật khẩu hoặc "Đăng xuất khỏi mọi thiết bị" (tab Bảo mật ở `/tai-khoan`). Frontend vẫn lưu một bản token trong `localStorage` (ngoài cookie `httpOnly`), nên XSS vẫn đọc được token; CSP giảm rủi ro này.
- Elasticsearch và RabbitMQ chạy trong mạng nội bộ Docker; Elasticsearch tắt xác thực (chỉ bind `127.0.0.1`).
- Cổng 3000 chạy HTTP thường; bật HTTPS bằng service `cloudflared` (xem [Lộ trình bảo mật](#-lộ-trình-bảo-mật)) trước khi dùng thật.
