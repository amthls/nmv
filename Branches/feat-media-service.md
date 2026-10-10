# feat/media-service

- **Mục tiêu:** Giai đoạn D: service media (upload, ảnh ?w=, xuất EPUB/PDF) tách khỏi backend
- **Tạo từ:** `origin/main` (rebase lên e6297bb), ngày 2026-10-10
- **Trạng thái:** xong, chờ CI
- **PR:** https://github.com/amthls/nmv/pull/67
- **Plan:** `Plan/media.md`, `Plan/microservices.md` (giai đoạn D)

## Thay đổi
- `services/media` (TS, container `media`, DB `media_db`): upload ảnh / trang manga, `/uploads` + `?w=`, xuất EPUB/PDF (dựng trong cùng tiến trình,
  không còn RabbitMQ `novel.exports` và container `export-worker`). Code chuyển gần nguyên từ backend.
- Backend: `POST /internal/exports/source`, `/internal/exports/book` (`services/exportSource.ts`, phần đọc DB cũ); bỏ upload, export, `/uploads`,
  `exportWorker`, sharp/multer/pdfkit/fontkit, font, volume uploads/exports/image_cache.
- identity ký thêm `X-User-Sig-Media` (`USER_SIG_KEY_MEDIA`); gateway: `/uploads` + `/api/media/*` → media.
- Frontend: đường dẫn `/api/media/...` cho tải ảnh, trang manga, EPUB/PDF.
- Crawler nén ảnh trong container `media`; `scripts/restore.sh`, `launch.py`, CI (typecheck + test + Trivy media), deploy (build/pull identity,
  workspace, media — trước đây deploy thiếu ảnh identity/workspace).

## Migration / biến môi trường mới
- `media_db` (db-init), migration nhúng `services/media/migrations/001_init.sql`
- Mới: `MEDIA_DB_PASSWORD`, `USER_SIG_KEY_MEDIA` (launch.py tự thêm), tùy chọn `MEDIA_MEMORY`
- Bảng `story_exports` cũ ở `novel_platform` để lại (xóa ở nhánh sau)

## Đã kiểm tra
- `tsc` backend/frontend/media, `yarn test` media (chữ ký header), `go test` identity.
- Chạy thật qua gateway: ảnh gốc + `?w=480` (WebP), `w` sai → 400, đường dẫn `..` → 400; khách tải ảnh → 401; tải ảnh, ảnh giả → 400;
  trang manga: chủ truyện được, người lạ 403; xuất EPUB + PDF truyện `berserker-of-gluttony` → ready → tải về đúng kiểu/dung lượng;
  truyện chưa bật tải → 403; trang chủ/truyện/API 200; backend không có log lỗi; `sharp` chạy trong media (crawler).
- RAM: backend 39 MB (trước 64), media 99 MB, bỏ export-worker (40 MB).
- **Chưa thử trên trình duyệt** (tiện ích Chrome không kết nối): kéo thả ảnh trong trình soạn thảo, trang đăng truyện tranh, hộp tải EPUB/PDF.

## Ghi chú cho người review
- Lần đầu chạy, media dọn các thư mục `exports/` cũ (không có dòng trong `media_db`): tệp dựng lại khi có người tải.
