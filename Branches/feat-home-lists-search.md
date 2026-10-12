# feat/home-lists-search

- **Mục tiêu:** Trang riêng Mới cập nhật/Nhiều người xem, hướng dẫn nền rõ, header trang đọc, gợi ý tìm kiếm
- **Tạo từ:** `origin/main` @ 733a34a, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền sau khi mở)
- **Plan:** Plan/ui-overhaul.md (B8)

## Thay đổi
- `/moi-cap-nhat`, `/nhieu-nguoi-xem` (mới, dùng `components/explore/SortedStoriesPage.tsx`): lưới truyện theo `sort=updated` / `sort=views`
  (có số hạng), tab Tất cả / Truyện chữ / Truyện tranh, phân trang, trạng thái trên URL. Link "Xem tất cả" ở trang chủ và "Bảng xếp hạng" ở footer trỏ về đây.
- `/huong-dan/lam-chuong`: cả trang trên tấm nền đặc (`bg-surface`), mỗi mục là thẻ nền đặc, chữ to và sáng hơn.
- Navbar: khi menu tài khoản / chuông / thao tác nhanh / menu điện thoại / gợi ý tìm kiếm mở, thanh trên lên `z-50` (header trang đọc là `z-40` nên trước đây đè menu).
- `components/SearchBox.tsx`: ô tìm kiếm gợi ý khi gõ (≥2 ký tự, chờ 250 ms, `/stories/explore?q=`), ảnh bìa + loại + tác giả + số chương,
  "Hiện thêm" (+6, tối đa 24), "Xem tất cả N kết quả" → /kham-pha?q=, ↑/↓/Enter/Esc, bấm ra ngoài thì đóng; dùng cho thanh trên và menu điện thoại.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `tsc --noEmit` frontend.
- Trình duyệt: menu tài khoản ở trang đọc chương 114 Nhất Quyền Nhân không còn bị che; gõ "tensei" → 3 gợi ý; "chi" → 6, Hiện thêm → 12, "Xem tất cả 29 kết quả";
  /moi-cap-nhat, /nhieu-nguoi-xem?loai=manga (có số hạng); trang hướng dẫn nền đặc.
