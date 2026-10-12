# feat/popup-toggle

- **Mục tiêu:** Popup "đọc tiếp" có icon nhỏ mở thanh bật/tắt; công tắc cũng nằm trong Cài đặt
- **Tạo từ:** `origin/main` @ 75e1b3f, ngày 2026-10-12
- **Trạng thái:** xong cụm E
- **PR:** (xem GitHub)
- **Plan:** Plan/ui-overhaul.md

## Thay đổi
- `lib/miniplayerPref.ts`: hook `useMiniplayerEnabled` (lưu trong trình duyệt, các nơi dùng đồng bộ)
- `ContinueReadingMiniplayer`: icon bánh răng ở góc dưới phải popup, bấm ra hộp có công tắc "Hiện popup đọc tiếp"; tắt thì popup ẩn hẳn
- `/tai-khoan` tab "Cài đặt đọc truyện": công tắc "Popup đọc tiếp truyện"

## Migration / biến môi trường mới
- Không có (lưu ở localStorage `novelhub_miniplayer_enabled`, chưa đồng bộ giữa các máy)

## Đã kiểm tra
- `npx tsc --noEmit`, build frontend, thử trên trình duyệt: popup hiện, icon mở hộp công tắc
- CHƯA thử bấm tắt/bật và công tắc ở trang Tài khoản trên trình duyệt

## Ghi chú cho người review
- Tắt popup chỉ ghi nhớ trên trình duyệt đó.
