# fix/crawler-owners

- **Mục tiêu:** Crawler: chia truyện cào về cho các nhóm dịch và tài khoản dịch giả thay vì dồn hết cho admin
- **Tạo từ:** `origin/main` @ 0fe708c, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** không có

## Thay đổi
- `scripts/crawler.py`:
  - "Suất" người đăng = mỗi tài khoản có vai trò translator/author, một suất cho mỗi nhóm dịch họ ở trong (không nhóm = độc lập).
    Không có ai thì vẫn dùng admin như trước.
  - Truyện mới chia xoay vòng qua các suất: `stories.uploader_id/group_id` và `chapters.uploader_id/group_id`.
  - Mỗi lần chạy (trừ `--dry-run`): truyện cào cũ còn đứng tên admin và không nhóm được chia lại theo cùng cách,
    chương của chúng đổi theo. Chạy lại không đổi gì thêm.
- Seed tài khoản (`identity seed-demo`) không cần sửa: chạy được, 12 tài khoản mẫu đủ.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `python scripts/crawler.py --target 100 --no-reindex` trên DB máy: 93 truyện cào chia cho 7 suất (13–17 truyện mỗi suất),
  0 chương cào còn đứng tên admin; chạy lần hai không chia lại. API `/api/v1/stories` trả đúng `group_name` / người đăng.

## Ghi chú cho người review
- `approved_by` vẫn là admin (người duyệt), chỉ đổi người đăng.
