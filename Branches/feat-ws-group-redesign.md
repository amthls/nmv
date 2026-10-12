# feat/ws-group-redesign

- **Mục tiêu:** Thiết kế lại /ws (dòng chảy kiểu PS5) và giao diện nhóm dịch cho trực quan
- **Tạo từ:** `origin/main` @ 079fd40, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền sau khi mở)
- **Plan:** Plan/ui-overhaul.md (B4)

## Thay đổi
- `/ws`: nền là bìa truyện đang chọn (mờ, nhạt dần), chip lọc theo nhóm, kệ bìa (truyện chọn to ra, nút/phím ←/→), tự mở truyện đầu.
- `StoryFlow`: đầu truyện to + nút rõ (Chương mới, Việc & đề xuất, Workspace nhóm, Trang truyện); mỗi tập là một dòng nước
  chảy ngang (`.ws-stream` trong globals.css, tắt khi giảm chuyển động) với các chương trên dòng; bấm chương ra dòng phiên bản
  (đang dùng màu xanh lá, "Dùng bản này" bấm 2 lần thay cho `confirm()`), bấm lại để đóng; tên chương bỏ "Chương N -" lặp.
- `/nhom-dich/[slug]`: header chỉ còn "Vào workspace nhóm"; tab Truyện có khung "Làm việc với nhóm" (quy trình dạng bước + 3 lối
  vào lớn); thẻ truyện có "Chương & phiên bản" và "+ Chương"; tên tab dễ hiểu.
- `/ws/nhom/[slug]`: dải quy trình (`components/workspace/WorkflowSteps.tsx`) đếm việc mở/đang làm từng bước, GỘP = đề xuất chờ; bấm để lọc;
  bảng trống thì chỉ chỗ mở việc.
- API `GET /stories/manageable` trả thêm `group_slug`.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `tsc --noEmit` frontend (catalog chỉ thêm một cột vào SELECT).
- Trình duyệt (neko_trans): /ws ở 400px và 1568px (kệ, đổi truyện, dòng chương, dòng phiên bản), /nhom-dich/neko-translation, /ws/nhom/neko-translation.

## Ghi chú cho người review
- Chưa thử "Dùng bản này" thật (truyện mẫu chỉ có 1 phiên bản) và số đếm việc khi có việc thật (bảng nhóm mẫu trống).
