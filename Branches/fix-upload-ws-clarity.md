# fix/upload-ws-clarity

- **Mục tiêu:** Nhãn workspace dễ hiểu, Quay lại không đi qua từng truyện/từng lần chuyển, hai trang đăng chương cùng một khung
- **Tạo từ:** `origin/main` @ 90546e2, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền sau khi mở)
- **Plan:** Plan/ui-overhaul.md (B5)

## Thay đổi
- `/ws/nhom/[slug]`: bộ lọc "Tất cả truyện", "Tất cả thành viên".
- "Việc & đề xuất" → "Giao việc & duyệt bản dịch" (StoryFlow, gợi ý ở workspace nhóm); `/ws/truyen/[slug]` có câu giải thích,
  mục "Bản dịch chờ duyệt", "Giao việc cho chương".
- `/ws`: chọn truyện/chương dùng `router.replace` (không thêm mục lịch sử).
- `components/story/UploadHeader.tsx`: phần đầu chung của `/dang-chuong` và `/dang-truyen-tranh` (Quay lại, công tắc loại, tiêu đề,
  mô tả, ô bên phải); cả hai trang `max-w-5xl`. `UploadModeSwitch` dùng `replace`.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `tsc --noEmit` frontend.
- Trình duyệt: nhóm → Đăng chương mới → Truyện tranh → Truyện chữ → Quay lại = về trang nhóm; nhóm → /ws, đổi truyện 3 lần → Quay lại = về trang nhóm;
  hai trang đăng chương cùng vị trí nút Quay lại / công tắc / tiêu đề.

## Ghi chú cho người review
- Trang truyện tranh hẹp lại (1600px → 5xl) để hai trang giống nhau.
