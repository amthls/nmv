# feat/load-and-layout

- **Mục tiêu:** Tìm kiếm cùng chuẩn ở mọi ô, thẻ truyện thẳng hàng, lưới không phình, chống nghẽn khi dữ liệu nhiều
- **Tạo từ:** `origin/main` @ ede84ac, ngày 2026-10-12
- **Trạng thái:** xong, chờ merge
- **PR:** (chưa mở)
- **Plan:** Plan/load-and-layout.md

## Thay đổi
- Ô tìm kiếm cùng chuẩn (`SearchInput`, `useDebounced`): 1 ký tự, trễ 400 ms, hủy yêu cầu cũ, vòng xoay + thanh tải
- Thẻ truyện: tên 2 dòng, hàng chương thẳng hàng; lưới `auto-fill` không phình
- `useRealtime` gom sự kiện dồn dập (`coalesce.ts` + test)
- `/ws`: thẻ chương hết nhảy (bỏ scale/translate, chỉ cuộn khi khung phiên bản ngoài màn hình, khung phiên bản giữ chiều cao)
- `/fandom` khung `max-w-7xl`, `/nhom-dich` lưới `auto-fill`
- `/thong-bao`: ô tìm (`GET /notifications?q=`), trễ 400 ms, mờ khi tải
- Lưới thẻ tự co giãn (`auto-fill`) ở bookmark, album, hồ sơ người dùng, trang nhóm, workspace nhóm
- Tải EPUB/PDF: nghỉ 15 giây giữa hai lần tạo tệp (nút đếm ngược, giữ cả khi đóng mở lại hộp thoại)
- `scripts/crawler.py`: bỏ hai nguồn không cào được (NetTruyen, TruyenYY), còn MangaDex, TopTruyen, Valvrare
- `scripts/crawler.py`: thêm `--delay` (mặc định 2 giây giữa hai yêu cầu cùng một trang, nghỉ thêm giữa hai truyện); sau khi nhập truyện chạy `workspace import` để chương mới có phiên bản 1 trong workspace
- Bỏ danh sách "Thiết bị đang đăng nhập" ở tab Bảo mật (giữ nút "Đăng xuất khỏi mọi thiết bị"; API `/sessions` của identity còn nguyên)
- Messaging: tự xóa tin nhắn cũ hơn 7 tháng (trừ tin ghim)
- Catalog giới hạn/phân trang: `/groups`, `/stories/manageable`, trang nhóm, hồ sơ người dùng

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- tsc catalog + frontend sạch, `npm test` (frontend) qua, build lại docker, các trang /kham-pha /moi-cap-nhat /nhom-dich trả 200

## Ghi chú cho người review
-
