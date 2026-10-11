# feat/library-reading-position

- **Mục tiêu:** Giai đoạn G2: vị trí đọc + Đọc tiếp đúng chỗ, gom ghi lịch sử, giới hạn 1.000 truyện, gộp lịch sử khách
- **Tạo từ:** `origin/main` @ 140590f, ngày 2026-10-11
- **Trạng thái:** xong, chờ merge
- **PR:** (chưa mở)
- **Plan:** Plan/library.md (G2)

## Thay đổi
- library: `POST /history` ghi vào bộ đệm (`positions.go`), ghi xuống DB mỗi 60 s / khi tắt / trước khi đọc hoặc xóa lịch sử của người đó;
  `POST /history/merge` (lịch sử khách); đối soát hằng đêm giữ 1.000 truyện/người.
- frontend: trang đọc gửi % cuộn mỗi 15 s và khi ẩn tab/rời chương (cả khách, vào localStorage); "Đọc tiếp" ở `/lich-su` và trang truyện
  có `#vt=<%>`, trang đọc cuộn tới đó; đăng nhập xong gộp lịch sử khách; bỏ `POST /api/v1/history` thừa (404 từ G1).
- `scripts/library-smoke.py` thêm vị trí + gộp; README.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `go vet`, `go test` library (tích hợp: bộ đệm cộng giây, flush, merge chỉ ghi đè khi mới hơn, cắt 1.000 truyện, xóa không bị ghi lại), `tsc` frontend.
- Smoke 32/32 qua gateway. Trình duyệt: cuộn 60% → rời → "Đọc tiếp" `#vt=60` mở lại đúng 60%; mục khách gộp vào tài khoản.

## Ghi chú cho người review
- Sự kiện `chapter.read`, `story.followed` để giai đoạn H (chưa có bên nhận). Bộ đệm trong bộ nhớ (1 bản library), đổi sang Redis khi chạy nhiều bản.
