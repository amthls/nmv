# feat/explore-search-button

- **Mục tiêu:** Khám phá: chọn bộ lọc không gọi server, bấm Tìm mới gửi (như MangaDex)
- **Tạo từ:** `origin/main` @ 82e35b8, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/load.md` (C1–C3)

## Thay đổi
- `components/explore/FilterSidebar.tsx`, `app/kham-pha/page.tsx`: sidebar sửa bản nháp; nút "Tìm với bộ lọc này" áp dụng (1 request).
  Đặt lại / gỡ thẻ / sắp xếp / đổi trang vẫn áp ngay.
- `components/reader/MangaReader.tsx`: khung chờ ảnh đã biết kích thước không còn cao tối thiểu 240 px (hết giật với lát ảnh mỏng).
- `services/media/src/image.ts`: bản `?w=` nặng hơn ảnh gốc thì trả ảnh gốc.
- README, Plan/load.md.

## Migration / biến môi trường mới
- Không có. Đã xóa cache ảnh nginx (`/var/cache/nginx/uploads`) để bỏ bản WebP cũ.

## Đã kiểm tra
- `npx tsc --noEmit` (frontend, media), `yarn test` media, `check-nav.sh`.
- Chrome: 4 lần bấm lọc = 0 request, "Tìm" = 1; lát 700×3 chờ 3 px, sau tải 3 px; `?w=800` trang 820 px trả JPEG 38 KB, trang 1080 px trả WebP 80 KB.

## Ghi chú cho người review
- Trình duyệt đã giữ bản WebP cũ (cache 1 năm) vẫn dùng bản đó; chỉ nặng hơn chút, không sai.
