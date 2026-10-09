# fix/scripts-launch-wrapper

- **Mục tiêu:** scripts/launch.py chạy launch.py ở gốc (bản cũ thiếu REDIS_PASSWORD)
- **Tạo từ:** `origin/main` @ 5e25348, ngày 2026-10-09
- **Trạng thái:** đang làm
- **PR:** (chưa mở)
- **Plan:** không có (sửa nhỏ)

## Thay đổi
- `scripts/launch.py`: bỏ bản sao cũ (440 dòng), thay bằng lối tắt gọi `launch.py` ở gốc với cùng tham số.
  Bản cũ thấy `.env` có sẵn thì giữ nguyên, không thêm `REDIS_PASSWORD` nên `docker compose up` báo
  `required variable REDIS_PASSWORD is missing a value`. Bản ở gốc tự thêm `REDIS_PASSWORD`, đổi mật khẩu
  Postgres/pgAdmin mặc định và đồng bộ volume.
- `scripts/README.md`: seeder chỉ chạy khi DB chưa có truyện (hoặc `--seed`), như `launch.py` ở gốc.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `python scripts/launch.py --help` in đúng tham số của `launch.py` ở gốc.
- Bản sao `.env` bỏ dòng `REDIS_PASSWORD` (thư mục tạm): `ensure_env()` thêm `REDIS_PASSWORD` ngẫu nhiên.

## Ghi chú cho người review
- Ai quen `python scripts/launch.py` vẫn chạy được; lần chạy mặc định không còn reset mật khẩu mọi user nếu DB đã có truyện.
