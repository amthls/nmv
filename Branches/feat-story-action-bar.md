# feat/story-action-bar

- **Mục tiêu:** Thanh hành động dính đáy ở trang truyện trên điện thoại
- **Tạo từ:** `origin/main` @ 7111d01, ngày 2026-10-20
- **Trạng thái:** xong, chờ duyệt
- **PR:** (chưa mở)
- **Plan:** (Plan/<tên>.md nếu có)

## Thay đổi
- `/truyen/[slug]` dưới lg: thanh hành động dính đáy nền đặc (surface, viền trên mảnh): icon Theo dõi, icon Mục lục (cuộn tới `#muc-luc`), nút chính brand "Đọc tiếp · Chương N" / "Đọc từ đầu" (320px: "Ch. N"). Dùng lại `handleToggleFollow`, `lastReadChapter`, `first_chapter`. Bỏ nhóm nút `max-lg:fixed` cũ; đệm cuối trang = 4rem + safe-area + 1rem.
- `BottomNav` ẩn ở `/truyen/[slug]`; `ContinueReadingMiniplayer` ẩn dưới lg ở trang này.
- Hàng Theo dõi/Album/Thảo luận/Báo cáo dưới lg: lưới đều, icon trên nhãn 1 dòng (nhãn ngắn dưới sm), không ngắt chữ; hết tràn khỏi thẻ ở 768px.
- Skin aemeath: sticker chibi hero chỉ hiện từ lg (trước đè nút Báo cáo ở 768-820).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `tsc --noEmit` sạch, `check-nav.sh` ok. Chụp 320/390/430/768/820 (mặc định + aemeath tối): scrollW = W, không đè, không ngắt chữ. Chụp bằng `next build` + `start` (dev trong worktree lỗi react-refresh do junction node_modules).

## Ghi chú cho người review
-
