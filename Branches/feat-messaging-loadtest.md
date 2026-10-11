# feat/messaging-loadtest

- **Mục tiêu:** Giai đoạn E4: thử tải messaging 10k → 30k kết nối
- **Tạo từ:** `origin/main` @ c0aa8ae, ngày 2026-10-11
- **Trạng thái:** xong, chờ CI
- **PR:** (chưa mở)
- **Plan:** `Plan/messaging.md` (E4), `Plan/microservices.md` (giai đoạn E, mục "Thử tải thật")

## Thay đổi
- `messaging loadtest`: tham số tiền tố người dùng (chạy nhiều container song song), mỗi kết nối giả đọc liên tục như trình duyệt (để trả
  pong), phát lần hai sau thời gian giữ để chứng minh kết nối còn sống qua các lượt ping.
- Compose: `MESSAGING_MEMORY` mặc định 512m → **768m** (10k kết nối đã dùng 441 MB).
- Kết quả đo ghi ở `Plan/messaging.md` E4, README (mục Realtime).

## Migration / biến môi trường mới
- Không có (chỉ đổi giá trị mặc định của `MESSAGING_MEMORY`).

## Đã kiểm tra
- `go vet`; 10k: nối 0,8 s, phát p95 100 ms, sau 100 s còn 10.000/10.000 (p95 51 ms), RAM 388–441 MB.
- 30k (2 × 15k): nối 2,4 s, phát p95 191–228 ms, sau 100 s còn 30.000/30.000 (p95 78–86 ms), RAM 1,12–1,28 GB.
- 100k chưa thử (cần máy riêng); đường qua gateway chưa đo.

## Ghi chú cho người review
-
