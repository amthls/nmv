# fix/aemeath-polish

- **Mục tiêu:** Sửa tinh chỉnh skin Aemeath (light, hero truyện, nút, banner, icon)
- **Tạo từ:** `origin/main` ngày 2026-10-15
- **Trạng thái:** xong, chờ merge
- **PR:** (xem PR của nhánh)

## Thay đổi
- `day.webp` cắt lại (bỏ logo, 2560x1094), `background-position: center top`, bỏ lớp che logo.
- Light: hero chi tiết truyện ép bảng chữ tối (gray/brand/cyan/rose/emerald/amber), tiêu đề gradient trắng-hồng-cyan + drop-shadow, icon trong hero nét hồng nhạt; icon header nét đậm hơn + gradient đậm ở nền sáng.
- Nút "Đọc tiếp" (emerald) đổi sang gradient hồng/cyan khi skin Aemeath.
- Banner trang chủ bỏ sprite thứ hai (chỉ còn sprite hologram góc màn hình).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- tsc; `docker compose up -d --build frontend`, localhost:3000: trang chủ + trang truyện, skin Aemeath light/dark.
- Chưa kiểm: chương 1 ở light, mobile thật.
