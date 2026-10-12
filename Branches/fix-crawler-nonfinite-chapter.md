# fix/crawler-nonfinite-chapter

- **Mục tiêu:** Crawler bỏ chương có số nan/inf thay vì làm hỏng cả truyện
- **Tạo từ:** `origin/main` @ 5332fde, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (chưa mở)
- **Plan:** (Plan/<tên>.md nếu có)

## Thay đổi
- scripts/crawler.py (MangaDex): bỏ chương có số `nan`/`inf` (float() chấp nhận, nhưng SQL ghi thẳng `nan` làm INSERT lỗi và mất cả truyện).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Chạy thật crawler: 3 truyện chữ (valvrare) + 1 manga (mangadex, 45 trang, WebP, workspace import) đều xong, trang /truyen/<slug> trả 200.
- py_compile; math.isfinite đúng với nan/inf/1/2.5.

## Ghi chú cho người review
-
