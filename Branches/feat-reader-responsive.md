# feat/reader-responsive

- **Mục tiêu:** Trình đọc: cài đặt co giãn theo màn hình, bỏ "tự động độ phân giải", ảnh truyện tranh có trạng thái tải/lỗi, nút quay lại không lặp
- **Tạo từ:** `origin/main` @ c372a4b, ngày 2026-10-12
- **Trạng thái:** xong cụm C
- **PR:** (xem GitHub)
- **Plan:** Plan/ui-overhaul.md

## Thay đổi
- `ReaderSettingsModal`: sát đáy trên điện thoại, cao tối đa 92dvh, cuộn được, nút Lưu dính đáy, bấm nền để đóng
- `lib/imageQuality.ts`, `ImageQualityPicker`: bỏ lựa chọn "Tự động" (giá trị `auto` đã lưu trong trình duyệt tự về mặc định "Gốc")
- `MangaReader`: mỗi trang có spinner "Đang tải trang N", lỗi thì báo ngay ở trang đó kèm "Thử lại" (thử bản gốc trước khi báo lỗi)
- `components/common/BackLink.tsx`: nút mũi tên quay lại dùng lịch sử trình duyệt (dự phòng href); áp cho trình đọc, lịch sử chương, đăng truyện, fandom, các trang ws

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit`, build frontend, mở chương truyện tranh và `/ws` trên trình duyệt
- CHƯA thử ảnh lỗi/tải chậm thật và màn hình điện thoại thật

## Ghi chú cho người review
- Cụm D (giao diện điện thoại riêng) làm ở nhánh sau.
