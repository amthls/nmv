# fix/navigation-back

- **Mục tiêu:** Quay lại đúng route cũ, bỏ breadcrumb và đường dẫn ghi cứng
- **Tạo từ:** `origin/main` @ 07b77a7, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/navigation.md`

## Thay đổi
- Mới `frontend/src/lib/nav.ts` + `components/common/NavTracker.tsx` (gắn trong `app/layout.tsx`): ngăn xếp trang trong site của từng tab
  (sessionStorage, bọc `pushState`/`replaceState`, `popstate`; tab mới nhận ra qua `window.name`).
- `components/common/BackLink.tsx`: `BackLink` giờ luôn đến trang ghi trên nhãn (lùi lại chỉ khi trang trước đúng là trang đó);
  thêm `BackButton` ("Quay lại" về trang trước trong site, không có thì fallback).
- Bỏ breadcrumb `Trang chủ > Khám phá > …` ở trang truyện.
- `UploadHeader`, `/dang-truyen`: `BackButton`. Sau xóa truyện / bỏ hoặc chuyển nháp / xóa bài fandom: `goBack` thay vì đẩy cứng về `/kham-pha`, `/ws`, `/fandom`.
- `scripts/check-nav.sh`: báo lỗi nếu còn `router.back()`, `window.history.back/length` hay breadcrumb "Trang chủ" ngoài module.
- CLAUDE.md mục "Điều hướng", README dòng kiểm tra.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit` sạch; `sh scripts/check-nav.sh` sạch (và báo đúng 2 lỗi trên code cũ).
- Chrome: xem Plan/navigation.md mục Kiểm tra.

## Ghi chú cho người review
- Chỉ frontend.
