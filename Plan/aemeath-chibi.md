# Chibi Aemeath trong web (nhánh feat/aemeath-chibi, phần TÍCH HỢP)

ART vẽ `components/skin/aemeath/chibi/` (`AeChibi`, `AeCat`). Phần này chỉ gắn vào web. Nguyên tắc: nhỏ, dễ thương, không rối mắt,
không che chữ/nút, mỗi màn hình tối đa 1-2 chibi. Chỉ khi `<html class="skin-aemeath">`; tải lazy (dynamic import) nên skin mặc định không tải gì.

## Khung
- [x] `components/skin/aemeath/chibiPrefs.ts`: outfit ưa thích (`novelhub-ae-outfit`: random|default|school|idol|casual), bật/tắt (`novelhub-ae-chibi`=off), `useChibiPrefs`, `pickOutfit(seed)` ổn định theo seed
- [x] `components/skin/aemeath/chibiLines.ts`: câu thoại tiếng Việt theo ngữ cảnh
- [x] `components/skin/aemeath/SkinChibi.tsx`: wrapper `<SkinChibi>` (chỉ render khi skin Aemeath + chưa tắt; dynamic import AeChibi/AeCat)
- [x] `styles/skin-aemeath-chibi.css` (import trong layout): bounce loader, peek, toast

## Vị trí
- [x] 1. Hero trang chi tiết truyện: 1 chibi nhỏ (read/sit) ở góc, outfit theo slug
- [x] 2. /thong-bao + dropdown chuông trống: sleepy + thoại; toast thông báo mới (chibi mini hi/wink) bên trái
- [x] 3. Góc dưới-trái: chibi peek thỉnh thoảng, rê gần thì ló ra, bấm thì nói 1 câu rồi rụt. Tắt ở trang đọc (`html[data-reader]`), ẩn <640px. Hologram (dưới-phải, nền mờ) giữ nguyên, hai bên khác góc nên không đè
- [x] 4. Trống/404/không tìm thấy (kham-pha, lich-su, bookmark, truyện/nhóm/người dùng không thấy): sad/surprised + thoại
- [x] 5. Cuối chương: thẻ "Chương tiếp" có chibi cheer nhỏ
- [x] 6. PageLoader/BookLoader khi skin Aemeath: chibi nhún nhảy (thay sách lật)
- [x] 7. Trang tài khoản: chọn trợ lý chibi (outfit) + tắt chibi

## Kiểm
- [x] tsc, `sh scripts/check-nav.sh`, docker build (khóa .agent-lock), trình duyệt: trang chủ, truyện, chương 1, /thong-bao, 404, sáng/tối
- [x] ART commit, tôi commit phần mình, PR, merge, build lại main

## Bẫy
- Không import `chibi/` tĩnh trong trang: luôn qua `SkinChibi` (dynamic) để skin mặc định không tải.
- Trang đọc chương: không chibi ngoài thẻ cuối chương.

## Nguồn ảnh
4 sticker động "Aemeath Sticker Slice of Life 13_01-04" từ Wuthering Waves Wiki (Fandom), bản quyền Kuro Games, lưu ở `frontend/public/backgrounds/aemeath/chibi/`.
`AeChibi` ánh xạ mood/pose sang sticker (hoặc prop `sticker`); `outfit` bỏ qua, `AeCat` trả null. Tuỳ chọn trợ lý lưu `novelhub-ae-outfit` (random|hi|smug|music|sleepy), tắt chibi `novelhub-ae-chibi=off`.

## Bổ sung huy hiệu (feat/aemeath-chibi-badges)
- [x] `AeBadge` (badge-wave/wink/heart/map.webp, tròn 32-96px): toast = wave, cuối chương = heart, tìm không thấy/lịch sử = map ("Để mình tìm đường giúp nhé~"), 404 = plane.webp (giữ dòng ©KURO GAMES), tài khoản chọn được cả 4 sticker + 4 huy hiệu.
- Nguồn: badge do chủ dự án cung cấp; plane từ bài "New Aemeath chibi" (X @WuWa_Verse1, 2026-02-19); bản quyền Kuro Games.
