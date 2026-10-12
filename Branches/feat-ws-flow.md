# feat/ws-flow

- **Mục tiêu:** Đăng chương không tự đổi route; truyện chữ/tranh là hai route thật; `/ws` trực quan (kệ truyện → dải danh mục → phiên bản)
- **Tạo từ:** `origin/main` @ b228247, ngày 2026-10-12
- **Trạng thái:** xong B1–B3, B4 hoãn
- **PR:** (xem GitHub)
- **Plan:** Plan/ui-overhaul.md

## Thay đổi
- `/dang-chuong`: bỏ tự chuyển sang trình đăng truyện tranh; chọn truyện tranh thì hiện gợi ý kèm link; nút "Quay lại" dùng lịch sử trình duyệt (dự phòng `/ws`), không cứng `/nhom-dich`
- `/dang-truyen-tranh`: bỏ tự chuyển sang trình đăng truyện chữ, hiện thông báo
- `/ws`: kệ bìa truyện theo nhóm, chọn truyện (URL `?truyen=`) mở dải ngang theo danh mục, chọn chương (`&chuong=`) hiện các phiên bản (đọc, sửa, so sánh, "Dùng bản này"); nháp và việc nằm bên dưới
- catalog: `GET /stories/manageable` trả thêm `cover_image_url`
- `components/workspace/StoryFlow.tsx` mới

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit`, build catalog + frontend, các trang trả 200
- CHƯA thử giao diện sau đăng nhập trên trình duyệt (đăng nhập thử bị chặn)

## Ghi chú cho người review
- B4 (đơn giản hóa `/nhom-dich`) chưa làm.
