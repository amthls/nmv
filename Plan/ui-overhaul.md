# Plan: sửa giao diện hàng loạt (yêu cầu 2026-10-12)

Làm theo thứ tự, xong mục nào đổi `[x]`. Mỗi cụm là một PR vào `main` (không xếp chồng).

## A. Trang chủ + quy trình (nhánh feat/ui-overhaul)
- [x] A1. Xóa hàng "Ảnh minh họa mới" ở `/` (giữ ảnh nền của carousel)
- [x] A2. Thêm "Hướng dẫn quy trình làm chương" mở/đóng được (`components/home/WorkflowGuide.tsx`)

## B. Đăng chương + workspace (nhánh feat/ws-flow)
- [x] B1. `/dang-chuong` không tự chuyển về nhóm dịch: nút quay lại theo `history`/nguồn vào, không cứng `/nhom-dich`
- [x] B2. Truyện chữ / truyện tranh: bỏ cách "tự nhảy theo truyện đã chọn", dùng hai route thật (`/dang-chuong` và `/dang-truyen-tranh`) với tab điều hướng thật; chọn truyện sai loại thì hiện gợi ý, không tự chuyển trang
- [x] B3. `/ws` thiết kế lại: danh sách truyện của nhóm → bấm ra dải chảy ngang (kiểu màn hình chủ PS5) theo danh mục (tập) → chương → phiên bản (xem, dùng bản đó)
- [x] B4. Nhóm dịch + ws trực quan hơn (nhánh feat/ws-group-redesign, yêu cầu lần 2 ngày 2026-10-12):
  - [x] B4a. `/ws`: nền là bìa truyện đang chọn (mờ), chip lọc theo nhóm, kệ bìa (←/→ đổi truyện, tự chọn truyện đầu),
        đầu truyện to với nút rõ (Chương mới, Việc & đề xuất, Workspace nhóm, Đọc), mỗi tập là một "dòng nước" chảy ngang
        có các chương nằm trên dòng; chọn chương → dòng phiên bản (đang dùng / dùng bản này / so sánh). API `/stories/manageable` trả thêm `group_slug`
  - [x] B4b. `/nhom-dich/[slug]`: thành viên thấy khung "Làm việc với nhóm" (quy trình dạng các bước có mũi tên, 3 nút lớn:
        Workspace nhóm, Đăng chương, Đăng truyện), thẻ truyện có nút Workspace + Đăng chương; tab tên dễ hiểu
  - [x] B4c. `/ws/nhom/[slug]`: dải quy trình đếm việc từng bước (bấm để lọc), hướng dẫn ngắn
  - [x] B4d. Thử trên trình duyệt (rộng + hẹp), README, PR, merge

- [x] B5. Góp ý lần 3 (nhánh fix/upload-ws-clarity): lọc "Mọi truyện/Mọi người" → "Tất cả truyện/thành viên";
      "Việc & đề xuất" → "Giao việc & duyệt bản dịch" + câu giải thích ở trang truyện; đổi truyện/chương ở `/ws` thay mục lịch sử
      (Quay lại rời /ws); `/dang-chuong` và `/dang-truyen-tranh` dùng chung `UploadHeader` (Quay lại, công tắc, tiêu đề, cùng bề rộng),
      công tắc thay mục lịch sử nên Quay lại về trang trước khi vào đăng chương

## C. Trình đọc (nhánh feat/reader-responsive)
- [x] C1. Cài đặt đọc truyện chữ co giãn theo màn hình, cuộn được khi thiếu chỗ
- [x] C2. Bỏ lựa chọn "tự động độ phân giải", để người dùng tự chọn
- [x] C3. Truyện tranh: mỗi ảnh có trạng thái đang tải, lỗi thì báo ở đúng ảnh + nút thử lại
- [x] C4. Sửa route khi bấm quay lại (không bị đẩy sai trang)

## D. Điện thoại (nhánh feat/mobile-ui)
- [ ] D1. Rà các trang chính ở 360/390/430/768 px: không tràn ngang, nút đủ lớn (chưa làm: cửa sổ trình duyệt tự động không thu nhỏ được và CSP chặn iframe nên không đo được; cần thử trên điện thoại thật hoặc DevTools)
- [ ] D2. Bố cục riêng cho điện thoại (thanh điều hướng dưới, trình đọc, ws)

## E. Popup truyện (nhánh feat/popup-toggle)
- [x] E1. Popup có icon nhỏ, bấm ra thanh bật/tắt popup
- [x] E2. Công tắc popup cũng nằm trong Cài đặt

## F. Elasticsearch
- [x] F1. Rà xong (2026-10-12). Elasticsearch chỉ index **truyện** (catalog: `search.service.ts`, dùng ở `/stories/explore?q=`, thanh tìm kiếm; ES lỗi thì rơi về SQL ILIKE). Còn dùng SQL `ILIKE` (chưa qua ES): tìm nhóm dịch (`group.controller.ts`), tìm bài Fandom và báo cáo/kiểm duyệt (`services/community`), tìm tin nhắn (`services/messaging/dm.go`), tìm tài khoản của admin (`services/identity/admin.go`), tìm truyện trong trang kiểm duyệt (`internal.controller.ts`). Chưa đổi: đưa nhóm dịch, bài Fandom vào ES là việc riêng (chủ dự án đã hoãn search-service F2; tin nhắn và tài khoản không nên đưa vào ES vì riêng tư)
