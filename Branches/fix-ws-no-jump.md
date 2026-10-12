# fix/ws-no-jump

- **Mục tiêu:** Workspace: đổi truyện/chương/phiên bản không làm trang giật
- **Tạo từ:** `origin/main` @ 8782469, ngày 2026-10-12
- **Trạng thái:** đang làm
- **PR:** (chưa mở)
- **Plan:** không có

## Thay đổi
- `frontend/src/app/ws/page.tsx` (nguyên nhân chính): đổi truyện/chương bằng `window.history.replaceState` thay vì `router.replace`.
  `router.replace` đổi search param làm Next tải lại trang từ server và hiện `app/loading.tsx` → trang tụt về đầu (scrollY 0),
  rồi đoạn tự cuộn tới khung phiên bản kéo xuống lại = "nhảy lên nhảy xuống". Next 15 tự đồng bộ `useSearchParams` với `history.replaceState`.
- `frontend/src/components/workspace/StoryFlow.tsx`:
  - Đổi truyện: không xóa truyện cũ (`setStory(null)`) mà giữ, làm mờ và khóa bấm cho tới khi truyện mới về. Bỏ qua phản hồi cũ khi bấm nhanh.
  - Đổi chương: `ChapterVersions` không còn `key` theo chương nên không tạo lại; danh sách phiên bản cũ mờ đi, khóa bấm (tránh "Dùng bản này" nhầm chương) tới khi bản mới về.
  - Chưa chọn chương: ô hướng dẫn cao bằng khung phiên bản (`min-h-[15rem]`), bỏ chọn không làm trang co lại.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit` frontend sạch.
- Chrome, `/ws?truyen=vi-da-tro-thanh-ke-thu-cua-oshi`: trước sửa, bấm chương thì scrollY 212 → 0 → trượt về 268. Sau sửa, bấm qua lại chương 1/2/3 và bỏ chọn:
  scrollY giữ nguyên (chỉ cuộn êm một lần lúc mở chương đầu tiên nếu khung phiên bản nằm dưới màn hình); URL, chương được chọn, khung phiên bản luôn khớp.

## Ghi chú cho người review
- Chỉ frontend.
