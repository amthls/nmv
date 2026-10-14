# Quy ước mã nguồn: NestJS và Go

Áp dụng cho 3 service Node (catalog, community, media) và 4 service Go (identity, workspace, messaging, library). Recommender (Python) giữ nguyên. Nguyên tắc chung: **chia theo chức năng, không chia theo lớp kỹ thuật**; refactor không đổi URL, JSON, mã HTTP, SQL, tên file chạy (`dist/server.js`…) và lệnh con.

## 1. NestJS (catalog, community, media)

Cây thật (rút gọn từ `find <svc>/src -type d`):

```
catalog/src/
├── server.ts, worker.ts, app.module.ts
├── common/        decorators/ filters/ guards/ utils/
├── config/  middlewares/  utils/
├── infra/         behavior/ clients/ database/ mailer/ notification/ queue/ realtime/
├── worker/        WorkerModule (việc nền)
└── modules/       chapters(dto) codes drafts exports groups(dto) library-sync search
                   stories(dto) system tags users(dto) volumes

services/community/src/
├── server.ts, app.module.ts, config.ts
├── common/        decorators/ filters/ guards/ utils/
├── infra/         clients/ database/ queue/
└── modules/       comments internal legacy-import moderation notify posts reports system

services/media/src/
├── server.ts, app.module.ts
├── common/        decorators/ filters/ guards/ middleware/ utils/
├── export/        mã dựng EPUB/PDF
├── infra/         clients/ database/
└── modules/       exports (+ builder/) system upload
```

Một module chức năng (ví dụ `catalog/src/modules/stories/`):

| File | Việc |
|---|---|
| `stories.module.ts` | khai báo controller, provider, phụ thuộc, export |
| `stories.controller.ts` | `@Controller('stories')`, `@Get/@Post`, guard; chỉ đọc request, gọi service |
| `stories.service.ts` | nghiệp vụ, kiểm quyền, transaction |
| `stories.repository.ts` | SQL (chuyển nguyên câu, không ORM) |
| `dto/story-input.ts` | hàm kiểm tra đầu vào (`parseStoryInput`…) |
| `stories-internal.controller.ts` | route `/internal/...` của chức năng |
| `*.job.ts` | việc nền (worker gọi) |

Quy tắc (mỗi cái từng làm lệch hợp đồng nếu quên):

- **POST trả 201 mặc định**, code cũ trả 200: luôn đặt `@HttpCode(200)` đúng từng route. Mã phụ thuộc kết quả (chuyển tiếp mã của workspace, 201/200 khi đăng/lưu nháp): `@Res({ passthrough: true })` rồi `res.status(...)`.
- Tải file chạy thẳng (EPUB/PDF, stream): `@Res()` tự gửi, không qua serializer.
- **Không dùng class-validator.** Kiểm tra đầu vào bằng hàm sẵn có (`utils/validation.ts`, `dto/*.ts`), **giữ nguyên câu báo lỗi tiếng Việt**.
- Lỗi đi qua filter toàn cục `common/filters/http-exception.filter.ts`: luôn `{success:false,message}`; 404 catalog là `Route not found: …`, community/media là `Không tìm thấy.`. Lỗi 5xx vẫn bị `maskServerErrors` che.
- Tiền tố `api/v1` chỉ ở catalog (`setGlobalPrefix`, trừ `internal/*` và `/`); community/media không có tiền tố.
- Body parser mặc định của Nest tắt, giới hạn đặt trong `server.ts` (catalog 2mb, community 1mb, media 100kb). Thứ tự middleware toàn cục giữ như cũ.
- Nest 11 chạy trên Express 5: `req.query` chỉ đọc; `urlencoded` giữ `extended: true`.
- Lệnh con (`healthcheck`, `import-legacy`) do `server.ts` đọc `process.argv` **trước** khi dựng Nest.
- SQL chỉ nằm trong `*.repository.ts`. PgBouncer chế độ transaction: xem CLAUDE.md.

### Thêm một chức năng mới (Nest)

1. Tạo `src/modules/<ten>/` với `<ten>.module.ts`, `.controller.ts`, `.service.ts`, `.repository.ts` (và `dto/` nếu có đầu vào).
2. Repository: SQL qua `DbService` (`infra/database`). Service: nghiệp vụ + kiểm quyền, ném `InputError`/`HttpException` như code cũ. Controller: guard (`AuthGuard`…), `@HttpCode(200)` cho POST nếu hợp đồng là 200.
3. **Đăng ký:** thêm `<Ten>Module` vào `imports` của `src/app.module.ts` (catalog: việc nền thì thêm vào `src/worker/worker.module.ts`). Module khác dùng service này thì `exports` ở module này và `imports` ở module kia.
4. Đầu vào mới: viết hàm kiểm tra trong `dto/`, không thêm class-validator.
5. Kiểm: `npx tsc --noEmit`, `yarn test`, build lại service, `python scripts/contract-snapshot.py --compare --only catalog` (thêm route mới vào danh sách gọi của script nếu cần), smoke của service.

## 2. Go (identity, workspace, messaging, library)

Cây thật (`internal/`):

```
identity/    admin app auth config demo email internalapi seclog sessions tokens
             platform/{db,events,httpx,logger,outbox,redis}
workspace/   activity app board chapters config domain drafts importer proposals quota schedule tasks
             platform/{blocks,catalog,db,httpx,ids,logger,outbox}
messaging/   app config dm groupchat legacy loadtest notifications realtime
             platform/{catalog,db,events,httpx,logger,redis}
library/     albums app bookmarks config follows history internalapi legacy sync
             platform/{catalog,db,events,httpx,logger,outbox}
```

Mỗi service: `cmd/<svc>/main.go` (chỉ khởi động: config, nối DB, dựng app, lệnh con), `internal/app/{app.go,routes.go}`, `migrations/`, `Dockerfile` (`go build ./cmd/<svc>`, file chạy giữ tên cũ), `go.mod`.

Mỗi package chức năng: `handler.go` (đọc request, ghi JSON), `service.go` (nghiệp vụ), `repository.go` (SQL pgx, giữ nguyên câu), `model.go` (struct), `<ten>_test.go` cạnh code.

Quy tắc:

- Package tên ngắn, chữ thường, số ít; `internal/` để service khác không import nhầm.
- Handler/Service/Repository nhận phụ thuộc qua struct (`Handler{svc}`, `Service{repo}`), không biến toàn cục.
- **Interface khai báo ở phía dùng** (package gọi), không ở phía cài đặt.
- Bọc lỗi: `fmt.Errorf("làm gì: %w", err)`. Giữ nguyên câu lỗi trả cho client.
- Tên dùng chung giữa package phải viết hoa; phụ thuộc vòng thì đưa phần chung xuống `platform/`.
- Test tích hợp dùng `*_TEST_DATABASE_URL` (DB `*_test` riêng, **không bao giờ** DB thật).

### Thêm một chức năng mới (Go)

1. Tạo `internal/<ten>/` với `model.go`, `repository.go`, `service.go`, `handler.go` (+ test). Constructor `NewRepository(pool)`, `NewService(repo)`, `NewHandler(svc)`.
2. Migration mới (nếu cần): `migrations/NNN_ten.sql`, idempotent.
3. **Đăng ký:** dựng repo, service, handler và gắn vào struct `App` trong `internal/app/app.go`, rồi thêm route vào `internal/app/routes.go` dưới nhóm có chú thích, ví dụ `m.HandleFunc("GET /albums", au.Authed(a.albumH.List))`.
4. Kiểm: `gofmt -l . && go vet ./... && go test ./...` (kèm `*_TEST_DATABASE_URL`), `go build ./cmd/<svc>`, build lại image, `contract-snapshot.py --compare --only <nhóm>`, `scripts/<svc>-smoke.py`.
