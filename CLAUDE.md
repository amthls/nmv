# NovelHub: hướng dẫn làm việc

Web đọc light novel + manga + Fandom (Next.js 15 / Express / Postgres + các service trong `services/`, chạy bằng Docker Compose).
Service chính `catalog` (thư mục `catalog/`, trước đây tên `backend`; tên `backend` vẫn phân giải trong mạng Docker).
**README.md là nguồn sự thật** về kiến trúc, route, bảng, biến môi trường, hạn chế. Sửa code thì sửa README cho khớp.

**Bắt buộc: nạp skill `ponytail` (plugin ponytail) trước khi viết, sửa hay review code** trong dự án này
(thay đổi nhỏ nhất đủ giải quyết, không thêm thứ chưa cần).

## Quy trình git (bắt buộc)

1. **Mỗi việc một nhánh mới, tạo từ `origin/main` mới nhất.** Không commit thẳng vào `main`.
   ```sh
   sh scripts/new-branch.sh <loại>/<tên-ngắn> "Mục tiêu một dòng"
   ```
   `<loại>`: `feat` (tính năng), `fix` (sửa lỗi), `security`, `chore` (hạ tầng, CI, công cụ), `docs`, `refactor`.
   Tên ngắn: chữ thường không dấu, số, `-`. Ví dụ `feat/forgot-password`, `fix/view-counter`.
   Script tự fetch, tạo nhánh (không track `main`) và tạo file thông tin nhánh. Thay đổi chưa commit được mang theo.
2. **Mỗi nhánh có file `Branches/<tên-nhánh với / đổi thành ->.md`** (ví dụ `Branches/feat-forgot-password.md`).
   Cập nhật trong cùng commit với code: mục tiêu, trạng thái, danh sách thay đổi, migration/biến môi trường mới,
   đã kiểm tra những gì, link PR, plan liên quan. Không có CI kiểm file này: tự nhớ thêm trước khi mở PR.
3. **PR đã merge thì nhánh đó coi như đóng.** Việc tiếp theo, kể cả sửa nhỏ cho PR vừa merge, phải tạo nhánh mới
   bằng script. Trước khi push, kiểm tra: `git fetch && git log origin/main..HEAD` chỉ chứa commit của việc hiện tại.
4. Làm xong và đã kiểm tra trên máy thì **tự commit, push, mở PR vào `main` và tự merge** (squash, `gh pr merge --squash --delete-branch`),
   không cần chờ chủ dự án duyệt (chủ dự án quyết định 2026-10-10). **Không còn GitHub Actions** (chủ dự án gỡ 2026-10-12 vì tốn tiền):
   trước khi merge tự chạy typecheck + test của phần đã sửa (bảng lệnh dưới), `scripts/*-smoke.py` và trình duyệt khi đụng UI. Không xếp chồng PR
   (PR nhắm vào nhánh khác `main`): mỗi việc một PR thẳng vào `main`. Commit kết thúc bằng dòng Co-Authored-By.
5. Không bao giờ commit `.env` hay token. Token bị dán vào chat coi như đã lộ: nhắc chủ dự án thu hồi.
6. PR của Dependabot (không còn tự merge): bản vá/nhỏ chạy typecheck + test trên máy xanh thì merge được; bản lớn (major) như Postgres, Prisma, Next, Tailwind,
   RabbitMQ, Node lẻ phải làm thành việc riêng có plan. **Postgres đổi major là volume cũ không chạy được.**

## Điều hướng "quay lại" (Plan/navigation.md)

- **Không breadcrumb**, không link ghi cứng giả làm nút quay lại (kiểu `Trang chủ > Khám phá` bất kể người dùng đến từ đâu).
- Chỉ 3 cách, đều dựa trên `frontend/src/lib/nav.ts` (ngăn xếp trang trong site của từng tab):
  `<BackLink href="/x">` đến **đúng trang X** như nhãn (lùi lại chỉ khi trang trước đúng là X);
  `<BackButton fallback>` "Quay lại" về trang trước trong site, không có thì về fallback; `goBack(router, fallback)` sau một thao tác.
- Cấm `router.back()`, `window.history.back/length` ở chỗ khác. Chạy `sh scripts/check-nav.sh` trước khi merge thay đổi frontend.

## Kế hoạch (Plan/)

Việc nhiều bước: **viết `Plan/<tên>.md` có checklist `[ ]` trước khi sửa code**, ghi cả bẫy phát hiện được.
Xong mục nào đổi ngay thành `[x]`. Phiên mới: đọc plan đang dở trước, làm tiếp mục `[ ]` đầu tiên.
Plan nằm trong nhánh của việc đó và được commit cùng code.

## Lệnh hay dùng

| Việc | Lệnh |
|---|---|
| Chạy/cập nhật toàn bộ | `python launch.py` (tự sinh `.env`, đồng bộ mật khẩu Postgres, build, migrate, kiểm tra) |
| Build lại sau khi sửa code | `docker compose up -d --build catalog frontend` (thêm `worker` nếu sửa worker, `media` nếu sửa `services/media`) |
| Typecheck | `cd catalog && npx tsc --noEmit`, `cd frontend && npx tsc --noEmit` |
| Migration | Thêm `sql/migrations/NNN_ten.sql` (idempotent), **chép nội dung vào `sql/database.sql`**, chạy `sh scripts/migrate.sh` |
| nginx đổi cấu hình | `docker exec novel_gateway nginx -s reload` (file được mount, `up -d` không tự nạp) |
| Gọi API như một người dùng | Qua gateway: đăng nhập `POST /api/identity/login` lưu cookie (`curl -c jar -b jar`), request ghi gửi kèm `X-CSRF-Token: <cookie nh_csrf>`. Thẳng catalog (127.0.0.1:5000): header ký `docker exec novel_catalog node -e "console.log(require('./dist/middlewares/auth.middleware').signIdentityHeaders('<uuid>',['admin']))"` (hạn 2 phút) |
| Service Go (identity) | `cd services/identity && gofmt -l . && go vet ./... && go test ./...`; thêm `IDENTITY_TEST_DATABASE_URL=postgres://…/identity_test` để chạy test tích hợp (xóa sạch DB đó) |

## Bẫy đã biết

- Catalog/frontend là image production: sửa code mà không build lại thì không thấy thay đổi.
- Lỗi 5xx đã được che ở production (`maskServerErrors` trong `catalog/src/middlewares/security.ts`), không cần che lại từng handler.
- PgBouncer chế độ transaction: không dùng advisory lock theo phiên, `SET` không `LOCAL`, `LISTEN`, nhiều câu SQL có tham số trong một query.
- Trong container Postgres, kết nối `127.0.0.1` được tin không cần mật khẩu: thử mật khẩu phải từ container khác trên mạng `nmv_data`.
- Express 4 không tự bắt lỗi của handler async: bọc `try/catch` hoặc `.catch(next)` (như route `/internal/...` trong `server.ts`).
- Trên Windows (Git Bash) script nhiều lớp thoát ký tự dễ hỏng: dùng Edit hoặc file script riêng; file `*.sh` luôn LF (`.gitattributes`).
- Chọn phiên bản thư viện đã phát hành ít nhất 2 tuần.
- Đăng nhập ở service identity (Go, `identity_db` riêng): mỗi service chỉ tin `X-User-*` có chữ ký bằng khóa riêng của nó (`USER_SIG_KEY_<svc>`), lời gọi nội bộ ký bằng `INTERNAL_KEY_<service nhận>`; bảng `users`/`user_roles` của catalog là **bản sao** (sửa vai trò/khóa/xóa phải qua identity, không UPDATE thẳng). Xem `Plan/identity.md`.
- Request ghi từ frontend phải qua `authFetch`/`apiFetch` (`src/lib/session.ts`): `fetch` thô thiếu header CSRF nên bị gateway trả 403 khi đã đăng nhập.
