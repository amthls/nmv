# fix/review-followups

- **Mục tiêu:** Sửa các mục từ ponytail-review của #38, #43, #45
- **Tạo từ:** `origin/main` @ a9a751a, ngày 2026-10-09
- **Trạng thái:** xong, chờ review
- **PR:** (điền sau khi mở)
- **Plan:** `Plan/review-followups.md`

## Thay đổi
- Quên mật khẩu: mỗi tài khoản tối đa 1 mail mỗi 2 phút (trước chỉ giới hạn theo IP). Câu trả lời giữ nguyên.
- Token bị thu hồi (đổi mật khẩu / đăng xuất mọi thiết bị) trả 401 "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại." thay vì "Tài khoản không tồn tại".
- Test đầu tiên: `backend/src/middlewares/auth.middleware.test.ts` (`isTokenRevoked`), script `yarn test`, chạy trong job `typecheck` của CI.
- Frontend: `frontend/src/lib/apiJson.ts` thay 3 hàm gọi API trùng lặp (`/tin-nhan`, tab Bảo mật, các trang quên/đặt lại mật khẩu, xác thực email). Không đổi giao diện.
- `GET /messages/labels` bỏ trường `colors` (frontend không dùng); chú thích giữ `LABEL_COLORS` khớp `LABEL_STYLES`.
- Tìm tin nhắn: CTE `matches` quét tin một lần thay cho LATERAL theo từng cuộc trò chuyện.
- CLAUDE.md: bắt buộc nạp skill `ponytail` trước khi viết/sửa/review code.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `tsc --noEmit` backend + frontend; build lại `backend frontend`.
- `yarn test` 5/5 xanh; đổi `<` thành `<=` trong `isTokenRevoked` → 1 test đỏ; đổi lại → xanh.
- Quên mật khẩu 2 lần liền cùng email → log chỉ 1 link; lùi `created_at` token 3 phút → gửi lại được.
- Token cấp trước `tokens_valid_after` → `/auth/me` 401 với câu mới.
- Tìm tin: câu cũ và mới cho kết quả giống hệt (không lọc, theo nội dung, có `%`, theo tên, không khớp) trên 20.000 tin × 100 người (dữ liệu sinh trong transaction rồi ROLLBACK). `EXPLAIN ANALYZE`: 562 ms → 30 ms.
- `apiJson` chạy với API thật: GET có token, POST lỗi trả đúng message, POST không đăng nhập (`fetch` + `credentials`).
- Các trang `/quen-mat-khau`, `/dat-lai-mat-khau`, `/xac-thuc-email`, `/tin-nhan` trả 200.

## Ghi chú cho người review
- Chưa bấm thử giao diện bằng trình duyệt (chỉ thử helper bằng script); nên bấm qua `/tin-nhan` và tab Bảo mật một lần.
- Lúc thử, `sim_reader_001` bị đặt `tokens_valid_after` (đăng xuất mọi thiết bị) và có 2 token đặt lại mật khẩu chưa dùng.
