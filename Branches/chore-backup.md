# chore/backup

- **Mục tiêu:** Sao lưu hằng ngày Postgres + uploads, giữ 14 ngày/8 tuần/12 tháng, tự thử khôi phục
- **Tạo từ:** `origin/main` @ e3c8402, ngày 2026-10-10
- **Trạng thái:** xong, chủ dự án đã duyệt (2026-10-10), chờ review PR
- **PR:** (chưa mở)
- **Plan:** `Plan/microservices.md` (Giai đoạn 0: backup). Nhánh này mang theo `Plan/microservices.md` và `Plan/chapter-workspace.md` (chưa commit ở đâu khác)

## Thay đổi
- Service `backup` mới (`backup/Dockerfile`, `backup/backup.sh`): postgres:16-alpine + restic + crond, giờ Việt Nam.
  3:00 hằng ngày dump globals + từng database + `uploads/` vào kho restic mã hóa `./backups/repo`, giữ 14 ngày / 8 tuần / 12 tháng;
  5:00 Chủ nhật `restic check` + khôi phục thử vào DB tạm và so bảng/dòng; mỗi giờ kiểm tra quá 26 giờ chưa có bản mới.
  Lỗi → thông báo hệ thống cho mọi Admin (một lần/ngày/loại lỗi).
- `scripts/restore.sh`: liệt kê, khôi phục DB vào DB riêng hoặc thay DB thật (`--replace`, hỏi xác nhận, chụp bản trước), khôi phục `uploads/`.
- `scripts/migrate.sh` chụp bản trước khi chạy migration mới (lỗi thì dừng, `SKIP_BACKUP=1` bỏ qua); `launch.py` chụp trước migration (lỗi chỉ cảnh báo).
- `GET /admin/backup-status` (Admin) + khối "Sao lưu dữ liệu" trong `/tai-khoan` → tab quản trị.
- README: mục "Sao lưu & khôi phục", biến `RESTIC_PASSWORD`, hạn chế (chỉ một ổ).

## Migration / biến môi trường mới
- Không có migration.
- `RESTIC_PASSWORD` (bắt buộc; `launch.py` tự sinh nếu thiếu, không bao giờ đổi). Thư mục `backups/` (gitignore).

## Đã kiểm tra
- Typecheck backend + frontend; build `backup`, `backend`, `frontend`.
- `backup.sh run`: 3 snapshot (globals, `novel_platform` 6,8 MiB, uploads 345 MiB), ~20 giây; lần sau chỉ thêm phần đổi.
- `backup.sh check`: 47/47 bảng, 25.798/25.798 dòng.
- `restore.sh db latest` → `novel_platform_restored` đủ dữ liệu (212 người dùng); `restore.sh uploads latest` → `diff -r` giống hệt.
- Sai `RESTIC_PASSWORD` → lần chạy báo lỗi, `status.json` ghi lỗi, Admin nhận thông báo; quá 26 giờ → 1 thông báo dù kiểm tra 2 lần.
- `migrate.sh` với migration thử → chụp `pre-migrate` rồi mới chạy (migration thử đã xóa).
- `GET /admin/backup-status`: Admin nhận trạng thái, chưa đăng nhập 401. Dữ liệu thử (thông báo, DB phụ) đã xóa.

## Ghi chú cho người review
- `restore.sh db … --replace` chưa chạy trên DB thật (chỉ thử khôi phục sang DB riêng).
- Kho sao lưu cùng ổ với dữ liệu (chủ dự án chốt: máy chỉ có một ổ). Cần cất `RESTIC_PASSWORD` ở nơi khác.
- Kho lưu trữ nội dung đã xóa thật (cũng thuộc giai đoạn 0) chưa làm: cần luồng xóa thật/thùng rác 30 ngày trước.
