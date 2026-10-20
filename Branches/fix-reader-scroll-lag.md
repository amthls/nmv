# fix/reader-scroll-lag

- **Mục tiêu:** Trang đọc chương trên điện thoại cuộn mượt (hết lag)
- **Tạo từ:** `origin/main` @ 7111d01, ngày 2026-10-20
- **Trạng thái:** sẵn sàng review
- **PR:** (chưa mở)
- **Plan:** (Plan/<tên>.md nếu có)

## Thay đổi
- `globals.css`: dưới lg, `.reader-text > *` có `content-visibility:auto` (+ `contain-intrinsic-size`), khối ngoài màn hình bỏ qua layout/paint. Đây là nguyên nhân chính: chương dài ~94000px bị layout lại toàn bộ mỗi bước cuộn.
- `globals.css`: dưới lg ở trang đọc (`html[data-reader]`) tắt animation aura và phần trang trí skin aemeath.
- `FloatingReaderBar.tsx` và `chapterSlug/page.tsx`: listener cuộn gom bằng requestAnimationFrame; bỏ state `lastScrollY` làm listener đăng ký lại mỗi lần cuộn.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
Chrome headless 390x844, CPU throttle 4x, 60 bước cuộn bánh xe, chương dài ~94000px (script scratchpad/perf.mjs).
- Trước: skin mặc định 13 FPS, 60 khung >100ms, layout 7.2s; aemeath 7.8 FPS, 59 khung >100ms.
- Sau: skin mặc định ~31 FPS, 1-4 khung >100ms, layout 0.7s; aemeath ~28-34 FPS, 0-2 khung >100ms.
- Đã loại trừ: backdrop-filter, background-attachment, listener cuộn, header sticky (tắt từng cái không đổi số đo).
- tsc sạch, check-nav ok, build lại frontend.

## Ghi chú cho người review
- Chỉ áp dưới lg; desktop giữ nguyên. Số đo dao động vài chục % giữa các lần chạy.
