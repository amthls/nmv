# feat/load-and-layout

- **Mục tiêu:** Tìm kiếm cùng chuẩn ở mọi ô, thẻ truyện thẳng hàng, lưới không phình, chống nghẽn khi dữ liệu nhiều
- **Tạo từ:** `origin/main` @ ede84ac, ngày 2026-10-12
- **Trạng thái:** xong, chờ merge
- **PR:** (chưa mở)
- **Plan:** Plan/load-and-layout.md

## Thay đổi
- Ô tìm kiếm cùng chuẩn (`SearchInput`, `useDebounced`): 1 ký tự, trễ 400 ms, hủy yêu cầu cũ, vòng xoay + thanh tải
- Thẻ truyện: tên 2 dòng, hàng chương thẳng hàng; lưới `auto-fill` không phình
- `useRealtime` gom sự kiện dồn dập (`coalesce.ts` + test)
- Catalog giới hạn/phân trang: `/groups`, `/stories/manageable`, trang nhóm, hồ sơ người dùng

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- tsc catalog + frontend sạch, `npm test` (frontend) qua, build lại docker, các trang /kham-pha /moi-cap-nhat /nhom-dich trả 200

## Ghi chú cho người review
-
