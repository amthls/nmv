# fix/ws-no-jump

- **Mục tiêu:** Workspace: đổi truyện/chương/phiên bản không làm trang giật
- **Tạo từ:** `origin/main` @ 8782469, ngày 2026-10-12
- **Trạng thái:** đang làm
- **PR:** (chưa mở)
- **Plan:** không có

## Thay đổi
- `frontend/src/components/workspace/StoryFlow.tsx`:
  - Đổi truyện: không xóa truyện cũ (`setStory(null)`) mà giữ, làm mờ và khóa bấm cho tới khi truyện mới về. Bỏ qua phản hồi cũ khi bấm nhanh.
  - Đổi chương: `ChapterVersions` không còn `key` theo chương nên không tạo lại; danh sách phiên bản cũ mờ đi, khóa bấm (tránh "Dùng bản này" nhầm chương) tới khi bản mới về.
  - Chưa chọn chương: ô hướng dẫn cao bằng khung phiên bản (`min-h-[15rem]`), bỏ chọn không làm trang co lại.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit` frontend sạch.

## Ghi chú cho người review
- Chỉ frontend.
