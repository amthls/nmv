# feat/aemeath-3d

- **Mục tiêu:** Cảnh 3D Three.js cho skin Aemeath
- **Tạo từ:** `origin/main` @ dbb527c, ngày 2026-10-15
- **Trạng thái:** xong, chờ merge
- **PR:** (xem PR của nhánh)
- **Plan:** Plan/aemeath-3d.md

## Thay đổi
- Thêm `three@0.170.0` + `@types/three` (chủ dự án duyệt); mô-đun `components/skin/aemeath/three/*`, `GlBackground`, `GlHero`, `Skin404Crystal`.
- Nền toàn site WebGL thưa, hiệu ứng pha lê vỡ/ghép khi đổi skin, pha lê ở 404. Thay CSS crystal/hạt, bỏ vệt sao con trỏ và parallax chuột.
- Sprite thành hình chiếu hologram đứng yên (`.sk-holo`: trôi, scanline, glitch hiếm, đế elip, mờ khi cuộn/lại gần).
- Banner trang chủ: giữ thiết kế, chữ thường ("Đọc truyện mỗi ngày"), không pha lê.

## Migration / biến môi trường mới
- Không có (dependency mới: three)

## Đã kiểm tra
- tsc, check-nav, next build; trình duyệt skin Aemeath dark: FPS ~60 (nền, 404), burst chạy xong ~1s, trang chủ không còn pha lê ở banner; skin mặc định không tạo canvas/tải three.
- Bẫy đã sửa: dt âm ở frame rAF đầu làm hiệu ứng vỡ treo.

## Ghi chú cho người review
- Chưa kiểm mobile thật / máy yếu thật; light mode chỉ xem qua trang chủ.
