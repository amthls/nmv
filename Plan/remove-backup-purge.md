# Bỏ backup + tự xóa truyện bị gỡ sau 60 ngày

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.

## Quyết định của chủ dự án (2026-10-11)
- **Không cần backup:** xóa container `backup`, code (`backup/`, `scripts/restore.sh`, API + trang trạng thái backup), image.
  Kéo theo: bỏ "Kho lưu trữ" và "đẩy bản ra ngoài máy" trong `Plan/microservices.md`.
- **Truyện bị Admin/Mod gỡ** (`approval_status = 'rejected'`) tự **xóa thật sau 60 ngày** kể từ lúc gỡ (`removed_at`),
  xóa như khi chủ truyện tự xóa (mọi service: library, community, workspace, media, tìm kiếm). Khôi phục trước hạn thì không xóa.

## Nhánh 1: `chore/remove-backup`
Bẫy:
- `scripts/migrate.sh` và `launch.py` chụp backup trước migration → bỏ bước đó (không còn lưới an toàn: migration xóa dữ liệu
  phải tự cẩn thận).
- Thư mục `./backups` (kho restic ~346 MB trên máy) **không** tự xóa: dữ liệu, chủ dự án tự xóa nếu muốn.
- `.env` cũ còn `RESTIC_PASSWORD`: không sao, compose không đọc nữa.

- [x] Compose: bỏ service `backup` + mount `./backups/status` của catalog
- [x] Xóa `backup/`, `scripts/restore.sh`, `backup.controller.ts` + route, `BackupPanel` + chỗ dùng
- [x] `migrate.sh`, `launch.py` (RESTIC_PASSWORD, chụp trước migration), `.env.example`, CI, `.gitignore`
- [x] README (mục sao lưu, container, hạn chế), Plan/microservices.md (bỏ kho lưu trữ, bản ngoài máy)
- [x] Gỡ container + image trên máy; build, smoke; PR, merge

## Nhánh 2: `feat/purge-removed-stories`
- [x] Tách phần xóa truyện thành hàm dùng chung (`deleteStory` + job)
- [x] Worker: mỗi ngày (và lúc khởi động) xóa truyện gỡ quá 60 ngày (`REMOVED_PURGE_DAYS`), ghi log
- [x] Hiện hạn xóa cho chủ truyện / Admin (trang `/da-go`, thông báo gỡ)
- [x] Thử: truyện gỡ giả `removed_at` 61 ngày trước bị xóa ở mọi service; truyện gỡ 10 ngày còn; README; PR, merge
