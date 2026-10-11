# chore/drop-legacy-tables

- **Mục tiêu:** Giai đoạn I1: xóa bảng cũ đã chuyển sang service khác (sau import-legacy)
- **Tạo từ:** `origin/main` @ 6e61bb7, ngày 2026-10-11
- **Trạng thái:** xong, chờ chủ dự án chạy `scripts/migrate.sh` trên DB local
- **PR:** (chưa mở)
- **Plan:** `Plan/catalog.md` (I1)

## Thay đổi
- Migration `027_drop_legacy_tables.sql` (+ cuối `sql/database.sql`): xóa 28 bảng đã chuyển sang messaging, community, library,
  recommender, media (`story_exports`), cùng hàm trigger, sequence mã P-/AL-/RP-, enum của chúng. Còn 19 bảng.
- recommender `import-legacy`: không còn `rec_events` thì bỏ qua phần đó (messaging, community, library đã có kiểm tra).
- Prisma schema bỏ model/enum của các bảng đó (client không được dùng ở đâu).
- Script dev: xóa `seed-fandom.ts`, `migrate-posts.ts`, `add-images-column.ts`; `check-db.ts`, `import-from-docmep.ts` bỏ phần bảng cũ;
  `launch.py` không chạy `seed-fandom` nữa.
- README: phần cơ sở dữ liệu, các service, cách nâng cấp máy chạy bản cũ hơn #77.

## Migration / biến môi trường mới
- `027_drop_legacy_tables.sql` (xóa dữ liệu cũ, `migrate.sh` backup `pre-migrate` trước). Không có biến mới.

## Đã kiểm tra
- Bản sao `novel_platform` (pg_dump → DB nháp) + 027: chạy được, chạy lại không lỗi; cài mới từ `database.sql` → 19 bảng.
- Trước khi xóa: `legacy_imports` của messaging (messages, notifications), community (all), library (all), recommender (rec_events, library) đủ.
- `npx tsc --noEmit` (backend), `prisma validate`, `py_compile`; grep không còn SQL nào tới bảng đã xóa trong backend/worker.

## Ghi chú cho người review
- Bản cài mới không còn bài Fandom, bình luận, thông báo, theo dõi mẫu (seed nằm ở các bảng bị xóa).
- Chưa chạy trên DB local: auto mode chặn lệnh xóa dữ liệu trên DB thật → chủ dự án chạy `sh scripts/migrate.sh`.
