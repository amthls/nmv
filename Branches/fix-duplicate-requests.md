# fix/duplicate-requests

- **Mục tiêu:** Bỏ request trùng ở trang truyện và Khám phá, gom request khi bấm bộ lọc liên tục
- **Tạo từ:** `origin/main` @ 7b37dec, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/load.md` (A2, A4)

## Thay đổi
- `app/truyen/[slug]/page.tsx`: tải truyện một lần theo slug (`apiFetch`, cookie phiên luôn đi kèm); chỉ tải lại khi thật sự đăng nhập/đăng xuất.
  Lịch sử đọc: một lần khi đã có truyện và đã biết phiên.
- `app/kham-pha/page.tsx`: một request cho mỗi đợt thay đổi (150 ms): bấm lọc liên tục, và số cột đo xong sau lần vẽ đầu (đổi số truyện mỗi trang).
- `context/AuthContext.tsx`: `/api/identity/me` và `/api/v1/auth/me` gọi song song (refresh phiên đã được gộp).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit`, `check-nav.sh` sạch.
- Chrome: trang truyện 10 API, 0 trùng, nút theo dõi + "Đọc tiếp" đúng; Khám phá mở 1 request (trước 2), 6 lần bấm lọc → 1 request (trước 4).
- Chưa thử chuyển đăng nhập ↔ đăng xuất trên trang truyện.

## Ghi chú cho người review
- Chỉ frontend.
