# fix/crawler-cover-and-slug

- **Mục tiêu:** Crawler: bìa lỗi thì lấy trang đầu, dọn thư mục ảnh mồ côi thay vì thêm -2
- **Tạo từ:** `origin/main` @ dcac475, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** không có

## Thay đổi
- `scripts/crawler.py`:
  - Truyện tranh không tải được bìa (MangaDex "giving up") thì chép trang đầu chương đầu làm bìa (trước đây nhập không bìa).
  - Mỗi lần chạy: truyện tranh cào về còn thiếu bìa được gán ảnh trang đầu (`fill_missing_covers`, chạy lại không đổi gì).
  - `claim_slug`: thư mục `uploads/manga/<slug>` không truyện nào dùng (lần chạy trước bị ngắt) được dọn và dùng lại tên, không còn sinh `<slug>-2`.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Chạy crawler `--target 106`: 5 truyện mới (3 truyện chữ Valvrare, TopTruyen 47 trang, MangaDex 76 trang), người đăng chia cho các nhóm.
- Truyện MangaDex bị lỗi bìa: lần chạy sau gán trang đầu làm bìa; toàn site 0 truyện thiếu bìa.
- 128 ảnh của truyện mới (trang + bìa), bản gốc và `?w=800` qua gateway: 0 lỗi. Trang chủ Chrome: 0 ảnh hỏng, 4 truyện mới hiện bìa.

## Ghi chú cho người review
- Truyện `cuoc-song-thanh-thoi-…-2` giữ slug (đổi sẽ hỏng link + đường dẫn ảnh).
- Còn 4 thư mục mồ côi cũ trong `uploads/manga/` (không DB nào trỏ tới); được dọn khi cào lại đúng tên đó, hoặc xóa tay.
