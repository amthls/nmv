# Plan: sửa giao diện hàng loạt (yêu cầu 2026-10-12)

Làm theo thứ tự, xong mục nào đổi `[x]`. Mỗi cụm là một PR vào `main` (không xếp chồng).

## A. Trang chủ + quy trình (nhánh feat/ui-overhaul)
- [x] A1. Xóa hàng "Ảnh minh họa mới" ở `/` (giữ ảnh nền của carousel)
- [x] A2. Thêm "Hướng dẫn quy trình làm chương" mở/đóng được (`components/home/WorkflowGuide.tsx`)

## B. Đăng chương + workspace (nhánh feat/ws-flow)
- [x] B1. `/dang-chuong` không tự chuyển về nhóm dịch: nút quay lại theo `history`/nguồn vào, không cứng `/nhom-dich`
- [x] B2. Truyện chữ / truyện tranh: bỏ cách "tự nhảy theo truyện đã chọn", dùng hai route thật (`/dang-chuong` và `/dang-truyen-tranh`) với tab điều hướng thật; chọn truyện sai loại thì hiện gợi ý, không tự chuyển trang
- [x] B3. `/ws` thiết kế lại: danh sách truyện của nhóm → bấm ra dải chảy ngang (kiểu màn hình chủ PS5) theo danh mục (tập) → chương → phiên bản (xem, dùng bản đó)
- [ ] B4. (hoãn) Giao diện nhóm dịch `/nhom-dich` đơn giản hơn: chưa làm

## C. Trình đọc (nhánh feat/reader-responsive)
- [ ] C1. Cài đặt đọc truyện chữ co giãn theo màn hình, cuộn được khi thiếu chỗ
- [ ] C2. Bỏ lựa chọn "tự động độ phân giải", để người dùng tự chọn
- [ ] C3. Truyện tranh: mỗi ảnh có trạng thái đang tải, lỗi thì báo ở đúng ảnh + nút thử lại
- [ ] C4. Sửa route khi bấm quay lại (không bị đẩy sai trang)

## D. Điện thoại (nhánh feat/mobile-ui)
- [ ] D1. Rà các trang chính ở 360/390/430/768 px: không tràn ngang, nút đủ lớn
- [ ] D2. Bố cục riêng cho điện thoại (thanh điều hướng dưới, trình đọc, ws)

## E. Popup truyện (nhánh feat/popup-toggle)
- [ ] E1. Popup có icon nhỏ, bấm ra thanh bật/tắt popup
- [ ] E2. Công tắc popup cũng nằm trong Cài đặt

## F. Elasticsearch
- [ ] F1. Rà mọi chức năng tìm kiếm, nêu cái nào chưa dùng ES (chỉ báo, không tự đổi kiến trúc nếu lớn)
