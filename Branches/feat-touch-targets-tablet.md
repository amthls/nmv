# feat/touch-targets-tablet

- **Mục tiêu:** Nút đủ lớn cho ngón tay trên iPad ngang (màn cảm ứng ≥ 1024px)
- **Tạo từ:** `origin/main` @ 7111d01, ngày 2026-10-20
- **Trạng thái:** xong, chờ duyệt (chưa mở PR)
- **PR:** (chưa mở)
- **Plan:** `Plan/mobile-ui.md` (chuẩn vùng chạm 44px)

## Thay đổi
- `tailwind.config.ts`: biến thể `touch:` = `@media (pointer: coarse)` (màn cảm ứng không có chuột). Máy có chuột không đổi.
- `Navbar.tsx`: `ICON_BUTTON`, nút tiện ích, avatar, nút Đăng nhập, ô tìm, link nav, tab chuông, "Đã đọc tất cả", "Xem tất cả", mục menu tài khoản, logo đều ≥ 44px khi `touch:`.
- `NotificationItem`, `/thong-bao` (tab lọc, nút đánh dấu đã đọc, nút xóa luôn hiện trên cảm ứng, công tắc có vùng chạm mở rộng bằng `::before`, input/nút form), `ThemeToggle`, `SkinPicker`, `Footer` (link), `FilterSidebar` (Đặt lại), nút chế độ xem ở `/kham-pha`.
- Bẫy: biến thể `touch:` nằm sau `lg:`/`sm:` trong CSS nên khi class có sẵn `lg:w-9`/`sm:min-h-0` phải dùng `touch:!w-11` (important).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `tsc --noEmit` sạch, `check-nav.sh` ok.
- Giả lập iPad cảm ứng 1024x768 và 1180x820 (CDP): số nút/link < 40px trên màn hình trước → sau: `/` 9→0, `/thong-bao` 21→0, `/kham-pha` 12→0. Không tràn ngang (`/` ở 1024 có sẵn một thẻ rail trong vùng cuộn, không do nhánh này).
- `/thong-bao` chỉ kiểm được khung (chưa đăng nhập, dev server không có /api/identity): dòng thông báo, tab chuông, nút xóa chưa thấy bằng mắt.

## Ghi chú cho người review
- Chưa thử trên iPad thật.
