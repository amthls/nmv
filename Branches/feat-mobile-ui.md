# feat/mobile-ui

- **Mục tiêu:** Bố cục riêng cho điện thoại: thanh điều hướng dưới, chữ/nút đủ lớn, safe-area, trình đọc
- **Tạo từ:** `origin/main` @ 1452e23, ngày 2026-10-20
- **Trạng thái:** xong, chờ merge
- **PR:** https://github.com/amthls/nmv/pull/137
- **Plan:** Plan/mobile-ui.md (mục D của Plan/ui-overhaul.md)

## Thay đổi
- `layout.tsx`: `export const viewport` (viewport-fit=cover, themeColor), gắn `BottomNav`.
- `components/mobile/BottomNav.tsx` (mới): 5 mục Trang chủ, Khám phá, Tủ truyện, Thông báo (số chưa đọc), Tôi; chỉ dưới `lg`; ẩn ở trang đọc chương và `/ws*` (đặt `html.no-bnav`).
- `globals.css`: `--bottom-nav-h`, `.bottom-above-nav`, `.pb-safe`, input 16px dưới `sm`, giảm blur/aura dưới 768px, hiệu ứng `.tile:hover` chỉ khi có chuột.
- `tailwind.config.ts`: `future.hoverOnlyWhenSupported` để mọi `hover:` chỉ áp khi có chuột (không "dính hover" khi chạm).
- Navbar: nút 44px dưới `lg`, nút tìm mở ô tìm thật, header ẩn khi cuộn xuống; menu hamburger bỏ link trùng bottom nav.
- Thẻ/lưới/bộ lọc/phân trang (`components/explore`, `components/home`, kham-pha, bookmark, lich-su): chữ ≥ 12px, tên 14px, gap 12px, nút ≥ 44px, rail cuộn có snap.
- Trình đọc: nút thanh nổi 44px + safe-area, chạm giữa màn hình ẩn/hiện thanh (truyện chữ), toast không đè thanh; manga tải sớm 2 ảnh đầu.
- Trang truyện: nhóm nút đọc có sẵn dính đáy trên mobile (chỉ một nút), dòng chương ≥ 44px.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit` sạch, `sh scripts/check-nav.sh` ok, build frontend ok.
- Giả lập điện thoại 390x844 (cảm ứng, CDP) 11 trang: không tràn ngang, bottom nav đủ 5 mục và ẩn ở trang đọc, trang truyện chỉ một nút đọc dính đáy.

## Ghi chú cho người review
- Chưa làm: chạm ẩn/hiện thanh ở MangaReader (chế độ lật trang đã dùng chạm trái/phải); header trang đọc với tài khoản quản lý (thêm 3 nút) có thể chật ở 390px.
