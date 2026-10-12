# Giảm tải: ít request hơn, hạn mức ghi theo người dùng

Nghiên cứu 2026-10-12 (đo bằng Chrome, Performance API):
- MangaDex: ~12 API/trang; tab trong trang tải lần đầu rồi giữ; quay lại tab trình duyệt / ngồi yên: 0 request; server ~5 req/s/IP, request dồn bị 503.
- Webtoons: tập 42 ảnh, mở ra tải 2, tải trước 2–3 màn hình khi cuộn.
- Royal Road: cả chương trong 1 HTML 37KB, không API, không tải trước chương sau.
- GitHub: hạn mức ghi theo người dùng (~80/phút, 500/giờ), khóa nút khi đang xử lý, việc nặng chạy nền.
- NovelHub (trước khi sửa): trang truyện 27 request (~12 API + ~15 Next.js tự tải trước link), truyện và lịch sử bị gọi 2 lần,
  `/api/identity/me` + `/api/v1/auth/me`; trình đọc 7 API + 9 tải trước; bộ lọc Khám phá 6 lần bấm = 4 request;
  quay lại tab / ngồi yên: 0 (tốt). Service workspace không có hạn mức theo người dùng.

Mỗi mục một nhánh + PR. Đo lại sau mỗi mục và ghi số.

## A. Ít request hơn
- [x] A1. Link chỉ tải trước khi rê chuột/chạm (`components/common/Link.tsx` thay `next/link`; `check-nav.sh` chặn import thẳng).
- [ ] A2. Bỏ request trùng (truyện ×2, lịch sử ×2, hai API `me`); `lib/fetchCache`: cùng URL trong vài giây dùng chung một request.
- [ ] A3. Tab trong trang tải lần đầu rồi giữ dữ liệu (trang truyện, tài khoản, nhóm, ws).
- [ ] A4. Bộ lọc Khám phá: debounce 300 ms (hủy request cũ đã có).
- [ ] A5. Cache Redis cho trang truyện + nội dung chương (30–60 s, xóa khi sửa).
- [ ] A6. 429: server gửi `Retry-After`; frontend báo "thao tác hơi nhanh, thử lại sau N giây", GET thử lại 1 lần.

## B. Hạn mức ghi (kiểu GitHub)
- [ ] B1. Service workspace: hạn mức theo người dùng (Redis): ghi thường 60/phút + 600/giờ; dùng bản cũ / đăng / lên lịch 10/phút + 100/giờ; sao chép nháp 20/giờ. 429 + `Retry-After`.
- [ ] B2. Catalog: hạn mức ghi theo người dùng (giữ theo IP làm lớp ngoài).
- [ ] B3. Khóa nút khi đang xử lý ở mọi nút ghi trong ws / đăng truyện.
- [ ] B4. UI 429: đếm ngược, khóa nút; không tự thử lại thao tác ghi.
- [ ] B5. Tab ẩn lâu: ngừng gia hạn khóa nháp mỗi 30 s, gia hạn lại khi quay về.

## Kết quả đo
| Bước | Trang truyện | Trình đọc | Ghi chú |
|---|---|---|---|
| Trước | 27 request (12 API) | 16 (7 API) | |
| A1 | 11 (11 API, 0 tải trước) | | rê chuột lên chương: tải trước, bấm → 41 ms |
