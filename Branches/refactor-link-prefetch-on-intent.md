# refactor/link-prefetch-on-intent

- **Mục tiêu:** Link chỉ tải trước khi rê chuột/chạm, không tải trước mọi link trên màn hình
- **Tạo từ:** `origin/main` @ 29abbb5, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/load.md` (A1)

## Thay đổi
- Mới `frontend/src/components/common/Link.tsx`: bọc `next/link` với `prefetch={false}`, tải trước bằng `router.prefetch` khi rê chuột/chạm.
- 50 file đổi `import Link from 'next/link'` sang component này; `scripts/check-nav.sh` chặn import `next/link` thẳng.
- `Plan/load.md`: kế hoạch giảm tải (A1–A6, B1–B5) và số đo; CLAUDE.md thêm quy tắc.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit`, `sh scripts/check-nav.sh` sạch.
- Chrome, trang truyện: 27 → 11 request (0 tải trước tự động); rê chuột lên chương thì tải trước, bấm → mở sau 41 ms.

## Ghi chú cho người review
- Chỉ frontend.
