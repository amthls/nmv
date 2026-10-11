# feat/library-service

- **Mục tiêu:** Giai đoạn G: theo dõi, bookmark, lịch sử đọc, album chuyển sang service library (Go)
- **Tạo từ:** `origin/main` @ 00c0f3d, ngày 2026-10-11
- **Trạng thái:** xong, chờ merge
- **PR:** (chưa mở)
- **Plan:** Plan/library.md (G1)

## Thay đổi
- Service mới `services/library` (Go, `library_db`): theo dõi, bookmark từng dòng, lịch sử đọc, album (mã `AL-` giữ nguyên), theo dõi người;
  bản sao `ext_stories`/`ext_chapters` đồng bộ từ backend; API nội bộ cho backend, messaging, recommender; `import-legacy` một lần.
- Backend: bỏ controller/route/model cũ (bookmark, history, album); `/internal/library/*`, `/internal/favorite-counts`; hồ sơ, trang truyện,
  mã AL-, xóa truyện/chương, recommender hỏi library. Messaging lấy người theo dõi từ library. Frontend gọi `/api/library`.
- Gateway `/api/library/*`, identity ký `X-User-Sig-Library`, compose (`library`, khóa cho backend/worker/messaging), launch.py, migrate.sh, CI, deploy.
- `scripts/library-smoke.py`; README phần "Service library".

## Migration / biến môi trường mới
- Database `library_db` (db-init tạo), migration riêng của service (`services/library/migrations/001_init.sql`, tự chạy khi khởi động).
- Biến: `LIBRARY_DB_PASSWORD`, `USER_SIG_KEY_LIBRARY`, `INTERNAL_KEY_LIBRARY` (launch.py tự sinh), `LIBRARY_MEMORY` (128m).
- Chuyển dữ liệu: `sh scripts/migrate.sh` (hoặc `docker compose run --rm library import-legacy`).

## Đã kiểm tra
- `go vet`, `go test` library (cả test tích hợp với Postgres), `tsc` + `npm test` backend, `tsc` frontend, test messaging.
- Import trên DB thật: số dòng khớp từng bảng, 184 mã AL- giống hệt.
- `python scripts/library-smoke.py --keeper admin --reader reader_yuki --password … --story berserker-of-gluttony`: 30/30.
- Huấn luyện gợi ý trong worker (816 người đọc, 3.815 tương tác). Trình duyệt: /lich-su, /bookmark, /album/:id, nút theo dõi trang truyện.

## Ghi chú cho người review
- Bảng cũ ở `novel_platform` chưa xóa (nhánh dọn dẹp sau). `simulateReaders.ts` vẫn ghi bảng cũ (ghi ở Hạn chế).
