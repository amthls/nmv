# 📚 NovelHub - Light Novel & Manga Platform

Nền tảng đọc **Light Novel (truyện chữ)** và **Manga (truyện tranh)** trực tuyến, có nhóm dịch, diễn đàn Fandom, bookmark từng dòng và tìm kiếm bằng **Elasticsearch**.

> README này được đối chiếu trực tiếp với mã nguồn và CSDL đang chạy (routes trong `backend/src/routes/api.routes.ts`, schema thật trong PostgreSQL). Mục [Hạn chế đã biết](#-hạn-chế-đã-biết) ghi rõ những gì chưa làm.

## 📑 Mục lục
1. [Kiến trúc & Công nghệ](#-kiến-trúc--công-nghệ)
2. [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
3. [Khởi chạy](#-khởi-chạy)
4. [Biến môi trường](#-biến-môi-trường)
5. [Chống lạm dụng & DDoS](#-chống-lạm-dụng--ddos) · [Hiệu năng & mở rộng](#-hiệu-năng--mở-rộng-redis-realtime-pgbouncer) · [CI/CD & migration](#-cicd--migration) · [Service identity](#-service-identity) · [Service workspace](#-service-workspace-lịch-sử-chương) · [Sự kiện giữa các service](#-sự-kiện-giữa-các-service) · [Service media](#-service-media-ảnh-epubpdf) · [Sao lưu & khôi phục](#-sao-lưu--khôi-phục) · [Lộ trình bảo mật](#-lộ-trình-bảo-mật)
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
| Backend | Node.js 22, Express, TypeScript, header danh tính ký HMAC từ gateway (đăng nhập ở service identity, Go), sanitize-html; ảnh và EPUB/PDF ở service media (multer, sharp, pdfkit) |
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
mạng "data": backend, postgres, pgbouncer, redis, rabbitmq, search, worker, media, identity, workspace
```

**10 container** (`docker compose ps`): `gateway`, `frontend`, `backend`, `worker`, `media`, `postgres`, `pgbouncer`, `redis`, `search`, `rabbitmq`, cộng `pgadmin` khi bật profile `tools` và `cloudflared` (HTTPS qua Cloudflare Tunnel) khi bật profile `tunnel`. Chỉ `gateway` (cổng 3000) mở ra mạng; backend, Postgres, Redis, Elasticsearch và giao diện quản trị RabbitMQ chỉ nghe trên `127.0.0.1`, còn frontend, pgbouncer và các worker không mở cổng nào. Gateway và frontend **không** nằm trong mạng `data`, nên không chạm được tới Postgres/Redis/RabbitMQ.

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
├── services/identity/                # service Go: tài khoản, mật khẩu, phiên, vai trò (xem mục Service identity)
├── services/workspace/               # service Go: nội dung chương + mọi phiên bản (xem mục Service workspace)
├── events/                           # JSON Schema của mọi sự kiện trên exchange novelhub.events
├── postgres/provision.sh             # container db-init: mỗi service một database + role riêng
├── backup/                           # container sao lưu: Dockerfile + backup.sh (xem Sao lưu & khôi phục)
├── backups/                          # kho restic + status.json (không commit)
├── docker-compose.yml
└── .env / .env.example
```

## 🚀 Khởi chạy

```bash
cp .env.example .env         # BẮT BUỘC đặt POSTGRES_PASSWORD, IDENTITY_DB_PASSWORD, IDENTITY_JWT_SECRET, USER_SIG_KEY_*, INTERNAL_KEY_*, ELASTIC_PASSWORD, RESTIC_PASSWORD, RABBITMQ_PASSWORD, REDIS_PASSWORD, PGADMIN_DEFAULT_PASSWORD (openssl rand -hex 24); compose không chạy nếu thiếu
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
| `CORS_ORIGIN` | `http://localhost:3000` | Đổi thành domain thật khi đưa lên tunnel/domain |
| `RABBITMQ_URL` / `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | compose tự ghép URL từ hai biến sau | **Bắt buộc** `RABBITMQ_PASSWORD`. Để trống `RABBITMQ_URL` (chạy ngoài Docker) thì thông báo được xử lý trực tiếp, không qua hàng đợi |
| `ENABLE_DEMO_ACCOUNTS` | `false` | `true` mới hiện danh sách tài khoản demo và gợi ý mật khẩu trên form đăng nhập |
| `PGADMIN_DEFAULT_PASSWORD` | *(không có)* | **Bắt buộc** (kể cả khi không bật pgAdmin, vì compose đọc cả file) |
| `SMTP_URL` / `MAIL_FROM` | *(trống)* / `NovelHub <no-reply@novelhub.local>` | Gửi mail quên mật khẩu, xác thực email, ví dụ `smtps://user:app-password@smtp.gmail.com:465`. Để trống: không gửi, mail nằm trong `mail_outbox` của `identity_db` (xem `services/identity/mail.go`). Mỗi địa chỉ nhận tối đa **10 mail/ngày** (vượt thì bỏ qua, ghi log cảnh báo) |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | *(trống)* | Cloudflare Turnstile (chống bot) cho đăng ký và quên mật khẩu: đặt **cả hai** (khóa của trang Turnstile trên tài khoản Cloudflare) rồi build lại `frontend`, khởi động lại `identity`. Trống = tắt. Khóa thử của Cloudflare: `1x00000000000000000000AA` / `1x0000000000000000000000000000000AA` |
| `SITE_URL` | `http://localhost:3000` | Địa chỉ công khai của web, dùng để tạo link trong email |
| `COOKIE_SECURE` | `false` | `true` ép cờ `Secure` cho cookie. Không cần khi đi qua Cloudflare/HTTPS proxy: cookie tự `Secure` khi `X-Forwarded-Proto: https` |
| `CLOUDFLARE_TUNNEL_TOKEN` | *(trống)* | Token của Cloudflare Tunnel cho service `cloudflared` (profile `tunnel`), xem [Lộ trình bảo mật](#-lộ-trình-bảo-mật) |
| `NOTIFY_*`, `WORKER_*` | xem bên dưới | Tinh chỉnh hàng đợi và worker |
| `SEARCH_URL` | `http://search:9200` (trong compose) | **Để trống để tắt Elasticsearch** và dùng SQL `ILIKE` |
| `SEARCH_INDEX` | `novel_stories` | Tên index |
| `SEARCH_PORT` | `9201` | Cổng publish trên máy host (localhost) |
| `IDENTITY_DB_PASSWORD` / `IDENTITY_JWT_SECRET` | *(không có)* | **Bắt buộc**, service identity: mật khẩu role `identity`, khóa ký cookie `nh_access`. `launch.py` tự sinh |
| `USER_SIG_KEY_BACKEND` / `USER_SIG_KEY_WORKSPACE` / `INTERNAL_KEY_BACKEND` / `INTERNAL_KEY_IDENTITY` / `INTERNAL_KEY_WORKSPACE` | *(không có)* | **Bắt buộc**, khóa giữa các service, **mỗi service nhận một khóa**: `USER_SIG_KEY_<svc>` ký header `X-User-*` identity trả cho gateway để chuyển tới service đó (identity + service đó giữ), `INTERNAL_KEY_<svc>` ký `X-Internal-Auth` của lời gọi nội bộ **tới** service đó (service đó + bên gọi giữ). Lộ khóa của workspace không giả được người dùng với backend. `launch.py` tự sinh (thêm vào `.env` cũ) |
| `WORKSPACE_DB_PASSWORD` | *(không có)* | **Bắt buộc**, mật khẩu role `workspace` (database `workspace_db`). `launch.py` tự sinh |
| `ELASTIC_PASSWORD` | *(không có)* | **Bắt buộc**, mật khẩu user `elastic` của Elasticsearch (compose truyền cho backend thành `SEARCH_PASSWORD`). `launch.py` tự sinh. Cố định khi volume `es_data` lần đầu chạy có bảo mật: đổi sau đó phải đổi trong ES hoặc xóa volume (index dựng lại được) |
| `GATEWAY_BIND` / `GATEWAY_PORT` | `127.0.0.1` / `3000` | Địa chỉ/cổng gateway trên máy host. Mặc định chỉ máy này vào được (đường công khai là Cloudflare tunnel); `GATEWAY_BIND=0.0.0.0` để máy khác trong LAN vào |
| `SERVICE_NAME` | `backend` | Trường `service` trong log JSON (compose đặt `worker`; media mặc định `media`) |
| `REDIS_PASSWORD` / `REDIS_PORT` | *(không có)* / `6380` | **Bắt buộc** `REDIS_PASSWORD`. Compose tự ghép `REDIS_URL` cho backend và worker |
| `RESTIC_PASSWORD` | *(không có)* | **Bắt buộc**, khóa mã hóa kho sao lưu `backups/repo`. `launch.py` tự sinh nếu thiếu và **không bao giờ đổi** (mật khẩu mới không mở được bản cũ). Mất nó là mất mọi bản sao lưu: chép ra nơi khác |
| `REDIS_URL` | compose tự ghép | Để trống (chạy ngoài Docker) thì app vẫn chạy: không cache, rate limit trong RAM, ghi lượt xem thẳng DB, không đẩy realtime (trang tự hỏi lại định kỳ) |
| `DB_POOL_MAX` | `50` | Số kết nối tối đa của mỗi tiến trình Node tới Postgres/PgBouncer |
| `PGBOUNCER_MAX_CLIENT_CONN` / `PGBOUNCER_POOL_SIZE` / `PGBOUNCER_MAX_DB_CONN` | `1000` / `20` / `60` | Kết nối từ app vào PgBouncer / kết nối thật tới Postgres |
| `VIEW_FLUSH_MS` | `60000` | Chu kỳ worker ghi lượt xem từ Redis xuống Postgres |
| `IMAGE_REGISTRY` / `IMAGE_TAG` | `local` / `latest` | Tên image; trên server deploy đặt `IMAGE_REGISTRY=ghcr.io/<owner>` để kéo image do CI build |
| `PGADMIN_*` | | Chỉ dùng với profile `tools` |

## 🛡 Chống lạm dụng & DDoS

Chống DDoS băng thông lớn phải làm ở rìa mạng (Cloudflare, tường lửa nhà mạng); phần dưới đây là những gì ứng dụng tự bảo vệ được. Ba lớp:

**1. Không lộ ra ngoài.** Chỉ `gateway` mở cổng. Backend/Postgres/Elasticsearch/RabbitMQ chỉ nghe `127.0.0.1`, nên không ai trong LAN hay Internet gọi thẳng API hoặc chọc vào DB được. Danh sách tài khoản demo (`/auth/accounts`) và dòng gợi ý "mật khẩu mặc định" tắt mặc định. Lỗi 5xx ở production chỉ trả "Lỗi hệ thống (mã xxxx)", chi tiết SQL/đường dẫn nằm trong log. `helmet`, `X-Powered-By` ẩn, header `nosniff`/`X-Frame-Options`/`Referrer-Policy` ở cả gateway và API.

**Mã yêu cầu & log.** Gateway gán mỗi yêu cầu một `X-Request-Id` (ghi đè giá trị client gửi), chuyển cho backend và trả lại trình duyệt. Lỗi 5xx hiện cho người dùng "Lỗi hệ thống… (mã <request_id>)": tìm mã đó trong log ra cả chuỗi (`docker compose logs gateway backend | grep <mã>`). Gateway, backend, worker đều ghi **log JSON một dòng** (`time, level, service, request_id, msg, …`); gateway không ghi query string và IP, backend chỉ ghi đường dẫn (không query) và `backend/src/utils/logger.ts` tự che JWT, `Bearer …`, mật khẩu trong URL, `password=`/`token=`…, email ở mọi dòng log (kể cả `console.*` cũ). Service phía sau sập (502) hoặc quá chậm (504): gateway trả **503** có mã yêu cầu, trang HTML "Web đang tạm gián đoạn" cho trang web, JSON cho `/api/` (kèm `Retry-After: 30`). Gateway trả `404` cho mọi `/internal` và `/api/*/internal` (API nội bộ giữa các service sau này), và xóa header `X-User-Id`/`X-User-Roles` client tự gửi (sau này chỉ gateway được gắn).

**2. nginx gateway (`nginx/nginx.conf`)** chặn trước khi yêu cầu tới Node:

| Đường dẫn | Giới hạn theo IP |
|:---|:---|
| `/api/identity/login` | 30 lần/phút, burst 8 |
| `/api/identity/register` | 6 lần/phút, burst 3 |
| `/api/identity/forgot-password`, `reset-password`, `verify-email`, `resend-verification`, `change-password` | 10 lần/phút, burst 5 |
| `/api/identity/*` còn lại | 20 yêu cầu/giây, burst 40 |
| `/api/media/upload/*` | 30 lần/phút, burst 10, thân tối đa 26MB |
| `/api/media/*` còn lại | 20 yêu cầu/giây, burst 40 (tải EPUB/PDF chạy thẳng, không đệm) |
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

- **Realtime:** chỉ dùng transport WebSocket (không long-polling) nên chạy nhiều bản backend không cần sticky session; lúc bắt tay, gateway hỏi identity như mọi request API (cookie `nh_access`) và gắn header danh tính ký; backend kiểm chữ ký + tài khoản không bị khóa/xóa. Cookie hết hạn thì client gọi `/api/identity/refresh` rồi kết nối lại. Worker phát sự kiện qua `@socket.io/redis-emitter`. `next dev` chạy riêng (không qua gateway) thì không có socket, trang vẫn chạy nhờ hỏi định kỳ.
- **PgBouncer chế độ transaction** không giữ trạng thái theo phiên: không dùng advisory lock theo phiên, `SET` không `LOCAL`, `LISTEN`, prepared statement có tên, hay nhiều lệnh SQL có tham số trong một `query`. Train gợi ý dùng `pg_try_advisory_xact_lock` vì lý do này.
- **Thêm bản backend:** bỏ `container_name` của `backend`, rồi `docker compose up -d --scale backend=3` (nginx tự phân giải tên `backend` qua DNS của Docker).

## 🔁 CI/CD & migration

- **Migration:** `sh scripts/migrate.sh` chạy các file mới trong `sql/migrations/` theo thứ tự tên, mỗi file một transaction, ghi vào bảng `schema_migrations`; file lỗi được rollback và script dừng với mã lỗi. Lần chạy đầu (chưa có bảng) chỉ **ghi nhận** các file hiện có là đã chạy (vì `sql/database.sql` và các DB cũ đã có chúng). Thêm migration mới: tạo file số tiếp theo, đồng thời thêm nội dung tương ứng vào `sql/database.sql` cho cài đặt mới.
- **Đo độ trễ** (mốc so sánh khi tách service): `node scripts/bench.mjs [http://localhost:3000] [100]`: p50/p95/max của trang truyện, đọc chương và API chính, chạy ~15 yêu cầu/giây (dưới giới hạn theo IP). Mốc 2026-10-10 (máy dev, có cache): API 3–7 ms, trang truyện/chương 9 ms p50, ≤ 15 ms p95.
- **CI** (`.github/workflows/ci.yml`, mọi push/PR): typecheck backend + frontend, test backend (`yarn test`: `tsx --test src/**/*.test.ts`) → `docker compose build` → quét image bằng Trivy (lỗi **CRITICAL đã có bản vá** thì fail; ngoại lệ có lý do và hạn dùng ở `.trivyignore`) → khởi động cả stack → `migrate.sh` → kiểm tra `/api/v1/health`, trang chủ, `/stories/trending`.
- **CD** (`.github/workflows/deploy.yml`, push lên `main`): build và đẩy `ghcr.io/<owner>/nmv-backend` và `nmv-frontend` (tag = commit SHA và `latest`). Bước deploy qua SSH **chỉ chạy khi** biến repo `DEPLOY_ENABLED=true` và có secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH`: `git pull` → `docker compose pull` → `migrate.sh` → `up -d` → kiểm tra health. Server cần `IMAGE_REGISTRY=ghcr.io/<owner>` trong `.env` và đã `docker login ghcr.io`.
- **Dependabot** (`.github/dependabot.yml`): mỗi tuần mở PR cập nhật npm, Docker và GitHub Actions; CI chạy trên từng PR.

## 🔑 Service identity

Service đầu tiên tách khỏi backend (`Plan/microservices.md`, chi tiết `Plan/identity.md`). Mọi đăng ký, đăng nhập, phiên, mật khẩu, email, vai trò site và khóa/xóa tài khoản đi qua đây; gateway hỏi identity cho **mọi** request `/api/v1/*` và `/socket.io/` (`auth_request` → `/internal/verify`) rồi gắn header `X-User-Id/Roles/Exp/Sig` (HMAC bằng `USER_SIG_KEY_BACKEND`; workspace nhận chữ ký riêng bằng `USER_SIG_KEY_WORKSPACE`); backend **chỉ tin header có chữ ký đúng** (`middlewares/auth.middleware.ts`), vai trò lấy từ header, hồ sơ từ bảng `users` (bản sao, cập nhật bởi worker từ sự kiện, hoặc đọc xuyên `GET /internal/users/:id` khi sự kiện chưa tới). Thiếu CSRF khi ghi → gateway trả 403 JSON; identity không trả lời → 503 JSON. Frontend: `src/lib/session.ts` (cookie, header `X-CSRF-Token`, gặp 401 thì `POST /api/identity/refresh` một lần rồi thử lại).

- `services/identity/` (Go, ~25 MB RAM, image `scratch`, chạy bằng user nobody). Database riêng `identity_db`, role Postgres riêng `identity` (không kết nối được `novel_platform`); bảng tạo bằng migration nhúng trong service (`services/identity/migrations/`), chạy lúc khởi động trong một transaction có khóa.
- Container một-lần **`db-init`** (`postgres/provision.sh`) tạo role + database cho mọi service trong `SERVICE_DBS` mỗi lần `docker compose up` (đổi mật khẩu trong `.env` là tự áp dụng), và bỏ quyền `CONNECT` mặc định trên `novel_platform`. Backup đã dump mọi database.
- Giữ: tài khoản, email, mật khẩu (**argon2id**; băm bcrypt cũ vẫn đăng nhập được và tự đổi sang argon2id), xác thực email, vai trò site, khóa/xóa tài khoản, phiên đăng nhập (mỗi thiết bị một dòng), token đặt lại mật khẩu/xác thực email, nhật ký bảo mật 90 ngày, mail tài khoản.
- Phiên: cookie `nh_access` (JWT 15 phút, chỉ mã người dùng + mã phiên), `nh_refresh` (30 ngày, chỉ gửi tới `/api/identity`, **xoay vòng** mỗi lần dùng; dùng lại token cũ sau 30 giây = bị lộ → thu hồi cả phiên), `nh_csrf` (gửi lại qua header `X-CSRF-Token` cho request ghi). Thu hồi có hiệu lực ngay (Redis `identity:revoked:`, không có Redis thì đọc Postgres).
- Mật khẩu mới: 8–128 ký tự, không nằm trong ~2.100 mật khẩu phổ biến, không chứa tên đăng nhập/phần đầu email. Sai 5 lần trong 15 phút → khóa tạm 15 phút. Đổi vai trò, khóa/mở khóa, xóa tài khoản, thu hồi mọi phiên toàn hệ thống: **nhập lại mật khẩu**.
- API `/api/identity/*` (gateway bỏ tiền tố): `POST /register|login|logout|refresh|forgot-password|reset-password|verify-email`, `GET /me`, `GET /sessions`, `DELETE /sessions/:id`, `POST /logout-all|change-password|resend-verification`, `POST /change-email {new_email, password}` (link xác nhận gửi tới email mới, báo email cũ), `POST /confirm-email-change {token}`, quản trị `POST /users/:id/roles|ban|unban`, `DELETE /users/:id`, `GET /users/:id/private`, `GET /admin/users?q=` (tìm theo email, Admin/Mod), `POST /admin/revoke-all-sessions`. Nội bộ: `GET /internal/verify` (cho `auth_request` của gateway: trả `X-User-Id/Roles/Exp/Sig` ký HMAC bằng `AUTH_HEADER_KEY`), `GET /internal/users/:id`, `GET /internal/stats` (đối soát). `/health`, `/ready`.
- **Sự kiện** qua outbox (ghi cùng transaction) → exchange topic `novelhub.events` (có xác nhận của RabbitMQ): `identity.user.created|updated|deleted` (ảnh chụp công khai, **không email**), `identity.alert`. Schema ở `events/`; test hợp đồng kiểm mọi sự kiện identity ghi ra.
- **Mail** nằm trong `mail_outbox` (ghi cùng transaction với token), gửi lại chờ tăng dần ~1 giờ, hỏng hẳn → `identity.alert`. Không có `SMTP_URL` thì không gửi; đọc link bằng: `docker compose exec postgres psql -U identity -d identity_db -c "SELECT to_addr, body_text FROM mail_outbox ORDER BY id DESC LIMIT 1"` (link không bao giờ ghi vào log).
- Tài khoản mẫu: `identity seed-demo` tạo 12 tài khoản mẫu (UUID giống seed của `sql/database.sql`, mật khẩu `password123`) **chỉ khi `identity_db` chưa có tài khoản nào** (bản cài mới); `scripts/migrate.sh` và `launch.py` gọi nó mỗi lần. DB backend không còn email, mật khẩu, token tài khoản (migration 026).
- Test: `cd services/identity && go test ./...` (test đơn vị); thêm `IDENTITY_TEST_DATABASE_URL=postgres://…/identity_test` (+ `IDENTITY_TEST_REDIS_URL`) để chạy test tích hợp (**xóa sạch database đó**). CI chạy cả hai với Postgres/Redis riêng.
- Biến môi trường (launch.py tự sinh): `IDENTITY_DB_PASSWORD`, `IDENTITY_JWT_SECRET`, `USER_SIG_KEY_BACKEND`, `USER_SIG_KEY_WORKSPACE`, `INTERNAL_KEY_IDENTITY`.

## 📝 Service workspace (lịch sử chương)

Service thứ hai tách khỏi backend (`Plan/chapter-workspace.md`, giai đoạn 1). Workspace là **nơi duy nhất giữ nội dung chương** và mọi phiên bản của nó; bảng `chapters` ở backend chỉ là **bản đọc** (độc giả vẫn đọc từ đó, có cache, không chậm đi).

- `services/workspace/` (Go, image `scratch`, `mem_limit: 128m`). Database riêng `workspace_db`, role riêng `workspace` (`db-init` tạo); migration nhúng (`services/workspace/migrations/`).
- **Lưu theo đoạn, khóa là hash:** `content_blocks(hash, data)` (sha256 của JSON chuẩn hóa của đoạn), mỗi phiên bản chỉ là mảng hash (`chapter_revisions`), `chapter_heads` giữ phiên bản hiện tại. Bản chính thức **không bao giờ bị ghi đè**: tạo, sửa, khôi phục bản cũ (rewind), xóa, khôi phục chương xóa đều là **phiên bản mới** (`source` = `import|create|edit|rewind|delete|restore`). Giữ lịch sử mãi.
- **Đường ghi:** nội dung luôn đi qua backend (lọc HTML bằng bộ lọc sẵn có) → API nội bộ của workspace (`X-Internal-Auth` ký HMAC bằng `INTERNAL_KEY_WORKSPACE`, hạn 2 phút; workspace gọi backend bằng `INTERNAL_KEY_BACKEND`): `POST /internal/chapters` (đăng = v1), `POST /internal/chapters/:id/revisions` (sửa, kèm `expected_version`: hai người sửa cùng lúc thì người sau nhận 409 thay vì đè), `POST /internal/chapters/:id/delete`, `GET /internal/chapters/:id`. Backend áp phiên bản trả về vào `chapters` **ngay** (người sửa được chuyển tới chương mới không phải chờ), rồi lần nữa qua sự kiện (lúc đó bỏ qua vì đã có).
- **Sự kiện** `workspace.revision.merged` (outbox → `novelhub.events`, schema ở `events/`) mang cả phiên bản (meta + mọi đoạn). Worker backend (hàng đợi `backend.workspace`) áp dụng khi `version` mới hơn số đã ghi ở `ws_chapter_versions` (nhớ cả chương đã xóa, nên sự kiện trễ không làm sống lại chương). Xóa chương: xóa dòng đọc nhưng **giữ bình luận** (khôi phục cùng UUID thì bình luận gắn lại). Chỉ chương mới (`create`) mới báo người theo dõi.
- **API công khai** `/api/ws/*` (gateway bỏ tiền tố, vẫn qua `auth_request` nên có header danh tính ký): `GET /chapters/:id/revisions` (danh sách phiên bản), `GET /chapters/:id/revisions/:v`, `GET /chapters/:id/compare?from=&to=` (so theo đoạn bằng hash, LCS; so từng chữ làm ở trình duyệt), `POST /chapters/:id/rewind {to_version}`.
- **Nháp riêng** (giai đoạn 2, bảng `chapter_drafts`): truyện chữ được soạn và sửa trên nháp, chỉ **chủ nháp** đọc/sửa được, tự lưu khi gõ (`version` chống hai tab ghi đè nhau), tối đa 50 nháp đang mở mỗi người. Bấm "Sửa" một chương = mở nháp từ bản chính hiện tại (đã có nháp đang mở của chương đó thì mở lại nháp đó). **Đăng** nháp = phiên bản mới (hoặc v1 của chương mới), chỉ khi bản chính vẫn là phiên bản nháp dựa vào; nếu bản chính đã đổi thì phải **Cập nhật theo bản chính** trước: diff3 theo đoạn (gốc = phiên bản nháp dựa vào, của tôi = nháp, của họ = bản chính), đoạn chỉ một bên sửa tự gộp, đoạn cả hai cùng sửa thì người dùng chọn *bản của tôi* / *bản chính* / *cả hai*; tiêu đề, số chương, tập, lời nhắn so từng trường. Chỉ **người giữ truyện** đăng thẳng nháp của mình (= sửa thẳng); người đóng góp khác gửi **đề xuất** (giai đoạn 3, bên dưới). Truyện tranh chưa dùng nháp.
- **Đề xuất** (giai đoạn 3, bảng `draft_rounds`, `draft_comments`): người đóng góp bấm **Gửi đề xuất** (kèm lời nhắn) → nháp khóa, chụp một *vòng* (mảng hash + phiên bản dựa vào), người giữ truyện được **thông báo** (hàng đợi, bấm mở `/ws/de-xuat/:id`). Trang duyệt: thay đổi so với bản chính lúc gửi (gập các đoạn không đổi), "thay đổi từ lần gửi trước", **góp ý theo đoạn** và góp ý chung (chủ nháp + người giữ truyện). Người giữ truyện **Gộp** (bản chính đã đổi thì tự gộp diff3 nếu không sửa trùng; sửa trùng → phải trả lại) hoặc **Trả lại** kèm lời nhắn (nháp mở lại, chủ nháp sửa rồi gửi lại = vòng mới); chủ nháp **rút lại** được. Gộp/trả lại báo lại cho chủ nháp. Đường cũ `POST /chapters/submissions` (đăng) và `PUT /chapters/:id` với truyện chữ cũng chỉ còn cho người giữ truyện.
- **Làm chung** (giai đoạn 4a, bảng `draft_shares`, `draft_edits`): chủ nháp **chia sẻ** cho người đang tham gia truyện, người đó nhận **thẻ bản nháp trong tin nhắn** (`direct_messages.draft_id`, migration `024`; thẻ hỏi workspace quyền: người ngoài thấy "không có quyền xem"), xem được và **tạo bản sao của mình** để sửa rồi **gửi lại cho chủ nháp**; chủ nháp nhận cả bản hoặc chọn từng đoạn (mọi đoạn người giúp đã đổi đều được hỏi, phần chủ tự sửa sau đó được giữ), hoặc không nhận (bản sao mở lại cho người giúp). Chia sẻ kèm **quyền sửa**: hai người sửa thẳng một nháp **lần lượt**: ai đang sửa giữ **khóa** trên dòng nháp, tự hết sau 2 phút không gõ (người kia thấy "X đang sửa", trang tự cho sửa khi khóa nhả); mỗi lần lưu ghi ai lưu. Chủ nháp **giao hẳn** nháp cho người khác trong truyện; người giữ truyện **nhận lại** nháp của người đã rời truyện. Quyền xem của workspace chỉ nhớ kết quả "có tham gia" (30 giây): người vừa được thêm vào nhóm/truyện vào được ngay.
- **Việc và quy trình** (giai đoạn 4b, bảng `chapter_tasks`, `ws_activity`; quy trình ở `translation_groups.workflow`, migration `025`): mỗi nhóm chọn các bước trước khi gộp (RAW → DỊCH → BIÊN TẬP → HIỆU ĐÍNH, mặc định chỉ DỊCH; Trưởng nhóm/Mod nhóm đổi ở tab Nội quy của trang nhóm). Người giữ truyện **giao việc** một chương (cho một người, hoặc để trống cho ai đúng vai trò nhận, kèm hạn); người khác **nhận chương** cho mình. Mỗi bước nhận theo vai trò nhóm (RAW = `raw_provider`, DỊCH = `translator`, BIÊN TẬP = `editor`, HIỆU ĐÍNH = `proofreader`; Trưởng nhóm/Mod nhóm, thành viên thường, chủ truyện, cộng tác viên nhận mọi bước). "Làm trên nháp" mở nháp của chuỗi việc (bước sau được quyền sửa cùng nháp); **Xong bước** mở bước sau, xong bước cuối thì nháp tự gửi đề xuất (bước GỘP); trả lại → bước cuối mở lại cho người đã làm. Mở/giao việc → sự kiện `workspace.task.opened` → worker báo người được giao (hoặc mọi người có vai trò đó trong nhóm). Mỗi chương chỉ một việc đang chạy; trình soạn thảo cảnh báo khi chương đã có nháp/việc của người khác. **WS nhóm** `/ws/nhom/[slug]`: tổng quan (đang làm, chờ gộp, sắp/đã trễ hạn), bảng việc 4 cột (Chưa nhận / Đang làm / Chờ duyệt / Đã đăng gần đây, lọc theo truyện, người), hoạt động gần đây.
- **Hẹn giờ đăng** (giai đoạn 4c): người giữ truyện chọn giờ khi Đăng / Gộp (`publish_at`, 1 phút – 1 năm tới). Nháp chờ khóa (`status = scheduled`); vòng lặp trong workspace (30 giây/lần, chạy được nhiều bản) đến giờ thì đăng như bấm tay (đề xuất vẫn tự gộp diff3, việc GỘP xong) → sự kiện `workspace.revision.merged` → backend dựng bản đọc, báo người theo dõi nếu là chương mới. Không đăng được (sửa trùng với bản chính đã đổi, số chương bị chiếm, truyện bị gỡ…) thì nháp về trạng thái cũ kèm lý do (`schedule_error`). Trước giờ đăng: đặt lại giờ (đăng lại với giờ mới) hoặc **Hủy hẹn** (`DELETE /api/ws/drafts/:id/schedule`, người giữ truyện).
- Diff3 khi một đoạn vừa sửa ở bên này, đoạn kề bên sửa ở bên kia (cùng số đoạn) gộp từng đoạn một, không coi cả cụm là xung đột.
- Đoạn văn chỉ có `html` là `<p>` bọc đúng chữ của nó được lưu như `{text}` (cùng hash với chương nhập cũ), nếu không thì sau một lần lưu qua trình soạn thảo mọi đoạn đều bị coi là đã sửa. Lần chạy đầu sau khi nâng cấp, service tự chuyển các đoạn cũ sang hash này (`go:canonical_block_hash` trong `schema_migrations`).
- API nháp: nội dung mới đi qua backend (lọc HTML) `POST /api/v1/drafts` (`{chapter_id}` để sửa chương, hoặc `{story_id, title, chapter_number, volume_id, content_blocks, intro_note, outro_note}` cho chương mới), `PUT /api/v1/drafts/:id` (lưu, kèm `expected_version`), `POST /api/v1/drafts/:id/publish {publish_at?}` (người giữ truyện: nháp của mình hoặc gộp đề xuất; có `publish_at` = hẹn giờ), `POST /api/v1/drafts/:id/submit {note}` | `withdraw` | `return {note}` | `share {username, can_edit, message}` | `transfer {username}` | `offer` (gửi bản sao lại cho chủ nháp); không mang nội dung mới thì gọi thẳng workspace: `GET /api/ws/proposals?story_id=` (đề xuất chờ gộp: người giữ thấy hết, người khác thấy của mình), `GET /api/ws/drafts/:id/review`, `POST /api/ws/drafts/:id/comments {body, block_hash?}`, `GET /api/ws/drafts/shared` (được nhờ), `GET /api/ws/drafts/:id/card`, `POST|DELETE /api/ws/drafts/:id/lock`, `DELETE /api/ws/drafts/:id/shares/:user`, `POST /api/ws/drafts/:id/copy`, `GET|POST|DELETE /api/ws/drafts/:id/offers/:copy` (xem / nhận / không nhận bản sao), `GET /api/ws/drafts/orphans?story_id=`, `POST /api/ws/drafts/:id/reclaim`, việc: `POST /api/ws/tasks`, `GET /api/ws/tasks?mine=1|story_id=`, `PATCH /api/ws/tasks/:id` (giao lại, hạn), `POST /api/ws/tasks/:id/claim|unclaim|start|done|cancel`, `GET /api/ws/board?story_id=…` (bảng việc + đề xuất + hoạt động của nhiều truyện), `GET /api/ws/drafts?story_id=` (nháp đang mở của tôi, có `current_version` để biết bản chính đã đổi), `GET /api/ws/drafts/:id`, `DELETE /api/ws/drafts/:id` (bỏ nháp), `GET /api/ws/drafts/:id/pull` (xem trước), `POST /api/ws/drafts/:id/pull {expected_version, to_version, choices}`. Nội bộ: `GET /internal/stats` (đối soát), `POST|GET|PUT /internal/drafts[/:id]`, `POST /internal/drafts/:id/publish|submit|withdraw|return|shares|offer|transfer|schedule`.
- **Quyền** hỏi backend `GET /internal/permissions?user=&story=` (cache 30 giây trong workspace): *người đóng góp* (chủ truyện, thành viên nhóm, cộng tác viên) xem lịch sử và so sánh; *người giữ truyện* (chủ truyện, Trưởng nhóm/Mod nhóm) khôi phục bản cũ. Truyện đang bị gỡ thì không khôi phục được (409).
- **Chuyển dữ liệu:** `workspace import` đọc `GET backend /internal/chapters/export` (phân trang), mỗi chương chưa có thành v1 (`source=import`); `scripts/migrate.sh` và `launch.py` chạy mỗi lần (an toàn khi chạy lại, cần backend đang chạy).
- Giao diện: `/ws` (nháp của tôi, truyện tôi tham gia), `/ws/truyen/[slug]` (chương chính thức + Lịch sử + Sửa, nháp của tôi trong truyện), trình soạn thảo `/dang-chuong?draft=<id>`, trang `/truyen/[slug]/lich-su/[chapterId]` (nút **Lịch sử** ở trang đọc cho người đóng góp). Thử nhanh: `python scripts/workspace-smoke.py`.
- Test: `cd services/workspace && go test ./...`; thêm `WORKSPACE_TEST_DATABASE_URL=postgres://…/workspace_test` để chạy test tích hợp (**xóa sạch database đó**). CI chạy cả hai và quét image bằng Trivy.

## 🔄 Sự kiện giữa các service

- **Đường đi:** service ghi thay đổi + dòng `outbox` trong **cùng một transaction** → tiến trình đẩy gửi lên exchange topic `novelhub.events` (có xác nhận của RabbitMQ) rồi mới đánh dấu đã gửi. Giao **ít nhất một lần**, có thể đảo thứ tự: bên nhận bỏ trùng theo `event_id` (`processed_events`) và chỉ áp dụng `version` mới hơn bản đang có. Mỗi bên nhận một hàng riêng (`backend.identity`, `backend.workspace`), lỗi thì thử lại 10 giây/lần, 5 lần vẫn lỗi → hàng cách ly `<hàng>.dlq`.
- **Tên sự kiện:** `<service>.<thực thể>.<việc>` (`identity.user.updated`, `workspace.revision.merged`). Vỏ chung `{event_id, type, version, occurred_at, request_id, data}` (`events/envelope.v1.json`).
- **Đổi schema** (`events/<tên>.v1.json`): chỉ được **thêm trường** (bên nhận bỏ qua trường lạ). Đổi nghĩa, đổi kiểu hay bỏ trường là phá vỡ → sự kiện mới `….v2.json` với tên mới, phát song song bản cũ cho tới khi mọi bên nhận đã chuyển. Test của mỗi service kiểm mọi sự kiện nó ghi ra khớp schema (CI).
- **Phát lại (dựng lại bản sao):** `docker compose run --rm identity republish [user-id]`, `docker compose run --rm workspace republish [chapter-id]` gửi lại ảnh chụp hiện tại (không tăng version): bản sao thiếu hoặc cũ thì nhận, bản đã đúng bỏ qua. Bản sao bị sửa tay mà cùng version thì phải đặt `users.identity_version = 0` / xóa dòng `ws_chapter_versions` trước khi phát lại.
- **Đối soát** (worker backend, 5 phút sau khi khởi động rồi 6 giờ/lần, `backend/src/services/reconcile.ts`): so `GET /internal/stats` của identity, workspace (số dòng + tổng version) với bản sao (`users` có `identity_version > 0`, `ws_chapter_versions`); outbox chưa gửi quá 10 phút; hàng `.dlq` có tin. Có vấn đề → **thông báo cho Admin** (mỗi loại một lần/ngày) kèm lệnh sửa.

## 🖼 Service media (ảnh, EPUB/PDF)

Tách khỏi backend ở giai đoạn D (`Plan/media.md`), TypeScript (`services/media`), database riêng `media_db`, tệp ở `./uploads` và `./exports`.
- **Ảnh:** gateway chuyển `/uploads/*` (công khai, có cache ở gateway) và `/api/media/*` (bỏ tiền tố) tới media. Tải lên: `POST /api/media/upload/image`,
  `POST /api/media/upload/images` (tối đa 10 ảnh), `POST /api/media/upload/manga-pages` (`story_id` + tối đa 20 trang; chỉ chủ truyện, thành viên nhóm,
  cộng tác viên: media hỏi backend `GET /internal/permissions`). Ảnh được kiểm tra là ảnh thật (sharp), trang manga xoay theo EXIF, thu về rộng ≤ 1600px, dải dài cắt thành nhiều phần.
- **EPUB/PDF:** `POST /api/media/stories/:slug/exports {format, mode, chapter_ids?}`, `GET /api/media/exports/:id` (tiến độ), `GET /api/media/exports/:id/download`.
  Truyện và chương vẫn ở backend: media hỏi `POST /internal/exports/source` (truyện được tải? chương nào, dấu vân tay) và lấy nội dung đã chuẩn hóa từ
  `POST /internal/exports/book`. Mỗi tệp lưu theo khóa nội dung (`story_exports.cache_key`), chọn lại đúng các chương đó thì dùng lại tệp. Tệp được dựng
  **ngay trong container media** (vòng lặp lấy hàng `queued`, `EXPORT_CONCURRENCY` tệp cùng lúc, mặc định 1); không còn hàng RabbitMQ `novel.exports`
  và container `export-worker`. Tệp không ai tải sau `EXPORT_KEEP_DAYS` ngày (mặc định 7) bị xóa mỗi giờ.
- Khóa: `USER_SIG_KEY_MEDIA` (identity ký `X-User-Sig-Media`, gateway chuyển thành `X-User-Sig` tới media), gọi backend bằng `INTERNAL_KEY_BACKEND`.
  Biến mới: `MEDIA_DB_PASSWORD`, `USER_SIG_KEY_MEDIA` (launch.py tự sinh), `MEDIA_MEMORY` (giới hạn RAM, mặc định 1g).
- Giới hạn tần suất (trong media, bộ đếm trong bộ nhớ): tải ảnh 30/10 phút, trang manga 120/10 phút, ảnh `?w=` 300/phút, yêu cầu xuất 30/10 phút.
- Crawler (`scripts/crawler.py`) nén ảnh bằng sharp trong container `media`.
- Test: `cd services/media && yarn test` (chữ ký header).

## 💾 Sao lưu & khôi phục

Container `backup` (`backup/`: postgres:16-alpine + [restic](https://restic.net) + crond, giờ Việt Nam) sao lưu vào kho mã hóa `backups/repo` trên máy host:
- **3:00 hằng ngày:** `pg_dumpall --globals-only` + `pg_dump` **từng database** (trừ `*_restored`) + thư mục `uploads/`. restic chỉ lưu phần mới (khử trùng lặp), rồi dọn theo lịch giữ **14 bản ngày · 8 bản tuần · 12 bản tháng**. Mất tối đa 1 ngày dữ liệu (không lưu WAL).
- **5:00 Chủ nhật:** `restic check` + khôi phục dump mới nhất vào database tạm `restore_check`, so số bảng (phải bằng) và số dòng (≥ 90% bản thật), rồi xóa.
- **Mỗi giờ:** quá 26 giờ không có bản thành công → thông báo hệ thống cho mọi Admin (một lần mỗi ngày). Sao lưu hoặc thử khôi phục lỗi cũng gửi thông báo.
- **Trước migration:** `scripts/migrate.sh` chụp một bản (`pre-migrate`) trước khi chạy file mới, sao lưu lỗi thì không chạy (`SKIP_BACKUP=1` để bỏ qua); `launch.py` chụp mỗi lần chạy migration (lỗi chỉ cảnh báo).
- **Trạng thái:** `backups/status/status.json`, hiện trong `/tai-khoan` → tab quản trị (Admin). Web **không** có nút khôi phục. Log: `docker compose logs backup`.
- Không sao lưu (dựng lại được): Redis, Elasticsearch, RabbitMQ, cache ảnh, `exports/`.

Chạy tay: `docker compose exec backup backup.sh run` · `docker compose exec backup backup.sh check`.

**Khôi phục** (`scripts/restore.sh`):
```sh
sh scripts/restore.sh list db                       # các bản DB (giờ, mã snapshot)
sh scripts/restore.sh db latest                     # khôi phục vào DB riêng novel_platform_restored, DB thật không đổi
sh scripts/restore.sh db <mã> --replace             # THAY DB thật: hỏi xác nhận, chụp bản hiện tại, dừng app, khôi phục, xóa cache Redis, chạy lại app
sh scripts/restore.sh uploads latest ./khoi-phuc    # ảnh ra ./khoi-phuc/data/uploads, chép lại bằng tay
```
Sau `--replace`: chỉ mục tìm kiếm Elasticsearch có thể lệch tới khi truyện được sửa/đánh index lại. Xóa DB thử sau khi xem xong: `docker compose exec backup psql -d postgres -c 'DROP DATABASE novel_platform_restored'`.

**Rủi ro còn lại:** máy chỉ có một ổ, kho sao lưu nằm cùng ổ với dữ liệu: hỏng ổ, mất máy hay ransomware là mất cả hai. Có ổ thứ hai hoặc cloud thì thêm bản ngoài máy (`restic copy` sang kho mới). Nhớ cất `RESTIC_PASSWORD` ở nơi khác.

## 🔐 Lộ trình bảo mật

Đã có: một cổng vào duy nhất, 2 mạng Docker tách tầng, `no-new-privileges`, **container app chạy bằng user `node`** (backend khởi động bằng root chỉ để sửa quyền thư mục `uploads`/`exports`/`.cache` khi cần rồi hạ quyền, xem `backend/docker-entrypoint.sh`), mật khẩu ngẫu nhiên bắt buộc cho Postgres/RabbitMQ/Redis/pgAdmin, rate limit dùng chung, lỗi 5xx bị che ở production (`maskServerErrors`: chỉ trả câu chung kèm mã tra log), **phiên theo thiết bị ở service identity** (cookie `httpOnly`, token truy cập 15 phút, làm mới xoay vòng có phát hiện dùng lại, CSRF, thu hồi tức thì; không token nào trong `localStorage`), **Content-Security-Policy** (`frontend/next.config.mjs`), cookie tự `Secure` + HSTS khi truy cập qua HTTPS, quét lỗ hổng image trong CI, Dependabot.

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
- **Chèn ảnh:** nút chèn ảnh, kéo thả hoặc dán ảnh đều tải lên `POST /api/media/upload/image` (tối đa 25MB) rồi chèn đường dẫn `/uploads/posts/...`. Có chú thích ảnh, chữ thay thế (alt) và đổi cỡ 25/50/75%/gốc. Bộ lọc backend chỉ nhận ảnh nằm trong `/uploads/` của site (ảnh gắn từ trang khác, đường dẫn có `..` hoặc `javascript:` đều bị bỏ), nên bài viết chỉ có ảnh ngoài sẽ bị coi là rỗng.

## 🖼 Độ phân giải ảnh cho người đọc

Mọi ảnh đã tải lên đều lấy được bản thu nhỏ qua tham số `?w=`:

```
GET /uploads/posts/anh.png?w=800   ->  WebP rộng tối đa 800px
```

- Chỉ nhận `w` = **480, 800, 1280, 1920** (giá trị khác trả 400). Ảnh gốc không bị sửa; ảnh vốn nhỏ hơn `w`, ảnh GIF và ảnh không tồn tại được trả nguyên bản. Service media tạo bản thu nhỏ, lưu ở `/app/.cache/images` (volume `image_cache`, xóa được bất cứ lúc nào) với `Cache-Control: immutable`.
- Người đọc chọn ở **Cài đặt đọc truyện → Độ phân giải ảnh**: Tiết kiệm (480), Cân bằng (800), **Cao (1280, mặc định)**, Gốc. Lựa chọn lưu trong trình duyệt (`localStorage`), áp dụng cho ảnh manga, ảnh minh họa trong chương và ảnh trong bài viết/tóm tắt.
- Chỉ ảnh trong `/uploads/` được đổi; ảnh ngoài (Unsplash, avatar mẫu...) giữ nguyên. Nếu bản thu nhỏ lỗi, trình duyệt tự dùng ảnh gốc.
- `POST /api/media/upload/image` trả thêm `width` và `height` của ảnh.
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
| `/truyen/[slug]/lich-su/[chapterId]` | Lịch sử phiên bản của chương (người đóng góp của truyện): danh sách phiên bản, so sánh hai bản (theo đoạn và từng chữ), người giữ truyện khôi phục bản cũ thành phiên bản mới |
| `/bookmark` | Tủ truyện theo dõi và danh sách dòng đã bookmark |
| `/lich-su` | Lịch sử đọc, "đọc tiếp", xóa từng mục hoặc toàn bộ |
| `/dang-truyen`, `/dang-truyen/sua/[slug]` | Đăng truyện mới, sửa thông tin truyện, thể loại, cộng tác viên |
| `/dang-chuong` | Soạn chương truyện chữ trên **bản nháp** (`?draft=<id>`; nháp tạo khi bắt đầu viết, tự lưu sau 3 giây), Đăng, Bỏ nháp, "Cập nhật theo bản chính" khi bản chính đã đổi. `?edit=<chapterId>` mở (hoặc mở lại) nháp của chương đã đăng; chương truyện tranh thì sửa thẳng tiêu đề, số chương, tập |
| `/ws`, `/ws/truyen/[slug]` | Workspace: nháp đang mở / đã gửi của tôi (báo khi bản chính đã đổi, "Chờ duyệt"), truyện tôi tham gia; trang của một truyện: đề xuất chờ gộp, chương chính thức kèm Lịch sử / Sửa, nháp của tôi trong truyện. Lối vào ở menu tài khoản |
| `/ws/nhom/[slug]` | Workspace nhóm (thành viên): tổng quan, bảng việc 4 cột, đề xuất chờ duyệt, đã đăng gần đây, hoạt động; lọc theo truyện, người; lối sang thành viên, chat, quy trình |
| `/ws/de-xuat/[id]` | Một đề xuất: thay đổi (theo đoạn + từng chữ, gập đoạn không đổi), thay đổi từ lần gửi trước, góp ý theo đoạn, các lần gửi; Gộp / Trả lại (người giữ truyện), Rút lại (chủ nháp) |
| `/nhom-dich`, `/nhom-dich/[slug]` | Danh sách nhóm dịch, tạo nhóm, thành viên và vai trò, kênh chat nhóm, duyệt người xin gia nhập |
| `/fandom`, `/fandom/[slug]` | Diễn đàn: đăng/sửa/xóa bài, phản ứng cảm xúc, bình luận; Admin/Mod gỡ hoặc khôi phục bài vi phạm |
| `/tin-nhan` | Tin nhắn riêng giữa hai người (kiểu Reddit chat): hộp thư bên trái, cuộc trò chuyện bên phải (`?u=<username>`), tin mới được đẩy ngay qua Socket.IO, đánh dấu "Đã xem". **Nhãn** riêng của mỗi người để phân loại cuộc trò chuyện (lọc bằng hàng chip, quản lý ở nút "Nhãn"), ô **tìm kiếm** theo tên và nội dung tin trong phạm vi nhãn đang chọn, **ghim** tin (cả hai người cùng thấy, thanh "Đã ghim" ở đầu khung chat), **chặn** người dùng. Mở từ nút **Nhắn tin** ở trang cá nhân hoặc biểu tượng cạnh tên tác giả bài Fandom |
| `/ma/:code` | Mở trang của một mã (truyện, chương, người dùng, nhóm, bài viết, album, báo cáo); mã hiện thành huy hiệu trên các trang đó (bấm để chép, rê chuột để xem giải nghĩa): mã người dùng ai cũng thấy trên trang hồ sơ, các mã khác chỉ Admin/Mod thấy |
| `/quen-mat-khau`, `/dat-lai-mat-khau`, `/xac-thuc-email` | Quên mật khẩu (link "Quên mật khẩu?" trong form đăng nhập), đặt mật khẩu mới từ link trong email, xác thực email (`?doi=1`: xác nhận email mới sau khi đổi ở tab Bảo mật). Token trong link được xóa khỏi thanh địa chỉ ngay khi đọc, trang không gửi `Referer` |
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
- **Đăng chương**: truyện chữ viết trên nháp, người giữ truyện đăng thẳng, thành viên nhóm/cộng tác viên gửi đề xuất; truyện tranh (`POST /chapters/submissions`) ai quản lý được truyện thì đăng, chương xuất bản ngay. Có thể lưu `draft`. Số chương đã có thì bị từ chối (409): sửa chương đó thay vì đăng đè.
- Khi chương được xuất bản, hệ thống tạo thông báo `chapter_update` cho người theo dõi truyện.
- **Xóa truyện** (xóa hẳn): chỉ người đăng truyện. **Gỡ truyện**: Admin/Mod (`POST /stories/:id/remove`, `approval_status = rejected`, ghi `removed_by/removed_at`), mọi danh sách, tìm kiếm, gợi ý bỏ qua nó; trang truyện vẫn mở được cho nhóm đăng truyện và Admin/Mod, kèm banner. Khôi phục: `POST /stories/:id/restore`.
- **Xóa chương**: người đăng chương, chủ truyện, leader/mod của nhóm (Admin/Mod không xóa chương, họ gỡ cả truyện).
- **Sửa chương đã đăng**: truyện chữ sửa trên nháp riêng (ai quản lý được truyện đều mở nháp được); **người giữ truyện** (chủ truyện, leader/mod của nhóm) Đăng thẳng, người khác gửi đề xuất để họ gộp. Truyện tranh sửa thẳng (`PUT /chapters/:id`: người đăng chương, chủ truyện, leader/mod của nhóm). Có hiệu lực khi đăng, mỗi lần lưu là một **phiên bản mới** ở service workspace (bản cũ còn trong lịch sử, khôi phục được), **không** gửi lại thông báo và không đổi `last_chapter_at`. Đổi sang số chương đã tồn tại sẽ bị từ chối (409).
- **Quản lý tập**: ai quản lý được truyện thì đổi tên, xóa, sắp xếp lại được các tập. Xóa tập **không xóa chương**: các chương chuyển sang mục "Chưa phân tập" (API trả về ở `unassigned_chapters`).
- **Bình luận**: chỉ tác giả được sửa; tác giả hoặc Admin/Mod được xóa (xóa mềm, kéo theo các trả lời và trừ lại bộ đếm).
- **Báo cáo vi phạm**: mọi người dùng đã đăng nhập báo cáo được truyện, chương, bình luận, bài viết (mỗi người một báo cáo đang chờ cho mỗi nội dung); chỉ Admin/Mod xem và xử lý. Chống spam: tối đa 10 báo cáo/giờ và 30 báo cáo/24 giờ mỗi người; mỗi người chỉ một báo cáo đang chờ cho mỗi nội dung (unique index `uq_reports_pending`, bấm nhiều lần cũng chỉ ghi một); báo cáo cũ vừa được xử lý thì phải chờ 24 giờ mới báo cáo lại nội dung đó.
- **Bài Fandom**: chỉ tác giả sửa và xóa. Admin/Mod gỡ bài vi phạm (`POST /posts/:id/reject`, trạng thái `rejected`, tác giả sửa bài vẫn không hiện lại) và khôi phục (`POST /posts/:id/approve`).
- **Nhóm dịch**: tạo là có ngay, người tạo là Trưởng nhóm. Người xin gia nhập vẫn do Trưởng nhóm/Mod nhóm duyệt.

## 🗄 Cơ sở dữ liệu

Schema thật gồm 31 bảng và 2 view (`sql/database.sql`). Nhóm chính:

| Nhóm | Bảng |
|:---|:---|
| Người dùng | `users`, `user_roles` (**bản sao** từ identity qua sự kiện `identity.user.*`: tên đăng nhập, vai trò, khóa/xóa; hồ sơ hiển thị vẫn do backend giữ), `user_settings`, `user_follows`*, `user_favorites`, `processed_events` (sự kiện đã áp dụng). Email, mật khẩu, token tài khoản **không có ở đây** (identity giữ; đã xóa ở migration 026) |
| Truyện | `stories`, `volumes`, `chapters`, `chapter_pages`, `chapter_submissions`, `story_tags`, `tags`, `tag_categories`, `story_collaborators`, `story_views`, `story_views_daily` |
| Nhóm dịch | `translation_groups`, `group_members`, `group_join_requests`, `group_messages` |
| Tin nhắn riêng | `direct_messages` (migration `014_direct_messages.sql`; cột `pinned_at`, `pinned_by`; `draft_id` = thẻ bản nháp workspace, migration `024`), `dm_labels`, `dm_label_conversations`, `user_blocks` (migration `016_dm_labels_block_pin.sql`) |
| Tương tác | `bookmarks`, `reading_history`, `comments`, `comment_likes`, `notifications`, `broadcast_notifications`* |
| Fandom | `posts`, `post_tags`, `post_reactions` |
| Kiểm duyệt | `reports` |
| Workspace | `ws_chapter_versions` (migration `023_ws_chapter_versions.sql`): phiên bản workspace mới nhất đã áp vào bản đọc `chapters`, gồm cả chương đã xóa. Nội dung và lịch sử nằm ở `workspace_db` (xem [Service workspace](#-service-workspace-lịch-sử-chương)) |
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
- Đăng ký, đăng nhập, phiên, mật khẩu, email: **service identity** `/api/identity/*` (xem mục [Service identity](#-service-identity)).
- `GET /auth/me` (Auth): hồ sơ hiển thị + vai trò của mình (email/xác thực: `GET /api/identity/me`)
- `GET /auth/accounts`: danh sách tài khoản demo (công khai, chỉ khi `ENABLE_DEMO_ACCOUNTS=true`)

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
- `GET /chapters/:id` (Auth, dữ liệu để sửa, kèm `ws_version`), `PUT /chapters/:id` (Auth, sửa chương đã đăng; gửi lại `expected_version` = `ws_version`, đã có người sửa trước thì 409), `DELETE /chapters/:id` (Auth)
- Nháp: `POST /drafts`, `PUT /drafts/:id`, `POST /drafts/:id/publish` (Auth). Lịch sử, so sánh, khôi phục bản cũ, danh sách/bỏ/cập nhật nháp: `/api/ws/*` (xem [Service workspace](#-service-workspace-lịch-sử-chương))

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
- `GET /groups`, `GET /groups/:slug` (có `workflow`), `POST /groups`, `PUT /groups/:id`, `PUT /groups/:id/workflow {steps}` (Trưởng nhóm/Mod nhóm; trong `raw, translate, edit, proofread`)
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
- `GET /users`
- `GET /admin/backup-status` (Admin): trạng thái sao lưu do container `backup` ghi (`null` nếu chưa chạy lần nào)
- `GET /codes/:code`: tra mã thông minh → `{ type, path }` (không phân biệt hoa thường, chỉ dựa vào số). Nội dung ẩn trả 404 như mã sai: bài nháp hoặc bị gỡ (trừ tác giả/staff), album riêng tư (trừ chủ), người bị khóa/xóa và báo cáo (trừ Admin/Mod)
- `GET /users/:username`: hồ sơ công khai (trang `/nguoi-dung/:username`), chỉ gồm tên, ảnh, giới thiệu, vai trò công khai, thống kê, nhóm dịch và truyện đã đăng; không có email/cài đặt/lịch sử. Admin/Mod nhận thêm khối `moderation` (email, trạng thái khóa, các thao tác được phép)
- Quản trị tài khoản (khóa/mở khóa, xóa, phân quyền, tra email): ở identity, phải **nhập lại mật khẩu**. Quy tắc giữ nguyên: không ai tác động lên chính mình hoặc Admin; Mod chỉ tác động lên người dùng thường; Admin và Mod đều cấp được quyền Mod cho người dùng thường, chỉ Admin thu hồi quyền Mod. Backend làm phần của mình khi nhận `identity.user.deleted` (ẩn danh hồ sơ, rời nhóm, bỏ theo dõi, `purge_content` ẩn bài viết/bình luận) và trả lời `GET /internal/users/:id/delete-check` (không xóa Trưởng nhóm duy nhất).
- Tải ảnh, EPUB/PDF: service media `/api/media/*` (xem [Service media](#-service-media-ảnh-epubpdf)).

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

Email có dạng `<tên ngắn>@novelhub.vn` (ví dụ `admin@novelhub.vn`, `sakura@novelhub.vn`, `yuki@novelhub.vn`); đăng nhập bằng username hoặc email đều được. **Xóa tài khoản mẫu và tắt `/auth/accounts` trước khi chạy thật.** Đổi mật khẩu tài khoản mẫu cũng phải theo quy tắc mới (≥ 8 ký tự, không phổ biến).

## ⚠️ Hạn chế đã biết

**Chưa có chức năng**
- Workspace đủ các giai đoạn trong `Plan/chapter-workspace.md` (lịch sử, nháp, đề xuất, làm chung, việc + quy trình, hẹn giờ đăng). Bước RAW chỉ là việc kèm ghi chú (chưa có chỗ tải bản gốc riêng). Đề xuất được gộp theo giờ hẹn không gửi thông báo "đã gộp" cho người viết (gộp tay thì có). Truyện tranh chưa dùng nháp/đề xuất. Khóa sửa không làm trình soạn thảo chỉ-đọc: ai gõ khi người khác đang giữ khóa thì không lưu được (có cảnh báo). Xóa chương vẫn theo quyền cũ (người đăng chương được xóa).
- Truyện tranh chưa dùng nháp workspace: nháp của trình đăng truyện tranh vẫn ở `chapter_submissions` (trạng thái `draft`) và chưa có trang nào để xem lại.
- Diff3 so đoạn theo nội dung: ảnh minh họa của chương nhập cũ (khối ảnh riêng) và đoạn có định dạng mà trình soạn thảo viết lại HTML khác đi vẫn có thể hiện là "đã sửa" sau lần lưu đầu.
- Chương không gỡ riêng được: Admin/Mod chỉ gỡ cả truyện. Bài viết do tác giả tự xóa hoặc bị ẩn khi xóa tài khoản (`purge_content`) không nằm trong `/da-go`.
- Báo cáo vi phạm chưa tự ẩn/xóa nội dung: Admin/Mod phải tự xử lý rồi đánh dấu báo cáo.
- Các bảng `user_follows`, `broadcast_notifications` chưa được code sử dụng.
- Tin nhắn riêng chưa có xóa/sửa tin, gửi ảnh hay báo cáo tin nhắn; chặn chỉ áp dụng cho tin nhắn (người bị chặn vẫn thấy bài viết, bình luận của bạn).
- Test tự động mới chỉ có `isTokenRevoked` (`backend/src/middlewares/auth.middleware.test.ts`) và `parseCode` (`backend/src/controllers/code.controller.test.ts`).
- Web miễn phí nên **không làm** hệ thống xu, nạp tiền, mua chương hay cấp độ.

- Sao lưu chỉ nằm trên cùng ổ đĩa với web (chưa có bản ngoài máy), xem [Sao lưu & khôi phục](#-sao-lưu--khôi-phục).

**Bảo mật (cần xử lý trước khi chạy thật)**
- **Tài khoản mẫu vẫn dùng mật khẩu `password123`** (kể cả `admin`), bất kể danh sách demo đang tắt. Nếu website đang mở ra Internet (ví dụ qua tunnel), hãy đổi mật khẩu hoặc xóa các tài khoản này.
- Đổi `IDENTITY_JWT_SECRET` làm mọi token truy cập mất hiệu lực (trình duyệt tự làm mới bằng `nh_refresh` nên người dùng không phải đăng nhập lại); đổi một khóa `USER_SIG_KEY_*`/`INTERNAL_KEY_*` thì khởi động lại mọi service dùng nó (`docker compose up -d`). Socket đang mở không bị đóng ngay khi người dùng tự "đăng xuất mọi thiết bị" (chỉ đóng khi bị khóa/xóa); lần kết nối lại sau đó bị từ chối.
- Elasticsearch và RabbitMQ chạy trong mạng nội bộ Docker, có mật khẩu. Backend dùng user `elastic` (toàn quyền) cho ES: chưa tách user chỉ có quyền trên index truyện.
- Cổng 3000 chạy HTTP thường; bật HTTPS bằng service `cloudflared` (xem [Lộ trình bảo mật](#-lộ-trình-bảo-mật)) trước khi dùng thật.
