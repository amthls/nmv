# fix/launch-migration-022

- **Mục tiêu:** `python launch.py` chạy sạch từ đầu đến cuối (không FAIL ở bước migration), `.env` mới sinh đủ khóa bắt buộc
- **Tạo từ:** `origin/main` @ cf8eca7, ngày 2026-10-12
- **Trạng thái:** xong, chờ merge
- **PR:** (xem GitHub)
- **Plan:** không có

## Thay đổi
- `launch.py`: `apply_migrations` dùng bảng `schema_migrations` như `scripts/migrate.sh` (chỉ chạy file chưa ghi nhận; DB đã mất bảng `posts` thì chỉ ghi nhận). Trước đây chạy lại mọi migration nên 001–022 báo FAIL sau khi 026/027 xóa cột/bảng.
- `launch.py`: danh sách khóa ngẫu nhiên `RANDOM_KEYS` dùng chung cho `.env` mới và `.env` cũ. `.env` mới trước đây thiếu `USER_SIG_KEY_COMMUNITY/LIBRARY/RECOMMENDER` nên compose không khởi động; khóa không có trong `.env.example` giờ được thêm vào cuối.
- Migration 019, 020, 021, 022: bỏ qua phần đụng `posts`, `reports`, `users.email` khi bảng/cột không còn.

## Migration / biến môi trường mới
- Không có file mới. `schema_migrations` do launch.py tạo nếu chưa có.

## Đã kiểm tra
- `python launch.py` hai lần liên tiếp trên máy: "All checks passed", migration "nothing new".
- `.env` sinh mới trong thư mục tạm: đủ mọi biến `${X:?}` của docker-compose.yml; chạy lại giữ nguyên.
- Chạy trực tiếp 019–022 trên DB hiện tại: không lỗi.

## Ghi chú cho người review
- Chưa thử cài hoàn toàn mới (volume Postgres trống).
