# feat/recommender-service

- **Mục tiêu:** Giai đoạn H: recommender viết lại bằng Python, nhận sự kiện, API FastAPI
- **Tạo từ:** `origin/main` @ e92e92e, ngày 2026-10-11
- **Trạng thái:** xong, chờ merge
- **PR:** (chưa mở)
- **Plan:** Plan/recommender.md

## Thay đổi
- Service mới `services/recommender` (Python 3.12, FastAPI, numpy, psycopg, pika; `recommender_db`): port thuật toán TS, tín hiệu qua sự kiện,
  bản sao truyện, huấn luyện là tiến trình riêng, API `/api/rec/*`, `import-legacy`, test pytest.
- library: outbox bằng trigger (`002_outbox.sql`) + publisher; `/internal/reco/export` trả từng dòng cho lần chuyển dữ liệu.
- backend: phát `catalog.story.viewed|chapter.read` (`behaviorEvents.ts`, `publishEvent`); xóa recommender TS, route, lịch trong worker,
  `simulateReaders.ts`; `/internal/library/stories` thêm tóm tắt, nhóm, ngày.
- Schema sự kiện `events/catalog.*`, `events/library.*`. identity ký `X-User-Sig-Rec`; gateway `/api/rec/`; compose, launch.py, migrate.sh,
  CI (job `recommender`, quét image), deploy, `.env.example`; frontend gọi `/api/rec`. README phần Service recommender.

## Migration / biến môi trường mới
- Database `recommender_db` (db-init), migration của service tự chạy; library `002_outbox.sql` tự chạy.
- Biến: `RECOMMENDER_DB_PASSWORD`, `USER_SIG_KEY_RECOMMENDER` (launch.py tự sinh), `RECOMMENDER_MEMORY`, `REC_TRAIN_INTERVAL_MIN`, `REC_TRAINING`.
- Chuyển dữ liệu: `sh scripts/migrate.sh` (hoặc `docker compose run --rm recommender import-legacy`).

## Đã kiểm tra
- pytest (5, cả tích hợp Postgres), library `go test` (thêm test outbox), identity `go test`, backend `tsc` + `npm test`, frontend `tsc`.
- Trên máy: import, so chất lượng với TS (bảng trong Plan), `recommender-smoke.py` 13/13, `library-smoke.py`, trình duyệt (trang chủ, admin).

## Ghi chú cho người review
- Bảng `rec_*` cũ ở `novel_platform` chưa xóa (nhánh dọn dẹp). Mô hình bỏ số giây đọc (library không phát).
