# security/workspace-write-quota

- **Mục tiêu:** Hạn mức ghi theo người dùng cho service workspace (kiểu GitHub), 429 + Retry-After
- **Tạo từ:** `origin/main` @ cc97129, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/load.md` (B1)

## Thay đổi
- Mới `services/workspace/quota.go`: `limitWrites` bọc các route; đếm theo người dùng đã đăng nhập, trong bộ nhớ:
  thường 60/phút + 600/giờ; nặng (rewind, pull, reclaim, nhận đề xuất) 10/phút + 100/giờ; sao chép nháp 20/giờ.
  Không tính: GET, `/internal/*`, khóa nháp. Vượt: 429 + `Retry-After` + `retry_after_seconds`.
- `main.go`: gắn `limitWrites`; `http.go`: trường `quota` (nil trong test cũ = không giới hạn).
- `quota_test.go`: cửa sổ phút/giờ, tách theo người, phân loại route.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `gofmt -l`, `go vet`, `go test ./...` sạch; container workspace build và chạy.
- Chưa thử 429 thật qua gateway (cần 61 thao tác ghi thật).

## Ghi chú cho người review
- shortcut: bộ đếm trong bộ nhớ một tiến trình; chuyển sang Redis khi chạy nhiều bản workspace.
