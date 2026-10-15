# feat/aemeath-skin

- **Mục tiêu:** Thêm skin giao diện Aemeath
- **Tạo từ:** `origin/main` @ 642e734, ngày 2026-10-15
- **Trạng thái:** xong, chờ merge
- **PR:** (chưa mở)
- **Plan:** Plan/aemeath-skin.md

## Thay đổi
- Skin là chiều riêng `default | aemeath` (`useSkin`, `novelhub-skin`, áp trong THEME_INIT_SCRIPT); nút chọn ở header và `/tai-khoan`.
- tailwind.config: brand/indigo/purple/violet/blue/sky đầy đủ là biến `--c-*` để skin đổi được.
- `src/styles/skin-aemeath*.css`, `components/skin/aemeath/*` (Decor, AemeathLayer, Hero, SkinHero), `app/not-found.tsx`, `common/SkinPicker|SkinEffects`.
- Ảnh `public/backgrounds/aemeath/*`; README mục "Skin giao diện (Aemeath)".
- Icon pha lê (`skin/aemeath/icons`, `AeIconDefs` trong layout), controls (`skin-aemeath-controls.css`), card/trang truyện/trang đọc (`skin-aemeath-content.css`). Footer thành client component (dùng SkinIcon).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- (LEAD cuối) next build ok; trình duyệt skin Aemeath dark: trang chủ, /tai-khoan (chưa đăng nhập), header/icon ok.
- `tsc --noEmit` sạch, `sh scripts/check-nav.sh` ok, trình duyệt (next build + start): trang chủ dark/light skin Aemeath. Chưa kiểm mobile thật (không resize được cửa sổ), chưa kiểm 4 tổ hợp ở trang truyện (API dev báo not found).

## Ghi chú cho người review
- Dev server bị CSP chặn eval: xem bằng build + start (Plan/aemeath-skin.md, mục Bẫy).

## Chưa kiểm (ghi rõ)
- Mobile thật, trang truyện/trang đọc có dữ liệu (môi trường thử bị lệch API), trang tài khoản sau đăng nhập, light mode ở các trang con.
