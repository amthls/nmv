# 📚 NovelHub - Light Novel & Manga Platform

Nền tảng đọc **Light Novel (truyện chữ)** và **Manga (truyện tranh)** trực tuyến, có nhóm dịch, diễn đàn Fandom, bookmark từng dòng và tìm kiếm bằng **novelsearch** (search engine tự viết bằng Go, thay cho Elasticsearch).

> README này được đối chiếu trực tiếp với mã nguồn và CSDL đang chạy (routes trong `backend/src/routes/api.routes.ts`, schema thật trong PostgreSQL). Mục [Hạn chế đã biết](#-hạn-chế-đã-biết) ghi rõ những gì chưa làm.

## 📑 Mục lục
1. [Kiến trúc & Công nghệ](#-kiến-trúc--công-nghệ)
2. [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
3. [Khởi chạy](#-khởi-chạy)
4. [Biến môi trường](#-biến-môi-trường)
5. [Chống lạm dụng & DDoS](#-chống-lạm-dụng--ddos)
6. [Hàng đợi thông báo (RabbitMQ)](#-hàng-đợi-thông-báo-rabbitmq)
7. [Tìm kiếm với novelsearch (Go)](#-tìm-kiếm-với-novelsearch-go)
8. [Trình soạn thảo rich text](#️-trình-soạn-thảo-rich-text-ckeditor-5) · [Độ phân giải ảnh](#-độ-phân-giải-ảnh-cho-người-đọc) · [Hiệu ứng tải trang](#-hiệu-ứng-tải-trang)
9. [Chức năng & Trang giao diện](#-chức-năng--trang-giao-diện)
10. [Phân quyền & quy trình duyệt](#-phân-quyền--quy-trình-duyệt)
11. [Cơ sở dữ liệu](#-cơ-sở-dữ-liệu)
12. [API Endpoints](#-api-endpoints-apiv1)
13. [Tài khoản mẫu](#-tài-khoản-mẫu)
14. [Hạn chế đã biết](#-hạn-chế-đã-biết)

---

## 🛠 Kiến trúc & Công nghệ

| Tầng | Công nghệ |
|:---|:---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Lucide Icons, CKEditor 5 (trình soạn thảo rich text) |
| Backend | Node.js 22, Express, TypeScript, JWT (cookie + header), bcryptjs, multer (upload ảnh), sharp (đổi kích thước ảnh), sanitize-html |
| Database | PostgreSQL 16 (khóa chính UUID), truy vấn bằng `pg` (raw SQL); Prisma chỉ dùng cho `db pull/generate/studio` |
| Tìm kiếm | novelsearch - search engine tự viết bằng Go 1.22, không phụ thuộc thư viện ngoài (tùy chọn, có fallback về SQL `ILIKE`) |
| Hàng đợi | RabbitMQ 3.13 + worker (gửi thông báo), có dự phòng chạy trực tiếp khi broker chết |
| Cổng vào | nginx 1.27 (giới hạn tần suất, IP thật, cache ảnh) + helmet / express-rate-limit ở backend |
| Hạ tầng | Docker Compose |

```
                      (duy nhất cổng 3000 mở ra ngoài)
Trình duyệt ──> nginx gateway ──┬── /api/v1, /uploads ──> Express API ──> PostgreSQL
                                │                            │  └──────> novelsearch / Go (tùy chọn)
                                └── còn lại ──> Next.js      └─ publish ─> RabbitMQ ──> worker ──> PostgreSQL
```

**8 container** (`docker compose ps`): `gateway`, `frontend`, `backend`, `worker`, `postgres`, `search`, `rabbitmq`, cộng `pgadmin` khi bật profile `tools`. Chỉ `gateway` (cổng 3000) mở ra mạng; backend, Postgres, novelsearch và giao diện quản trị RabbitMQ chỉ nghe trên `127.0.0.1`, còn frontend và worker không mở cổng nào.

Trình duyệt gọi `/api/v1/...` và `/uploads/...` cùng origin; qua gateway các đường dẫn này đi thẳng tới backend. Khi chạy frontend riêng (không có gateway), `frontend/next.config.mjs` vẫn chuyển tiếp sang `http://backend:5000` (địa chỉ **viết cứng**, biến `API_URL` không được dùng).

## 📂 Cấu trúc thư mục

```
├── backend/
│   ├── src/
│   │   ├── config/db.ts              # pg Pool + PrismaClient
│   │   ├── controllers/              # auth, story, chapter, comment, group, post, bookmark, history,
│   │   │                             # notification, tag, upload, user
│   │   ├── middlewares/              # auth (requireAuth/optionalAuth/requireRole), upload
│   │   ├── services/search.service.ts# tích hợp novelsearch (search-service/, Go)
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
├── search-service/                   # novelsearch: search engine thay Elasticsearch, viết bằng Go (không có deps ngoài)
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
cp .env.example .env         # BẮT BUỘC đặt JWT_SECRET và RABBITMQ_PASSWORD (openssl rand -hex 32); compose không chạy nếu thiếu
docker compose up -d --build # gateway + frontend + backend + worker + postgres + search + rabbitmq
```

| Dịch vụ | Địa chỉ | Ghi chú |
|:---|:---|:---|
| Website (gateway) | http://localhost:3000 | Cổng vào duy nhất; frontend dùng Node 20 (hết hỗ trợ chính thức, nên nâng lên 22 như backend) |
| Backend API | `127.0.0.1:5000/api/v1` | Chỉ máy chủ; kiểm tra `/api/v1/health` (có trường `queue`: `up`/`down`/`disabled`) |
| PostgreSQL | `127.0.0.1:5432` | Chỉ máy chủ; user `postgres`, DB `novel_platform` |
| RabbitMQ quản trị | http://127.0.0.1:15673 | Chỉ máy chủ; đăng nhập bằng `RABBITMQ_USER` / `RABBITMQ_PASSWORD` |
| novelsearch (search) | `127.0.0.1:9201` | **chỉ bind localhost**; engine Go tự viết, không có xác thực/API key nào cả (không được mở ra ngoài) |
| pgAdmin | http://localhost:5050 | tùy chọn: `docker compose --profile tools up -d pgadmin` |

Lần đầu tạo volume, Postgres tự nạp `sql/database.sql`. Backend tự tạo index trong novelsearch và đồng bộ toàn bộ truyện khi khởi động.

Chạy không qua Docker (cần Postgres sẵn): `yarn dev:local` (backend + frontend), các script `yarn db:check | db:import | db:studio`.

## ⚙️ Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|:---|:---|:---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | `postgres` / `postgres` / `novel_platform` / `5432` | Cấu hình Postgres |
| `PORT` | `5000` | Cổng backend |
| `JWT_SECRET` | *(không có)* | **Bắt buộc**, tối thiểu 32 ký tự. Ở production backend từ chối khởi động nếu thiếu hoặc còn là giá trị mặc định cũ |
| `JWT_EXPIRES_IN` | `7d` | Có trong compose, nhưng code hiện ký token 30 ngày cố định |
| `CORS_ORIGIN` | `http://localhost:3000` | Đổi thành domain thật khi đưa lên tunnel/domain |
| `RABBITMQ_URL` / `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | compose tự ghép URL từ hai biến sau | **Bắt buộc** `RABBITMQ_PASSWORD`. Để trống `RABBITMQ_URL` (chạy ngoài Docker) thì thông báo được xử lý trực tiếp, không qua hàng đợi |
| `ENABLE_DEMO_ACCOUNTS` | `false` | `true` mới hiện danh sách tài khoản demo và gợi ý mật khẩu trên form đăng nhập |
| `NOTIFY_*`, `WORKER_*` | xem bên dưới | Tinh chỉnh hàng đợi và worker |
| `SEARCH_URL` | `http://search:8091` (trong compose) | **Để trống để tắt tìm kiếm novelsearch** và dùng SQL `ILIKE` |
| `SEARCH_INDEX` | `novel_stories` | Tên index |
| `SEARCH_PORT` | `9201` | Cổng publish trên máy host (localhost) |
| `PGADMIN_*` | | Chỉ dùng với profile `tools` |

## 🛡 Chống lạm dụng & DDoS

Chống DDoS băng thông lớn phải làm ở rìa mạng (Cloudflare, tường lửa nhà mạng); phần dưới đây là những gì ứng dụng tự bảo vệ được. Ba lớp:

**1. Không lộ ra ngoài.** Chỉ `gateway` mở cổng. Backend/Postgres/novelsearch/RabbitMQ chỉ nghe `127.0.0.1`, nên không ai trong LAN hay Internet gọi thẳng API hoặc chọc vào DB được. Danh sách tài khoản demo (`/auth/accounts`) và dòng gợi ý "mật khẩu mặc định" tắt mặc định. Lỗi 5xx ở production chỉ trả "Lỗi hệ thống (mã xxxx)", chi tiết SQL/đường dẫn nằm trong log. `helmet`, `X-Powered-By` ẩn, header `nosniff`/`X-Frame-Options`/`Referrer-Policy` ở cả gateway và API.

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

**3. Backend (`middlewares/security.ts`)** giới hạn theo ngữ cảnh, dựa trên IP do gateway cấp: đăng nhập sai 10 lần/15 phút cho mỗi cặp (IP, tài khoản), đăng ký 5 lần/giờ, bình luận 30 lần/5 phút, đăng bài 20 lần/giờ, thả cảm xúc 60/phút, báo cáo 10/giờ, chat nhóm 30/phút (theo tài khoản), tìm kiếm 90/phút, ảnh thu nhỏ 300/phút. Thêm: JSON tối đa 2MB, từ khóa tìm kiếm ≤ 120 ký tự, `page` ≤ 1000, tối đa 3 tiến trình `sharp` cùng lúc, `headersTimeout`/`requestTimeout` cho server. **Upload yêu cầu đăng nhập**; đuôi file lấy từ loại MIME đã kiểm (không lấy tên do người dùng đặt) và nội dung phải giải mã được thành ảnh, nếu không bị xóa ngay (chặn "file HTML giả làm PNG" gây XSS lưu trữ).

## 📬 Hàng đợi thông báo (RabbitMQ)

Gửi thông báo cho hàng nghìn người theo dõi không còn chạy trong yêu cầu HTTP. API chỉ ghi nhận "đã có chương mới" rồi trả lời ngay; `worker` (cùng image backend, chạy `node dist/worker.js`) lo phần còn lại.

| Sự kiện | Ai được thông báo | Loại |
|:---|:---|:---|
| Chương được xuất bản | Người theo dõi truyện (trừ người đăng, tôn trọng cài đặt tắt thông báo) | `chapter_update` |
| Bình luận bài viết | Tác giả bài viết | `post_comment` |
| Trả lời bình luận | Tác giả bình luận gốc | `comment_reply` |
| Thả/đổi cảm xúc bài viết | Tác giả bài viết (mỗi người một thông báo mỗi bài) | `post_reaction` |
| Duyệt / từ chối bài viết (kể cả hàng loạt) | Tác giả bài viết | `system` |

- **Chống quá tải:** chương gửi theo từng khối 1000 người (phân trang theo khóa, nghỉ 25ms giữa các khối), tối đa 2 chương chạy cùng lúc; các thông báo lẻ (bình luận, cảm xúc...) được gộp lại, mỗi 200ms hoặc 100 tin thành **một** câu `INSERT`. Đo trên máy này: chương có 20.000 người theo dõi, API trả lời sau 55ms và đủ 20.000 thông báo sau 2,8 giây; 5 chương đăng cùng lúc (100.000 thông báo) xử lý xong không lỗi.
- **Không mất, không trùng:** tin nhắn được lưu bền (`persistent`) và chỉ được xác nhận sau khi ghi DB; mỗi thông báo có `dedupe_key` duy nhất (bảng `notifications`, migration `sql/migrations/002_notification_queue.sql`), nên worker sập giữa chừng hoặc tin bị giao lại sẽ không tạo bản trùng (theo thiết kế; kịch bản giết worker giữa chừng chưa được thử thực tế).
- **Lỗi:** thất bại thì vào hàng đợi chờ 10 giây rồi thử lại, tối đa 5 lần, sau đó vào `novel.notifications.dlq` để kiểm tra thủ công (xem ở giao diện quản trị RabbitMQ).
- **Dự phòng:** RabbitMQ chưa cấu hình hoặc chết thì API tự xử lý ngay trong tiến trình (tối đa 2 việc cùng lúc) và yêu cầu của người dùng vẫn thành công; backend và worker tự kết nối lại khi broker sống lại.
- **Mở rộng:** `docker compose up -d --scale worker=3` (bỏ dòng `container_name` của worker trước). Biến tinh chỉnh: `NOTIFY_FANOUT_CHUNK`, `NOTIFY_FANOUT_PAUSE_MS`, `NOTIFY_MAX_ATTEMPTS`, `NOTIFY_RETRY_DELAY_MS`, `WORKER_PREFETCH`, `WORKER_BATCH_MAX`, `WORKER_FLUSH_MS`, `WORKER_MAX_HEAVY`.

## 🔎 Tìm kiếm với novelsearch (Go)

`search-service/` là một search engine full-text tự viết bằng Go 1.22 (chỉ dùng thư viện chuẩn, không có dependency ngoài), thay thế hoàn toàn Elasticsearch. Nó lộ ra đúng tập REST API nhỏ mà `search.service.ts` gọi (tạo/kiểm tra index, `_bulk`, `_doc/{id}`, `_search` dạng `bool/should/multi_match`), nên phần code Node.js gọi tìm kiếm không phải sửa gì ngoài tên biến môi trường.

- PostgreSQL vẫn là nguồn dữ liệu chính. novelsearch chỉ xử lý ô tìm kiếm chữ (`q`) của `GET /stories/explore`: trả về danh sách id truyện xếp theo độ liên quan, còn mọi bộ lọc khác (loại, tình trạng, thể loại, số chương, sắp xếp...) vẫn chạy bằng SQL.
- **Trường được tìm:** tên truyện (ưu tiên cao nhất), tên gốc, tác giả, họa sĩ, thể loại, tên nhóm dịch, tóm tắt.
- **Tiếng Việt:** bỏ dấu khi so khớp (`nguoi cua` tìm ra "Người Cưa", `đ` ↔ `d` — bảng ánh xạ ký tự tự viết trong `search-service/text.go`), chịu sai chính tả nhẹ (khoảng cách Levenshtein theo ngưỡng kiểu `fuzziness: AUTO` của Elasticsearch), gõ dở từ đầu (`chain`) nhờ edge-ngram (2-15 ký tự) tự cài trên tên truyện.
- **Sắp xếp:** khi có từ khóa, mặc định `sort=relevance` (theo độ liên quan). Frontend trang Khám phá có mục "Liên quan / Mới cập nhật".
- **Đồng bộ:** tự index lại toàn bộ khi backend khởi động (thử lại nền tối đa ~5 phút nếu novelsearch chưa sẵn sàng); tự cập nhật khi tạo, sửa (kể cả thể loại) hoặc xóa truyện.
- **Dự phòng:** novelsearch tắt hoặc lỗi thì tự quay về `ILIKE` trên SQL, API vẫn trả kết quả.
- **Lưu trữ:** index nằm trong bộ nhớ, được ghi snapshot JSON xuống volume `search_data` (`/data/snapshot.json`) sau mỗi lần ghi để không mất dữ liệu khi container restart; dù vậy backend luôn reindex toàn bộ khi khởi động nên volume này không bắt buộc phải giữ.
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
- **Xem trước/tìm kiếm:** thẻ trong thẻ truyện, trang chủ, danh sách bài viết và danh sách nhóm được bỏ đi (`stripHtml`); novelsearch chỉ index phần chữ của tóm tắt.
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
| `/truyen/[slug]` | Chi tiết truyện: danh sách tập/chương (kèm mục "Chưa phân tập"), theo dõi, đánh giá sao, bình luận, báo cáo vi phạm; người quản lý được sửa/xóa chương, đổi tên/xóa/sắp xếp lại tập |
| `/truyen/[slug]/[chapterSlug]` | Đọc truyện chữ (cỡ chữ, font, nền, giãn dòng) và manga, bookmark từng dòng, ghi chú dịch giả, bình luận theo chương, báo cáo, sửa/xóa chương |
| `/bookmark` | Tủ truyện theo dõi và danh sách dòng đã bookmark |
| `/lich-su` | Lịch sử đọc, "đọc tiếp", xóa từng mục hoặc toàn bộ |
| `/dang-truyen`, `/dang-truyen/sua/[slug]` | Đăng truyện mới, sửa thông tin truyện, thể loại, cộng tác viên |
| `/dang-chuong` | Soạn và nộp chương (văn bản hoặc ảnh), lưu nháp. Thêm `?edit=<chapterId>` để **sửa chương đã đăng** (tiêu đề, số chương, tập, nội dung) |
| `/nhom-dich`, `/nhom-dich/[slug]` | Danh sách nhóm dịch, tạo nhóm, thành viên và vai trò, kênh chat nhóm, duyệt chương nộp |
| `/fandom`, `/fandom/[slug]` | Diễn đàn: đăng/sửa/xóa bài, phản ứng cảm xúc, bình luận, kiểm duyệt bài (đơn lẻ và hàng loạt) |
| `/bao-cao` | Danh sách báo cáo vi phạm cho Admin/Mod: lọc theo trạng thái, mở nội dung bị báo cáo, đánh dấu "đã xử lý" hoặc "bỏ qua" |
| `/tai-khoan` | Hồ sơ, avatar, cài đặt đọc truyện, thông báo; tab quản lý vai trò (admin) |
| Navbar | Tìm nhanh, chuông thông báo (đánh dấu đã đọc, xóa), đăng nhập/đăng ký, tài khoản demo, lối vào `/bao-cao` cho Admin/Mod |

## 🔐 Phân quyền & quy trình duyệt

- Vai trò người dùng nằm ở bảng `user_roles` (một người có nhiều vai trò): `admin`, `mod`, `translator`, `author`, `reader`. Đăng ký mới mặc định là `reader`.
- Vai trò trong nhóm dịch (`group_members.role`): `leader`, `mod`, `member`, `translator`, `editor`, `raw_provider`, `proofreader`.
- **Được quản lý một truyện:** admin, mod, người đăng truyện, thành viên nhóm dịch được gán, hoặc cộng tác viên của truyện.
- **Nộp chương** (`POST /chapters/submissions`): nếu người nộp là admin/mod, chủ truyện hoặc leader/mod của nhóm thì chương được duyệt ngay và xuất bản; ngược lại chương ở trạng thái `pending` chờ duyệt. Có thể lưu `draft`.
- **Duyệt/từ chối** (`.../approve-active`, `.../reject`): admin, mod hoặc leader/mod của nhóm.
- Khi chương được xuất bản, hệ thống tạo thông báo `chapter_update` cho người theo dõi truyện.
- **Sửa chương đã đăng** (`PUT /chapters/:id`): Admin/Mod, người đăng chương, chủ truyện, leader/mod của nhóm. Sửa trực tiếp, có hiệu lực ngay, **không** gửi lại thông báo và không đổi `last_chapter_at`. Đổi sang số chương đã tồn tại sẽ bị từ chối (409).
- **Quản lý tập**: ai quản lý được truyện thì đổi tên, xóa, sắp xếp lại được các tập. Xóa tập **không xóa chương**: các chương chuyển sang mục "Chưa phân tập" (API trả về ở `unassigned_chapters`).
- **Bình luận**: chỉ tác giả được sửa; tác giả hoặc Admin/Mod được xóa (xóa mềm, kéo theo các trả lời và trừ lại bộ đếm).
- **Báo cáo vi phạm**: mọi người dùng đã đăng nhập báo cáo được truyện, chương, bình luận, bài viết (mỗi người một báo cáo đang chờ cho mỗi nội dung); chỉ Admin/Mod xem và xử lý.
- Bài Fandom và nhóm dịch mới đều có trạng thái `pending/approved/rejected` để admin/mod duyệt.

## 🗄 Cơ sở dữ liệu

Schema thật gồm 31 bảng và 2 view (`sql/database.sql`). Nhóm chính:

| Nhóm | Bảng |
|:---|:---|
| Người dùng | `users`, `user_roles`, `user_settings`, `user_follows`*, `user_favorites` |
| Truyện | `stories`, `volumes`, `chapters`, `chapter_pages`, `chapter_submissions`, `story_tags`, `tags`, `tag_categories`, `story_ratings`, `story_collaborators`, `story_views`, `story_views_daily`* |
| Nhóm dịch | `translation_groups`, `group_members`, `group_messages` |
| Tương tác | `bookmarks`, `reading_history`, `comments`, `comment_likes`, `notifications`, `broadcast_notifications`* |
| Fandom | `posts`, `post_tags`, `post_reactions` |
| Kiểm duyệt | `reports` |
| View | `v_trending_stories`, `v_recently_updated_stories` |

`*` = bảng đã có trong DB nhưng **chưa có API hay giao diện nào dùng** (xem Hạn chế).

**Migration cho DB đã tồn tại:** `sql/database.sql` chỉ chạy khi tạo volume mới. Với DB đang chạy, áp dụng thủ công từng file trong `sql/migrations/` theo thứ tự (`001_story_comments.sql`, `002_notification_queue.sql`): `docker exec -i novel_postgres psql -U postgres -d novel_platform < sql/migrations/<tên file>`.

Ghi chú thực tế: bảng `users` **không có** cột `role`, `coins`, `exp_points` (vai trò ở `user_roles`; hệ thống xu/kinh nghiệm chưa tồn tại). Bình luận (`comments`) hỗ trợ đích là `story`, `chapter` và `post` (giá trị `story` được thêm bằng `sql/migrations/001_story_comments.sql`; DB tạo mới đã có sẵn). Hệ thống này miễn phí, **không có** xu, mua chương hay cấp độ và cũng không dự định làm. Enum: `story_type` (novel/manga), `story_status` (ongoing/completed/hiatus/dropped), `approval_status` (pending/approved/rejected).

## 📡 API Endpoints (`/api/v1`)

`Auth` = cần đăng nhập; `opt` = đăng nhập không bắt buộc (nhưng ảnh hưởng quyền xem).

**Hệ thống & Auth**
- `GET /health`
- `POST /auth/login` (body: `identifier`, `password`), `POST /auth/register`, `POST /auth/logout`, `GET /auth/me` (Auth)
- `GET /auth/accounts`: danh sách tài khoản demo (công khai, chỉ nên dùng khi dev)

**Truyện**
- `GET /stories`, `GET /stories/explore` (cùng một handler; hỗ trợ `q, type, status, tags, exclude_tags, language, min_chapters, sort, page, limit`; `sort` = `relevance | updated | views | rating | favorites | newest | title_asc | title_desc`)
- `GET /stories/trending`, `/stories/recently-updated`, `/stories/illustrations`, `/stories/manageable` (Auth)
- `GET /stories/:slug` (opt), `GET /stories/:slug/chapters/:chapterSlug` (opt)
- `POST /stories` (Auth), `PUT /stories/:id` (Auth), `DELETE /stories/:id` (Auth), `POST /stories/:slug/rate` (Auth)
- `GET|POST /stories/:id/collaborators`, `DELETE /stories/:id/collaborators/:userId`
- `POST /stories/:storyId/volumes` (Auth), `PUT /stories/:storyId/volumes/reorder` (Auth, body `{ order: [volumeId, ...] }`)
- `PUT /volumes/:id` (Auth, đổi tên/mô tả/bìa), `DELETE /volumes/:id` (Auth, giữ lại các chương)
- `GET /tags`

**Chương**
- `POST /chapters/submissions` (Auth), `GET /chapters/submissions` (opt)
- `POST /chapters/submissions/:id/approve-active` (Auth), `POST /chapters/submissions/:id/reject` (Auth)
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
- `POST /posts/:id/approve|reject|react`, `POST /posts/bulk-approve|bulk-reject`

**Báo cáo vi phạm**
- `POST /reports` (Auth; body `target_type` = `story|chapter|comment|post`, `target_id`, `reason` = `spam|inappropriate|copyright|wrong_info|harassment|other`, `description`)
- `GET /reports?status=pending|resolved|dismissed|all` (Admin/Mod), `PUT /reports/:id/resolve` (Admin/Mod, body `status` = `resolved|dismissed`, `resolution_note`)

**Nhóm dịch**
- `GET /groups`, `GET /groups/:slug`, `POST /groups`, `PUT /groups/:id`, `POST /groups/:id/approve`
- `POST /groups/:id/members`, `PUT|DELETE /groups/:id/members/:memberUserId`
- `GET|POST /groups/:id/messages`, `DELETE /groups/:id/messages/:messageId`

**Người dùng & Upload**
- `GET /profile/me`, `PUT /profile/me`, `PUT /profile/me/settings`
- `GET /users`, `GET /users/admin/all`, `POST /users/:userId/roles`, `GET /users/:username`
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
- Quên/đặt lại mật khẩu, đổi mật khẩu, xác thực email (cột `email_verified` có nhưng chưa dùng).
- Sửa chương chưa có lịch sử phiên bản (sửa là ghi đè).
- Báo cáo vi phạm chưa tự ẩn/xóa nội dung: Admin/Mod phải tự xử lý rồi đánh dấu báo cáo.
- Các bảng `user_follows`, `broadcast_notifications`, `story_views_daily` chưa được code sử dụng.
- Chưa có test tự động.
- Web miễn phí nên **không làm** hệ thống xu, nạp tiền, mua chương hay cấp độ.

**Bảo mật (cần xử lý trước khi chạy thật)**
- **Tài khoản mẫu vẫn dùng mật khẩu `password123`** (kể cả `admin`), bất kể danh sách demo đang tắt. Nếu website đang mở ra Internet (ví dụ qua tunnel), hãy đổi mật khẩu hoặc xóa các tài khoản này.
- Đổi `JWT_SECRET` làm mọi phiên đăng nhập hiện có hết hiệu lực (người dùng phải đăng nhập lại). Token sống 30 ngày, chưa có cơ chế thu hồi.
- Bộ đếm giới hạn của backend lưu trong bộ nhớ (mất khi khởi động lại, không dùng chung giữa nhiều bản backend); tầng nginx vẫn hoạt động độc lập. Muốn chạy nhiều bản backend cần chuyển sang kho dùng chung (Redis).
- novelsearch và RabbitMQ chạy trong mạng nội bộ Docker; novelsearch không có xác thực/API key nào (chỉ bind `127.0.0.1`), như Elasticsearch trước đây.
- Postgres còn dùng mật khẩu mặc định `postgres` (chỉ nghe `127.0.0.1` nên không truy cập từ ngoài; đổi mật khẩu trên volume đã có cần `ALTER USER`).
- Cổng 3000 chạy HTTP thường; cần HTTPS (Cloudflare tunnel, hoặc chứng chỉ trên gateway) khi dùng thật.
