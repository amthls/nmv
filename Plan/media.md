# Giai đoạn D: service media (TS)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Thiết kế chung: `Plan/microservices.md` (giai đoạn D). Nhánh `feat/media-service`.

## Quyết định (2026-10-10)
- **TS**, chuyển code có sẵn gần như nguyên vẹn (sharp, EPUB/PDF đã chạy ổn): `upload.controller`, `upload.middleware`, `image.service`
  (đổi kích thước `?w=`), `services/export/*` (dựng EPUB/PDF), `export.controller`, `exportWorker`. Không viết lại.
- **Dữ liệu:** `media_db` riêng (user `media`): bảng `story_exports` (chuyển từ `novel_platform`, giữ id). Tệp vẫn ở ổ `uploads/`
  và `exports/` (mount vào media). Chưa cần bảng bản ghi tệp upload: chưa có tính năng nào đọc nó (thêm khi làm xóa ảnh mồ côi / kho lưu trữ).
- **Nội dung truyện để xuất** vẫn do backend (catalog) giữ: backend mở `GET /internal/exports/source?story=&chapters=` (truyện được tải?
  + danh sách chương xuất được + dấu vân tay) và `POST /internal/exports/book {story_id, chapter_ids}` (nội dung đã dựng `ExportBook`).
  Media không đọc DB của backend.
- **Quyền:** upload ảnh = đã đăng nhập; trang manga = người giữ/đóng góp truyện (`GET backend /internal/permissions`, như workspace).
- **Đường dẫn:** gateway `/uploads/*` → media (cache gateway giữ nguyên), `/api/media/*` → media (bỏ tiền tố). Frontend đổi
  `/api/v1/upload/*` → `/api/media/upload/*`, `/api/v1/stories/:slug/exports` + `/api/v1/exports/*` → `/api/media/...`.
- **Khóa:** `USER_SIG_KEY_MEDIA` (identity ký thêm `X-User-Sig-Media`), `INTERNAL_KEY_MEDIA` (để dành, chưa ai gọi media nội bộ),
  media gọi backend bằng `INTERNAL_KEY_BACKEND`.
- **Một container** `media`: API + vòng lặp dựng tệp xuất (thay `export-worker`). Bỏ hàng RabbitMQ `novel.exports`: cùng một tiến trình thì
  chỉ cần lấy hàng `queued` trong `media_db` (5 giây/lần hoặc ngay khi có yêu cầu). `EXPORT_CONCURRENCY` như cũ.
- Crawler (`scripts/crawler.py`) nén ảnh bằng `docker compose exec backend node -e …` → đổi sang `media`.

## Checklist
- [x] Backend: `/internal/exports/source`, `/internal/exports/book` (chuyển phần đọc DB của `services/export/content.ts`)
- [x] `services/media`: package TS (express, multer, sharp, pg, amqplib…), cấu hình, log JSON (chép `utils/logger.ts`), xác thực header + nội bộ,
      `/health` `/ready`; migration nhúng `001_init.sql` (`story_exports`); ~~chuyển dữ liệu `story_exports`~~: không cần (là cache, tệp dựng lại được; bảng mới bắt đầu trống)
- [x] Chuyển upload (ảnh, trang manga), phục vụ `/uploads` + `?w=`, xuất EPUB/PDF + hàng đợi, dọn tệp cũ
- [x] Gateway, compose (`media`, bỏ `export-worker`, `media_db` trong `db-init`, khóa mới), launch.py, CI (typecheck + test + build + Trivy)
- [x] Backend: xóa code đã chuyển (upload, export, `/uploads` static, `exportWorker`), bỏ `sharp`/`multer` nếu không còn dùng; `story_exports` để lại một
      thời gian (migration xóa sau khi xác nhận)
- [x] Frontend: đường dẫn mới
- [x] Thử: upload ảnh bài viết, bìa, trang manga (quyền), `?w=`, xuất EPUB + PDF (tạo, tiến độ, tải), crawler nén ảnh; đo RAM; README, Branches; PR, tự merge

## Còn lại (nhánh sau)
- [ ] Migration backend xóa bảng `story_exports` cũ trong `novel_platform` (không còn ai đọc) khi đã chạy ổn

## Bẫy
- `@types/express` + `express-rate-limit`: handler async trong Express 4 phải bọc `.catch(next)` (`wrap` trong `server.ts`).
- Trên Windows đường dẫn `/tmp/...` của Git Bash không phải đường dẫn curl thấy: dùng `$TEMP`.
