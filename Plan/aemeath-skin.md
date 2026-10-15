# Skin Aemeath (nhánh feat/aemeath-skin)

Skin giao diện thứ hai cho cả web, độc lập sáng/tối. `<html class="skin-aemeath">` (+ `dark`), lưu `localStorage['novelhub-skin']`,
áp trước paint trong `THEME_INIT_SCRIPT` (`src/lib/themeScript.ts`), hook `useSkin()` trong `src/lib/theme.ts`.
Skin mặc định không đổi gì và không tải thêm mã (trang trí tải lazy qua `components/skin/aemeath/AemeathLayer`).

## Checklist (LEAD)
- [x] useSkin + THEME_INIT_SCRIPT + nút chọn skin (header `SkinPicker`, trang tài khoản `SkinChoices`)
- [x] Biến màu: brand = hồng (tailwind: brand/indigo/purple/violet/blue/sky đều là biến `--c-*`, skin ghi đè)
- [x] Nền day/night/portrait, sprite góc phải (tắt ở trang đọc: `html[data-reader]`), scanline, pha lê 3D, vệt sao con trỏ
- [x] Header kính nổi + viên sáng trượt, logo sao, hero trang chủ (`SkinHero`), 404 (`app/not-found.tsx`)
- [x] View Transition + lóe sáng khi đổi skin
- [ ] Kiểm 4 tổ hợp + mobile, README, PR

## Chia việc (4 agent cùng nhánh, mỗi agent chỉ sửa vùng của mình)
- LEAD: theme*.ts, themeScript, tailwind.config, globals.css, `styles/skin-aemeath.css`, layout, Navbar, ThemeToggle/SkinPicker/SkinEffects, app/page.tsx + components/home/*, not-found, loading, tai-khoan.
- ICONS (B): `components/skin/aemeath/icons/*`, `styles/skin-aemeath-icons.css`, icon trong Footer, notifications/, messages/, comments/, account/, album/, auth/.
- CONTROLS (C): `styles/skin-aemeath-controls.css`, components/common/* (trừ ThemeToggle, SkinPicker, SkinEffects, Link, NavTracker), SearchBox, QuickActionModal, explore/*.
- CONTENT (D): `styles/skin-aemeath-content.css`, story/*, reader/*, chapter/*, groups/*, fandom/*, random/*, workspace/*, admin/*, các page trong app/ (trừ page.tsx, not-found, loading, tai-khoan, layout).

**CSS của agent phụ:** KHÔNG thêm `@import` (vô hiệu nếu không đứng đầu file). 3 file `skin-aemeath-{icons,controls,content}.css`
đã được LEAD import sẵn trong `app/layout.tsx` sau `skin-aemeath.css` (file stub đã có, chỉ việc điền). Mọi selector bắt đầu bằng `html.skin-aemeath` (thêm `.dark` khi cần riêng tối).
Chỉ chạm skin này; không đổi hành vi mặc định.

### Token dùng chung (định nghĩa ở `html.skin-aemeath` / `.dark` trong skin-aemeath.css)
- Màu hồng: `rgb(var(--c-brand-50..950))` (50-400 đã đảo ở nền sáng, như mọi brand), accent `--c-brand-accent`. Cyan hologram: `#67e8f9`, hồng sáng `#f472b6`, hồng nhạt `#fbcfe8`, hồng đậm `#ec4899`/`#be185d`.
- Nền: `--c-surface`, `--c-surface-2`, `--c-surface-3`; chữ `--c-white` (đã đảo theo sáng/tối), xám `--c-gray-*`.
- Kính: `--glass-bg`, `--glass-bg-strong`, `--glass-border`, `--glass-edge`, `--glass-shadow`, `--glass-highlight`.
- Gradient chữ/tiêu đề: `--sk-grad` (sáng: hồng đậm→cyan đậm; tối: hồng nhạt→cyan). Dùng `background: var(--sk-grad); -webkit-background-clip:text; -webkit-text-fill-color:transparent`.
- Bo góc: `--sk-radius` (18px, khối lớn); nút/input nên 12-14px; tailwind `rounded-lg/xl` đã được skin nâng lên 14px, `2xl/3xl` 22px.
- Font tiêu đề: `'Quicksand', 'Inter', sans-serif` (đã nạp, có tiếng Việt); h1/h2 đã có gradient, h1-h4 đã đổi font.
- Hiệu ứng có sẵn để dùng lại: `@keyframes sk-twinkle` (sao lấp lánh), `sk-shimmer` (skeleton chạy), `sk-star-spin`, `sk-float`; `@property --sk-ang` + `sk-ang` (viền gradient chạy vòng, xem nút chính); ngôi sao 4 cánh = `clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%)` (class `.sk-star`).
- Bóng: nút `0 4px 0 -1px rgb(var(--c-brand-800)), 0 10px 22px -10px rgb(236 72 153 / .65)`; glow cyan `0 0 22px -8px rgb(103 232 249 / .45)`.
- Tôn trọng `prefers-reduced-motion` (tắt animation), chỉ animate transform/opacity, không chạy hiệu ứng chuột trên cảm ứng.
- **Tilt 3D đã có (agent CONTENT dùng lại, không cần viết `useTilt`):** `src/components/skin/aemeath/Decor.tsx` lắng nghe `pointermove` toàn trang, đặt `--rx --ry --mx --my` lên phần tử `.tile` gần nhất, bật class `sk-tilt` trên `<html>` (chỉ khi có hover chuột và không reduced-motion). Muốn card khác nghiêng: thêm class `tile` hoặc mở rộng selector `.tile` trong `Decor.tsx` (báo LEAD) và CSS `html.skin-aemeath.sk-tilt .tile` trong skin-aemeath.css.
- Reader: `html[data-reader]` có mặt ở trang đọc chương: tắt trang trí, giữ chữ dễ đọc, đừng áp gradient/hiệu ứng lên nội dung chương.
- Cấm dùng `.glass-panel::before/::after` trong CSS riêng (LEAD đã dùng làm góc hologram).

## Bẫy
- `@import` CSS phải đứng đầu file; vì vậy import các file skin trong layout.tsx.
- `next dev` bị CSP chặn eval trong trình duyệt: xem trình duyệt bằng `next build` + `next start` (rewrites `/api/v1` cần `CATALOG_ORIGIN=http://localhost:5000` lúc build; `/api/identity` cần proxy về gateway :3000).
- Tailwind brand 500-950 trước đây là hex tĩnh: đã chuyển thành biến để skin đổi được; alias indigo/purple/violet trỏ cùng thang brand; blue/sky là biến `--c-blue-*`/`--c-sky-*` (skin trỏ vào brand).
