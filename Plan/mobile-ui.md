# Giao diện riêng cho điện thoại (nhánh feat/mobile-ui)

Mục D của `Plan/ui-overhaul.md`. Chỉ đổi giao diện dưới `lg` (1024px); desktop giữ nguyên.

## Chuẩn chung (mọi agent dùng giống nhau)

Theo Apple HIG, Material 3, WCAG 2.2 và cách Webtoon, MangaDex, YouTube làm trên điện thoại:

- **Vùng chạm** ≥ 44px (`w-11 h-11`, `min-h-11`). Nút icon 20–24px cần padding đủ 44. Hai nút cách nhau ≥ 8px.
- **Cỡ chữ trên mobile:** chữ thường 15–16px, tên truyện trên thẻ 14px, phụ (chương, thời gian) 12px, không dưới 12px.
  Tiêu đề mục 18–20px. Giãn dòng ≥ 1.3 cho tiêu đề vì dấu tiếng Việt chồng lên nhau. Desktop giữ cỡ cũ (`sm:`/`lg:`).
- **Input/select/textarea** ≥ 16px dưới `sm`, nếu không iOS tự phóng to khi gõ.
- **Lề** 16px (`px-4`). Dùng `dvh` thay `vh`. Safe-area: `env(safe-area-inset-*)`.
- **Biến CSS** `--bottom-nav-h` (64px dưới `lg`, 0 từ `lg`). Thứ gì nổi ở đáy (toast, miniplayer, thanh đọc)
  đặt `bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 12px)` hoặc class `.bottom-above-nav`.
- **Hover**: hiệu ứng nhấc lên (`hover:-translate-y-*`) chỉ áp khi có chuột; trên cảm ứng có `active:` (nhấn hơi lún/đậm).
- **Hiệu ứng nặng** (blur kính, aura động) giảm dưới 768px và khi `prefers-reduced-motion`.
- **Thẻ truyện**: lưới 2 cột ở ≤ 400px, gap 12px; bìa 2:3; dải cuộn ngang có `snap-x`, lộ một phần thẻ kế.

## Việc

### A. Khung + điều hướng (agent A: layout.tsx, globals.css, Navbar.tsx, Footer.tsx, components/mobile/, ContinueReadingMiniplayer)
- [x] A1. `export const viewport` trong `layout.tsx`: `width=device-width, initial-scale=1, viewport-fit=cover`, themeColor sáng/tối. Không khóa zoom.
- [x] A2. `globals.css`: `--bottom-nav-h`, class `.bottom-above-nav`, `.pb-safe`; input ≥ 16px dưới `sm`; `-webkit-tap-highlight-color: transparent`; tắt translate khi `hover: none`; giảm blur/aura dưới 768px.
- [x] A3. `components/mobile/BottomNav.tsx`: 5 mục Trang chủ `/`, Khám phá `/kham-pha`, Tủ truyện `/bookmark`, Thông báo `/thong-bao` (chấm số chưa đọc nếu có sẵn dữ liệu), Tôi `/tai-khoan` (chưa đăng nhập thì mở AuthModal). Icon 24px + nhãn 12px, cao 64px + safe-area, `lg:hidden`. Ẩn ở trang đọc chương và `/ws*`. Body có `padding-bottom` tương ứng khi nav hiện.
- [x] A4. Navbar dưới `lg`: nút icon 44px, nút tìm mở ô tìm thật (thanh/sheet toàn chiều ngang, dùng `SearchBox`), bỏ link trùng với bottom nav khỏi menu hamburger, ThemeToggle/SkinPicker vẫn tới được trong menu. Header ẩn khi cuộn xuống, hiện khi cuộn lên (chỉ mobile, listener passive).
- [x] A5. Miniplayer + Footer không bị bottom nav che.

### B. Thẻ và trang danh sách (agent B: components/explore, components/home, app/page.tsx, app/kham-pha, app/moi-cap-nhat, app/nhieu-nguoi-xem, app/bookmark, app/lich-su)
- [x] B1. `StoryCardGrid`: chữ ≥ 12px, tên 14px trên mobile, cả thẻ là vùng chạm.
- [x] B2. `StoryRail`, `FeaturedCarousel`: cuộn ngang `snap-x`, thẻ ~120–140px, lề 16px, ẩn thanh cuộn, nút mũi tên chỉ hiện khi có chuột.
- [x] B3. Lưới: gap 12px dưới `sm`; bộ lọc/sắp xếp không tràn ngang (chip cuộn ngang hoặc xuống dòng); nút ≥ 44px.

### C. Trình đọc (agent C: components/reader, app/truyen)
- [x] C1. `FloatingReaderBar` và thanh trên trang đọc: nút 44px, chừa safe-area, chạm giữa màn hình ẩn/hiện thanh (nếu chưa có).
- [x] C2. Toast trang đọc không đè thanh dưới (`.bottom-above-nav` hoặc safe-area).
- [x] C3. `MangaReader` chế độ cuộn dọc: ảnh rộng 100% màn hình mobile, không khe giữa ảnh, giữ chỗ trước khi ảnh tải (chống nhảy trang), `loading="lazy"` trừ 2 ảnh đầu.
- [x] C4. Trang `/truyen/[slug]`: nút "Đọc tiếp/Đọc từ đầu" to, dính đáy trên mobile; danh sách chương mỗi dòng ≥ 44px.

### D. Kiểm tra (Opus/Haiku)
- [x] D1. `cd frontend && npx tsc --noEmit`, `sh scripts/check-nav.sh`.
- [x] D2. Build `docker compose up -d --build frontend`, xem trên trình duyệt ở 390px (DevTools) các trang: `/`, `/kham-pha`, `/truyen/<slug>`, trang đọc chữ, trang đọc tranh, `/tai-khoan`.
- [x] D3. Cập nhật README (mục giao diện) và `Plan/ui-overhaul.md` D2, `Branches/feat-mobile-ui.md`.

## Bẫy
- Trang đọc chương có header sticky `z-40` và toast riêng: đừng để bottom nav hiện ở đó.
- `ICON_BUTTON` dùng chung cho desktop: chỉ tăng cỡ dưới `lg` (`w-11 h-11 lg:w-9 lg:h-9`).
- Link luôn import từ `@/components/common/Link`; không dùng `router.back()`.

## Kết quả kiểm tra (2026-10-20)
- Giả lập điện thoại 390x844 cảm ứng qua Chrome DevTools Protocol (script chụp, cửa sổ Chrome thật không thu nhỏ được): 11 trang, không trang nào tràn ngang.
- Còn lại cho lần sau: chạm ẩn/hiện thanh ở MangaReader; trang đọc chương vẫn có cả header chung lẫn header trình đọc (header chung ẩn khi cuộn); header trình đọc với tài khoản quản lý có thể chật ở 390px; chưa thử trên điện thoại thật.
