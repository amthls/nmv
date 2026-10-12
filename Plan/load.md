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
- [x] A2. Bỏ request trùng. Quét 9 trang: chỉ trang truyện (truyện ×2, lịch sử ×2) và Khám phá (explore ×2) bị trùng, sửa tận gốc nên không cần `lib/fetchCache`.
  Hai API `me` là của hai service (tài khoản / hồ sơ): giữ cả hai, gọi song song.
- [x] A3. Tab tải lần đầu rồi giữ: `lib/memo.ts` (giữ 60 s, `forget` sau khi đổi) cho kệ truyện + phiên bản ở /ws; tab Chat của nhóm
  chỉ tải lại khi có tin mới trong lúc ở tab khác; tab Quản lý vai trò tải một lần. (Trang truyện không có tab; ws/de-xuat không tải khi đổi tab.)
- [x] A4. Khám phá: một request cho mỗi đợt thay đổi (chờ 150 ms; hủy request cũ đã có).
- [x] A5. Cache Redis phần chung của trang truyện + chương (60 s, `cachedPublic`); ghi thành công ở `/api/v1`, phiên bản từ
  workspace, xóa hẳn truyện tăng `pubcache:gen` trước khi trả lời → người sửa thấy ngay. Đã thử: sửa tóm tắt, đọc lại ngay = bản mới.
- [x] A6. 429: catalog đã có `Retry-After`; thêm cho nginx (`@too_many`, 2 s) và community. `RateLimitNotice` (layout) bắt mọi 429 cùng
  origin: thông báo đếm ngược; GET chờ ≤ 5 s thì gửi lại 1 lần, thao tác ghi không bao giờ tự gửi lại.

## B. Hạn mức ghi (kiểu GitHub)
- [ ] B1. Service workspace: hạn mức theo người dùng (Redis): ghi thường 60/phút + 600/giờ; dùng bản cũ / đăng / lên lịch 10/phút + 100/giờ; sao chép nháp 20/giờ. 429 + `Retry-After`.
- [ ] B2. Catalog: hạn mức ghi theo người dùng (giữ theo IP làm lớp ngoài).
- [ ] B3. Khóa nút khi đang xử lý ở mọi nút ghi trong ws / đăng truyện.
- [x] B4. UI 429: đếm ngược, không tự thử lại thao tác ghi (cùng PR với A6; khóa nút khi đang gửi: B3).
- [ ] B5. Tab ẩn lâu: ngừng gia hạn khóa nháp mỗi 30 s, gia hạn lại khi quay về.

## Kết quả đo
| Bước | Trang truyện | Trình đọc | Ghi chú |
|---|---|---|---|
| Trước | 27 request (12 API) | 16 (7 API) | |
| A1 | 11 (11 API, 0 tải trước) | | rê chuột lên chương: tải trước, bấm → 41 ms |
| A3 | | | /ws: đổi truyện A→B→A→B: 1 request (trước 4); mở chương qua lại 4 lần: 1; tab Chat mở 3 lần: 1 |
| A5 | | | DB: trang truyện 7 → 0 truy vấn khi cache trúng (+ quyền/theo dõi nếu đăng nhập), chương 6 → 0 |
| A6 | | | 150 GET dồn: 125 qua (có lần gửi lại sau 2 s), 25 vẫn 429; thông báo đếm ngược hiện |
| A2+A4 | 10 API, 0 trùng | 7 API | Khám phá: mở 1 request (trước 2); 6 lần bấm lọc → 1 request (trước 4) |
