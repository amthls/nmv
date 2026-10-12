# fix/lock-write-buttons

- **Mục tiêu:** Khóa nút ghi khi đang gửi (Nhận lại nháp, Tạo bản sao); ngừng gia hạn khóa nháp khi tab ẩn lâu
- **Tạo từ:** `origin/main` @ f24c57d, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/load.md` (B3, B5, C6)

## Thay đổi
- `components/workspace/DraftCard.tsx`, `app/ws/truyen/[slug]/page.tsx`: "Tạo bản sao", "Nhận lại" khóa trong lúc gửi.
- `app/dang-chuong/page.tsx`: `once` cho 6 thao tác nháp (sao chép, gửi chủ nháp, từ chối bản sao, hủy hẹn, rút đề xuất, bỏ nháp); nút khóa khi đang chạy.
- B5: không sửa (khóa nháp đã chỉ gia hạn khi vừa gõ trong 2 phút).
- `app/kham-pha/page.tsx`: ô tìm ghi "Tìm trong N bộ lọc đang áp dụng" khi có lọc; không có kết quả thì có nút tìm trên toàn bộ truyện.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit`, `check-nav.sh`; /dang-chuong mở không lỗi.
- Chrome Khám phá: lọc Truyện tranh + "oshi" → 0 kết quả + câu báo + nút; bấm nút → ra truyện Oshi (truyện chữ).

## Ghi chú cho người review
- Chưa bấm thử từng nút nháp (cần nháp chia sẻ / hẹn đăng thật).
