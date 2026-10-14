# Kế hoạch: Node → NestJS, Go → chuẩn bố cục của Go (cmd/ + internal/ theo chức năng)

## Bối cảnh

Code đang chia theo tầng hạ tầng:
- catalog (Express): `controllers/`, `services/`, `middlewares/`, `utils/`. Có file 1100 dòng ôm nhiều chức năng.
- community, media (Express): mọi file nằm phẳng trong `src/`.
- 4 service Go: mọi file phẳng trong `package main`, mọi handler là method của chung một struct `server`.

Muốn hiểu một chức năng phải lục nhiều nơi.

Chủ dự án chọn theo quy chuẩn các công ty lớn hay dùng:
- **3 service Node (catalog, community, media) → NestJS.** Mỗi chức năng một module: `x.module.ts`, `x.controller.ts`, `x.service.ts`, `x.repository.ts`.
- **4 service Go (library, identity, messaging, workspace) → bố cục chuẩn Go:**
  - `cmd/<service>/` + `internal/<chức-năng>/` (theo go.dev/doc/modules/layout và golang-standards/project-layout);
  - trong mỗi chức năng: `handler → service → repository`, kiểu Clean Architecture mà Grab, Tiki, Shopee… dùng. Viết theo Uber Go Style Guide.
- **Frontend Next.js giữ nguyên.**

**Bắt buộc giữ nguyên:**
- URL, JSON trả về, mã HTTP, từng câu SQL;
- database, migration, biến môi trường;
- tên file chạy và lệnh con (`dist/server.js`, `dist/worker.js`, `dist/server.js import-legacy|healthcheck`, `identity seed-demo`, `messaging import-legacy|loadtest`, `workspace import`…).

Như vậy `docker-compose.yml`, `launch.py`, `scripts/migrate.sh` và frontend không phải sửa.

> **Cách làm (chủ dự án quyết định 2026-10-14):**
> - Toàn bộ việc này làm trên **một nhánh riêng `refactor/nestjs-go-layout`**: đổi tên từ nhánh `refactor/catalog-modules` vừa tạo, chưa có code.
> - Commit và push lên nhánh đó theo từng bước.
> - **Không mở PR merge vào `main`, không merge.** Chủ dự án tự quyết khi nào merge.
> - Giao cho một agent chạy model Sonnet làm. Mỗi "PR" trong checklist dưới đây chỉ là một mốc commit trên nhánh.
> - Bản mẫu của script so hợp đồng lấy từ `main` (chạy trước khi đổi code).

---

## A. Quy chuẩn NestJS (catalog, community, media)

```
src/
├── main.ts → server.ts      # giữ tên server.ts (dist/server.js); NestFactory.create(AppModule)
├── worker.ts                # (catalog) NestFactory.createApplicationContext(WorkerModule)
├── app.module.ts            # import mọi module chức năng + module hạ tầng
├── common/                  # dùng chung, không thuộc chức năng nào
│   ├── guards/       auth.guard.ts, optional-auth.guard.ts, roles.guard.ts, internal-auth.guard.ts
│   ├── decorators/   current-user.decorator.ts, roles.decorator.ts
│   ├── filters/      http-exception.filter.ts   (InputError / lỗi DB do client / 500 → {success:false,message})
│   ├── interceptors/ cache-json.interceptor.ts
│   ├── middleware/   request-context, security (helmet, rate limit), cookie, visitor-cookie
│   └── utils/        validation (InputError…), rich-text, slugify, ids, logger
├── infra/                   # module hạ tầng @Global
│   ├── database/  database.module.ts, db.service.ts (pg Pool, query, withTransaction)
│   ├── redis/     redis.module.ts
│   ├── queue/     queue.module.ts (RabbitMQ, outbox, consumer)
│   └── clients/   clients.module.ts (workspace, library, community, messaging, identity)
└── modules/
    └── stories/
        ├── stories.module.ts       ← khai báo: controller, provider, phụ thuộc, export
        ├── stories.controller.ts   ← @Controller('stories'), @Get/@Post, guard
        ├── stories.service.ts      ← nghiệp vụ, kiểm quyền, transaction
        ├── stories.repository.ts   ← SQL (chuyển nguyên câu)
        ├── dto/story-input.ts      ← hàm kiểm tra đầu vào sẵn có (parseStoryInput…), giữ nguyên câu báo lỗi
        ├── stories-internal.controller.ts  ← /internal/... của chức năng
        └── *.job.ts                ← việc nền (worker gọi)
```

**Module của từng service:**
- **catalog:** `system` (health, đối soát), `tags`, `codes`, `users` (/auth/me, hồ sơ, đồng bộ identity), `groups` (+ xin vào nhóm, quy trình), `stories` (+ cộng tác viên, gỡ/khôi phục, kệ hot, xóa sau 60 ngày, quyền theo truyện), `volumes`, `chapters` (đọc, đăng, sửa, xóa, áp phiên bản workspace, lượt xem), `drafts`, `search`, `exports`, `library-sync`.
- **community:** `posts`, `comments`, `reports`, `moderation`, `notify`, `legacy-import`, `internal` (codes, stats, purge).
- **media:** `upload` (`FileInterceptor`/multer, sharp, `/uploads` resize + static), `exports` (EPUB/PDF: thư mục `export/` sẵn có thành service).

**Quyết định kỹ thuật và bẫy cần tránh:**
1. **Phiên bản:** NestJS 11 (đã phát hành ≥ 2 tuần) + `reflect-metadata`, `rxjs`. tsconfig bật `experimentalDecorators`, `emitDecoratorMetadata`.
2. **Nest 11 chạy trên Express 5:**
   - `req.query` chỉ đọc;
   - `urlencoded` phải đặt `extended: true` như cũ;
   - kiểm `express-rate-limit`, `rate-limit-redis`, `helmet`, `multer` chạy đúng.
3. **POST trong Nest mặc định trả 201**, code cũ trả 200 ở phần lớn POST: đặt `@HttpCode` đúng từng route. Mã trả về phụ thuộc kết quả (chuyển tiếp mã của workspace, 201/200 khi đăng/lưu nháp): dùng `@Res({ passthrough: true })`.
4. **Lỗi:** filter toàn cục giữ đúng dạng `{success:false,message}`, 404 `Route not found: …` (catalog), `Không tìm thấy.` (community/media). `maskServerErrors` vẫn chạy.
5. **Kiểm tra đầu vào:** giữ các hàm sẵn có để câu báo lỗi tiếng Việt y nguyên. **Không** thêm class-validator.
6. **Tiền tố URL:** `setGlobalPrefix('api/v1', { exclude: ['internal/(.*)', '/'] })` (catalog). community/media không có tiền tố (gateway bỏ tiền tố như cũ).
7. **Middleware toàn cục giữ đúng thứ tự cũ.** Tắt bodyParser mặc định của Nest để tự đặt giới hạn: catalog 2mb, community 1mb, media 100kb. Timeout server (`headersTimeout`…) giữ như cũ.
8. **Lệnh con** (`healthcheck`, `import-legacy`): `server.ts` đọc `process.argv` trước khi dựng Nest, như hiện tại.
9. **Media tải file EPUB/PDF chạy thẳng** (stream): dùng `@Res()` để tự gửi, không qua serializer của Nest.
10. **Chuyển dần:** bước đầu gắn router Express cũ vào Nest (`app.use(legacyRouter)`). Chuyển từng module sang thì xóa route tương ứng khỏi router cũ. Mỗi PR chạy được, merge được riêng.

## B. Quy chuẩn Go (library, identity, messaging, workspace)

```
services/library/
├── cmd/library/main.go     # chỉ khởi động: đọc config, nối DB, dựng app, xử lý lệnh con (import-legacy…)
├── internal/
│   ├── app/                # app.go: nối phụ thuộc; routes.go: MỌI route của service, nhóm theo chức năng
│   ├── config/             # config.go
│   ├── platform/           # hạ tầng: db/, logger/, httpx/ (JSON, kiểm header ký, ký lời gọi nội bộ),
│   │                       # outbox/ + events/ (RabbitMQ), catalog/ (client gọi catalog)
│   ├── albums/             # MỖI CHỨC NĂNG MỘT PACKAGE
│   │   ├── handler.go      ← đọc request, ghi JSON
│   │   ├── service.go      ← nghiệp vụ
│   │   ├── repository.go   ← SQL (pgx), giữ nguyên câu
│   │   ├── model.go        ← struct dữ liệu
│   │   └── albums_test.go
│   ├── history/  positions/  follows/  sync/  legacy/
├── migrations/  seed/
├── Dockerfile              # go build ./cmd/library, file chạy GIỮ TÊN CŨ
└── go.mod
```

**Tách package theo chức năng:**
- **library:** `albums`, `history` (+ positions), `follows`, `sync` (bản sao từ catalog), `internal_api`, `legacy`.
- **identity:** `auth` (đăng ký, đăng nhập, mật khẩu, verify), `sessions`, `tokens`, `email` (email + mail outbox), `admin`, `seclog`, `demo`.
- **messaging:** `dm`, `groupchat`, `notifications` (notify + notify_api), `realtime` (hub WebSocket), `legacy`; `cmd/messaging` giữ lệnh con `loadtest`.
- **workspace:** `chapters` (revisions, compare, rewind; blocks + merge diff3 thành `platform/blocks`), `drafts` (+ collab), `proposals`, `tasks`, `schedule`, `importer`, `quota` (middleware).

**Quy tắc (theo Uber Go Style Guide và go.dev):**
- Package tên ngắn, chữ thường, số ít.
- Handler chỉ nhận phụ thuộc qua struct (không biến toàn cục).
- Interface khai báo ở phía dùng.
- Lỗi bọc bằng `fmt.Errorf("...: %w", err)`.
- Test nằm cạnh code.
- `internal/` để service khác không import nhầm.

**Phần tốn công:** handler hiện là method của `*server`. Mỗi package có struct `Handler{svc *Service}`, `Service{repo *Repository, ...}`; tên dùng chung phải viết hoa; gỡ phụ thuộc vòng qua `platform`. Test tích hợp sẵn có (`*_TEST_DATABASE_URL`) phải chạy lại xanh.

---

## Thứ tự làm (mỗi dòng một PR; ghi `Plan/nestjs-go-layout.md` có checklist, tick dần)

- [ ] 0. **Script so hợp đồng** `scripts/contract-snapshot.py`:
  - gọi khoảng 100 endpoint qua gateway (khách, người đọc, chủ truyện, admin) và nội bộ có ký, cho cả 7 service;
  - ghi status, khóa JSON, câu `message`;
  - chạy trên `main` để có bản mẫu.
- [x] 1. catalog: khung Nest + `common`/`infra` + router cũ gắn tạm; module `system`, `tags`, `codes`, `users`.
- [ ] 2. catalog: `groups`, `stories`, `volumes`, `search`, `exports`, `library-sync`.
- [ ] 3. catalog: `chapters`, `drafts`, worker sang `WorkerModule`; xóa router cũ và thư mục cũ.
- [x] 4. community → NestJS.
- [x] 5. media → NestJS.
- [x] 6. library → bố cục Go chuẩn (nhỏ nhất, làm mẫu).
- [x] 7. identity.
  - Ghi chú: identity giữ logic và SQL trong handler.go (không tách repository riêng) vì nhạy bảo mật: logic đan trong transaction (xoay refresh, khóa đăng nhập, ký header), chỉ chuyển chỗ để không đổi hành vi.
- [ ] 8. messaging.
- [ ] 9. workspace (lớn nhất).
- [ ] 10. Viết `docs/QUY-UOC.md` (quy chuẩn NestJS và Go ở trên, cách thêm chức năng mới), cập nhật README (kiến trúc, cấu trúc thư mục) và CLAUDE.md (lệnh, bẫy mới). Mỗi PR trước cũng sửa phần README của service đó.

## Rủi ro
- Viết lại rất nhiều code (Node ~7.000 dòng, Go ~15.000 dòng) trong khi test tự động ít. Bù lại bằng script so hợp đồng, smoke script, test Go sẵn có và thử bằng trình duyệt sau mỗi PR.
- Nest nặng hơn Express: RAM mỗi service Node tăng khoảng 20–40 MB. Đo lại bằng `docker stats`.
- Mất nhiều phiên làm việc: plan có checklist để làm tiếp từ mục `[ ]` đầu tiên.

## Kiểm tra trước mỗi lần merge
1. Node: `npx tsc --noEmit && yarn test`. Go: `gofmt -l . && go vet ./... && go test ./...` (cả test tích hợp với DB test).
2. `docker compose up -d --build <service>` (catalog thêm `worker`), log không lỗi, `/health` và `/ready` OK.
3. `python scripts/contract-snapshot.py --compare`: không lệch so với bản mẫu từ `main`.
4. Smoke script liên quan (`auth-smoke`, `workspace-smoke`, `community-smoke`, `library-smoke`, `recommender-smoke`).
5. Lệnh con vẫn chạy: `sh scripts/migrate.sh` (gọi import-legacy, seed-demo, workspace import).
6. `node scripts/bench.mjs` không chậm đi; `docker stats` ghi RAM.
7. Trình duyệt ở :3000 qua các luồng của service vừa chuyển:
   - catalog: truyện, chương, nháp → đề xuất → gộp, nhóm dịch;
   - identity: đăng nhập/đăng ký;
   - messaging: tin nhắn, thông báo realtime;
   - library: thư viện, album;
   - community: Fandom, bình luận;
   - media: tải ảnh, EPUB/PDF.

## Quy trình kiểm lỗi (bắt buộc ở mỗi phiếu và mỗi mốc)

**Ai làm gì:**
- **Haiku** chạy lệnh và trả về đạt/hỏng + tối đa ~10 dòng lỗi (khi có công cụ gọi Haiku).
- **Sonnet** đọc lỗi và sửa.
- **Opus** quyết những lỗi đổi hành vi hoặc dính bảo mật.

**1. Sau mỗi lần sửa nhỏ (rẻ, chạy liền):**
- Node: `npx tsc --noEmit | head -30`.
- Go: `gofmt -l . && go vet ./...`.

**2. Cuối mỗi phiếu (thứ tự cố định, hỏng bước nào thì dừng ở bước đó và sửa):**
1. Test: Node `yarn test | tail -5`; Go `go test ./... | tail -15` (cả test tích hợp với DB `*_test` riêng, **không bao giờ** dùng DB thật).
2. Giữ khóa `.agent-lock` (`until mkdir .agent-lock; do sleep 10; done` … `rmdir`, nhả bằng trap), rồi:
   - `docker compose up -d --build <service>` (catalog thêm `worker`);
   - `docker compose ps <service>` phải healthy/Up;
   - `docker compose logs <service> --tail 50 | grep -iE "error|warn|panic"` phải rỗng (hoặc chỉ có cảnh báo đã có trên main);
   - `python scripts/contract-snapshot.py --compare --only <nhóm>` phải 0 lệch.

     Service phụ thuộc truyện do phần catalog tạo thì thêm `catalog` vào `--only` (ví dụ `--only catalog,library`).
3. Smoke script của service (`scripts/<svc>-smoke.py | tail -10`).
4. Ghi kết quả vào báo cáo theo mẫu (KIỂM: tsc/test/snapshot/smoke ✓/✗).

**3. Cuối mỗi mốc (mỗi service xong):** full `--compare` (mọi service) 0 lệch, `sh scripts/migrate.sh` chạy hết các lệnh con không lỗi.

**4. Khi có lệch hoặc lỗi, phân loại trước khi sửa:**
- **Lỗi do refactor** (lệch status/JSON/message, route 404, 201 thay 200, thiếu guard, sai thứ tự route): sửa code, **không sửa baseline**.
- **Lệch do dữ liệu thay đổi giữa các lần chạy** (null ↔ giá trị trong danh sách, số đếm): chỉ được nới script cho đúng loại đó, ghi lý do vào commit. Opus duyệt mọi thay đổi ở phần so sánh của script.
- **Không phải lỗi refactor, đã biết:**
  - Số đếm (bình luận, theo dõi, lượt xem) trên trang truyện trễ ≤ 60s do cache công khai (`cachedPublic`). Smoke kiểm số đếm ngay thì báo hỏng giả.
  - Hạn mức theo giờ/ngày (báo cáo 10/giờ, thời gian chờ báo cáo 24 giờ, đăng bài 20/giờ…) làm smoke chạy lại bị 429. Xóa bộ đếm (`rl:*` trong Redis) hoặc dùng tài khoản khác.
  - Baseline có sẵn 3 lời gọi 429 (identity: đổi email/mật khẩu) và 2 lời gọi 500 (`catalog: story collaborators bad id`, `internal: messaging job bad`) từ main: giữ nguyên.
- **Nghi ngờ nhưng chưa rõ:** chạy lại đúng bước đó **một lần** trên dữ liệu sạch. Vẫn hỏng thì so với code main (`git stash` không dùng được vì nhiều agent chung thư mục: so bằng cách đọc code cũ trong `git show main:<file>`). Không rõ sau 2–3 cách thử thì `CẦN OPUS`.

**5. Trước khi giao nhánh cho chủ dự án (cuối cùng):**
- `docker compose down` → `python launch.py` (cài lại từ đầu với volume cũ) → full `--compare` 0 lệch.
- Mọi smoke script đạt (trừ hỏng giả đã ghi ở trên).
- `node scripts/bench.mjs` không chậm hơn rõ rệt.
- `docker stats` ghi RAM.
- Đi các luồng chính trên trình duyệt ở :3000 (danh sách ở mục trên).

## Cách làm việc Opus ↔ Sonnet (tiết kiệm token)

Chủ dự án quyết định 2026-10-14:
- **Opus** là người chia việc và duyệt: đọc code, chẻ mỗi mục checklist thành việc nhỏ, giao việc, kiểm kết quả.
- **Sonnet** chỉ làm đúng một việc được giao mỗi lần.

**1. Phiếu giao việc (Opus → Sonnet), tối đa ~15 dòng, luôn theo mẫu này:**
```
VIỆC: <một câu>
FILE: <danh sách file được đọc/sửa — chỉ đọc những file này>
LÀM: <các bước cụ thể, hình dạng code mong muốn>
KHÔNG: <điều cấm: không đổi URL/JSON/SQL, không chau chuốt thêm…>
KIỂM: <lệnh kiểm tra cụ thể>
XONG KHI: <tiêu chí dừng>
```
- Gộp các việc nhỏ cùng nhóm file vào một phiếu.
- Không gửi lại bối cảnh dài: phiếu trỏ tới mục trong plan nếu cần.

**2. Sonnet đọc ít:**
- Chỉ đọc file ghi trong phiếu và đúng mục plan được trỏ tới. Không đọc lại README/CLAUDE.md mỗi lần.
- Tìm bằng `grep -n`, đọc theo đoạn (`offset`/`limit`), không mở cả file nghìn dòng khi chỉ cần một hàm.
- Đầu ra lệnh luôn cắt ngắn:
  - log: `docker compose logs <svc> --tail 50 | grep -iE "error|warn"`;
  - test: chỉ lấy dòng tổng kết hoặc dòng lỗi (`| tail -20`);
  - `tsc`: `| head -30`.

**3. Báo cáo (Sonnet → Opus), tối đa ~10 dòng:**
```
TRẠNG THÁI: xong | dở | kẹt
COMMIT: <hash> (đã push?)
KIỂM: tsc ✓/✗ · test ✓/✗ · snapshot ✓/✗ (số chỗ lệch)
GHI CHÚ: <điều Opus cần biết, 1–3 dòng>
CẦN OPUS: <chỉ khi kẹt: câu hỏi + phương án + đề xuất, ≤5 dòng>
```
Không dán diff hay log dài vào báo cáo.

**4. Opus duyệt rẻ:**
- Xem `git show --stat <hash>`, rồi chỉ đọc diff của chỗ có rủi ro (kiểm quyền, SQL, mã HTTP, transaction).
- Không đọc lại phần chỉ chuyển chỗ nguyên văn.

**5. Giữ hay mở agent mới:**
- Việc liên tiếp trong cùng một service: nhắn tiếp cho agent đang chạy (SendMessage), để nó khỏi đọc lại code.
- Sang service khác, hoặc agent đã chạy rất dài: mở agent mới với phiếu đầu tiên (tránh bối cảnh phình to).

**6. Kiểm tra nặng làm theo mốc:**
- `contract-snapshot --compare`, smoke script, build lại Docker: chỉ chạy ở cuối mỗi mốc.
- Giữa các việc nhỏ: chỉ `tsc` + test của phần vừa sửa.

## Khi gặp vấn đề quá khó

Quy tắc của chủ dự án (2026-10-14, bản sửa):
- **Vấn đề nhẹ hoặc vừa** (lỗi kiểu, vòng import, khác biệt Express 5, lệch mã HTTP, test hỏng có nguyên nhân rõ): tự giải quyết.
- **Vấn đề quá khó hoặc quá lớn** (quyết định thiết kế đổi hành vi/bất biến; lỗi không tìm ra sau 2–3 cách thử; tách package Go phải đổi trạng thái dùng chung nhiều file; nguy cơ mất dữ liệu; đụng schema/migration hoặc bảo mật như ký xác thực, CSRF, giới hạn tốc độ):
  1. KHÔNG dừng cả lượt. Ghi vào mục "Vấn đề đang chờ" dưới đây: đã thử gì, lỗi chính xác, file liên quan, các phương án.
  2. Gửi cho Opus (phiên đã giao việc) bằng SendMessage, mở đầu `CẦN OPUS:`, nêu câu hỏi cụ thể (phương án + đề xuất của mình).
  3. Làm tiếp các mục khác không phụ thuộc; commit/push như thường. Không lách bất biến trong lúc chờ.
  4. Có câu trả lời thì áp dụng, ghi quyết định vào plan.
  Nếu không gửi được tin: ghi vào plan, làm tiếp, và liệt kê mọi câu `CẦN OPUS` còn mở ở đầu báo cáo cuối.

### Vấn đề đang chờ
(chưa có)
