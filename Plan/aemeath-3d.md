# Cảnh 3D (Three.js) cho skin Aemeath (nhánh feat/aemeath-3d)

Thư viện: `three@0.170.0` (+ `@types/three`), chỉ tải bằng dynamic import khi skin Aemeath bật (bundle mặc định không đổi: `/` vẫn ~118 kB First Load).
Chủ dự án duyệt thêm `three`; không dùng @react-three. Nguyên tắc: KHÔNG rối mắt, chữ luôn là trung tâm, thay thế (không cộng dồn) hiệu ứng CSS cũ.

## Phạm vi (đã chốt)
- (1) ~~Banner trang chủ có pha lê xoay~~: **bỏ** theo chủ dự án. Banner giữ thiết kế hiện có (ảnh + sprite + hologram nhẹ), chữ là tiêu đề thường của web đọc truyện ("Đọc truyện mỗi ngày", phụ đề về light novel/manga/fandom), không nhắc Aemeath; không pha lê.
- (2) Nền toàn site (`three/bgScene.ts`, một canvas `.sk-gl-bg`): ~110 hạt sao + 3 pha lê nhỏ ở rìa, trôi rất chậm, mờ (opacity .5), tắt ở trang đọc (`html[data-reader]`).
- (3) Chuyển skin: pha lê vỡ tung rồi ghép lại ~0.9s (mảnh additive, dùng lại canvas nền, tạm nâng z-index) khi bật Aemeath bằng nút chọn skin.
- (4) 404/trang trống: pha lê xoay cạnh sprite (`Skin404Crystal`, `three/heroScene.ts`).
- Sprite nhân vật (`.sk-holo`) là hình chiếu hologram đứng yên (KHÔNG theo chuột): trôi 6s, scanline cyan theo mặt nạ sprite, chớp glitch ~200ms mỗi 20s, đế elip; mờ khi cuộn hoặc con trỏ lại gần.
- Theo chuột chỉ còn: pha lê 404 (nghiêng) và tilt thẻ truyện. Bỏ vệt sao con trỏ và parallax nền/sprite.

## Hiệu năng / dự phòng
- dpr <= 1.5 (nền 1.25), một canvas nền toàn site + một canvas ở 404; dừng khi tab ẩn (`visibilitychange`) / canvas ngoài khung nhìn / trang đọc; khoá ~60fps; `canvas.dataset.fps` ghi FPS mỗi giây để đo.
- `three/quality.ts`: `off` (reduced-motion, không WebGL2: không tải three, nền ảnh tĩnh), `low` (mobile/cảm ứng/<=2 nhân/<=2GB: không có nền WebGL, 404 ít pha lê không khử răng cưa), `high`.
- Không có bloom thật (EffectComposer nặng): dùng emissive + viền hologram + vật liệu additive.

## Checklist
- [x] Thêm `three`, mô-đun `components/skin/aemeath/three/{quality,kit,stage,loop,bgScene,heroScene}.ts`
- [x] `GlBackground` (nền + burst), `GlHero`, `Skin404Crystal`, thay CSS crystal/hạt cũ, bỏ trail/parallax
- [x] Hero banner: giữ thiết kế, đổi chữ thường, bỏ pha lê (cả CSS lẫn WebGL); sprite hologram `.sk-holo`
- [x] Đo FPS trình duyệt: nền + 404 đạt ~60fps trên máy phát triển (12 luồng CPU)
- [x] Bẫy: dt âm ở frame đầu (`rAF now` < `performance.now()`) làm burst treo: đã kẹp dt >= 0
- [ ] Chưa kiểm: mobile thật, máy yếu thật, đo trên GPU tích hợp
