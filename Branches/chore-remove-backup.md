# chore/remove-backup

- **Mục tiêu:** Bỏ container backup, code và image (chủ dự án không cần)
- **Tạo từ:** `origin/main` @ b5d5c3d, ngày 2026-10-11
- **Trạng thái:** xong
- **PR:** https://github.com/amthls/nmv/pull/83
- **Plan:** `Plan/remove-backup-purge.md` (nhánh 1)

## Thay đổi
- Compose: bỏ service `backup` và mount `./backups/status` của catalog.
- Xóa `backup/` (Dockerfile, backup.sh), `scripts/restore.sh`, `catalog/src/controllers/backup.controller.ts` + route
  `GET /admin/backup-status`, `frontend/src/components/admin/BackupPanel.tsx` + chỗ dùng ở `/tai-khoan`.
- `scripts/migrate.sh`, `launch.py`: không chụp backup trước migration; `launch.py` không sinh `RESTIC_PASSWORD`; bỏ biến ở `.env.example`, CI.
- README: mục "Sao lưu" ghi rõ không còn sao lưu + cách `pg_dump` tay; bỏ backup khỏi container, cây thư mục, biến, API, hạn chế.
- `Plan/microservices.md`: bỏ "Kho lưu trữ" và "đẩy bản ra ngoài máy".

## Migration / biến môi trường mới
- Bỏ `RESTIC_PASSWORD` (còn trong `.env` cũ thì vô hại). Không có migration.

## Đã kiểm tra
- tsc catalog + frontend, `docker compose config`.
- Máy local: gỡ container `novel_backup` + image `local/nmv-backup`, build lại catalog/worker/frontend, trang chủ, `/tai-khoan`, health 200.

## Ghi chú cho người review
- Không còn lưới an toàn nào cho dữ liệu (chủ dự án chấp nhận). Thư mục `./backups` (kho restic cũ ~346 MB) không bị xóa tự động.
