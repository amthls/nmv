# Tìm kiếm cùng chuẩn, thẻ truyện, lưới không phình, chống nghẽn (yêu cầu 2026-10-12)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên. Nhánh `feat/load-and-layout`.

## Chuẩn tìm kiếm (áp dụng cho MỌI ô tìm có gọi server)
- Gõ 1 ký tự là tìm (trước: thanh trên cần 2).
- Gửi yêu cầu 400 ms sau lần gõ cuối (`SEARCH_DELAY_MS`), hủy yêu cầu đang chạy khi từ khóa đổi (AbortController).
- Có chỉ báo đang tải (vòng xoay trong ô + thanh tải), kết quả cũ giữ lại mờ đi chứ không nhấp nháy trống.
- API công khai: cache Redis ngắn (đã có cho `/stories/explore`). API riêng tư: giới hạn số dòng.
- Ô chỉ lọc tại chỗ (không gọi server: chọn chương trong trình đọc, thể loại trong form truyện, lịch sử đọc) giữ lọc tức thì.

## A. Tìm kiếm
- [x] A1. `lib/useDebounced.ts` (giá trị trễ + cờ đang chờ) và `components/common/SearchInput.tsx` (icon, nút xóa, vòng xoay, thanh tải)
- [x] A2. Thanh trên (`SearchBox`): từ 1 ký tự; đóng gợi ý khi chuyển trang (bug: gợi ý còn mở sau khi bấm sang trang khác)
- [x] A3. Áp dụng: /kham-pha, /fandom, /nhom-dich (đang tìm khi Enter), /tin-nhan (300 ms), /bao-cao + /da-go (đang tìm khi Enter),
      /tai-khoan (admin tìm người dùng), `SmartStorySearch` (gắn truyện vào bài Fandom)

## B. Thẻ truyện
- [x] B1. `StoryCardGrid`: tên luôn chiếm đúng 2 dòng, dòng chương/thời gian luôn cùng một hàng dù tên ngắn hay dài

## C. Lưới không phình
- [x] C1. Lưới thẻ truyện dùng `repeat(auto-fill, minmax(…))`: màn rộng thêm cột thay vì kéo to thẻ (/kham-pha, /moi-cap-nhat, /nhieu-nguoi-xem, các lưới khác dùng StoryCardGrid)

## D. Chống nghẽn khi dữ liệu / người dùng nhiều
- [x] D1. `useRealtime`: gom sự kiện dồn dập (thông báo, tin nhắn, chat nhóm) — chạy ngay lần đầu rồi tối đa 1 lần / 1,5 s; nhiều sự kiện trong một nhịp thì lần sau gọi không kèm dữ liệu (= "có thể đã đổi, tải lại")
- [x] D2. Catalog trả danh sách không giới hạn: `GET /groups` (phân trang + "Tải thêm"), `/stories/manageable`, trang nhóm (truyện, thành viên), hồ sơ người dùng (truyện) → giới hạn số dòng
- [x] D3. Rà các trang tải danh sách lớn còn thiếu chỉ báo tải
- [x] D4. Build, thử trình duyệt, README, PR, merge

## E. Vòng sửa 2 (yêu cầu 2026-10-12, cùng nhánh vì PR chưa merge)
Bẫy tìm được: ở `/ws`, thẻ chương `scale-105` + `hover:-translate-y-1` làm thẻ nhảy dưới con trỏ (rìa thẻ nhấp nháy hover); bấm chương gọi `scrollIntoView` smooth xuống khung phiên bản; khung phiên bản co về trống (`setRevs(null)`) rồi mới phình ra mỗi lần đổi chương / bấm "Dùng bản này" → trang giật lên xuống.
- [x] E1. `/ws` StoryFlow: bỏ scale/translate ở thẻ chương (chỉ đổi màu viền), chỉ cuộn khi khung phiên bản ngoài màn hình, khung phiên bản giữ chiều cao tối thiểu, tải lại sau "Dùng bản này" không làm khung co lại
- [x] E2. `/fandom` và `/nhom-dich`: bớt phồng trên màn rộng (khung `max-w-7xl` cho Fandom, lưới nhóm `auto-fill` thêm cột thay vì kéo to thẻ)
- [x] E3. `/thong-bao`: ô tìm kiếm (server, `q` theo tiêu đề + nội dung), chuẩn tìm kiếm chung (trễ 400 ms, hủy, vòng xoay), danh sách mờ đi khi đang tải thay vì nhảy
- [x] E4. Messaging: tự xóa tin nhắn (riêng + chat nhóm) cũ hơn 7 tháng, trừ tin đã ghim; thêm vào `cleanupLoop`, README
- [x] E5. Build, thử, cập nhật Branches/, push (PR chưa mở được: máy không có `gh`)
