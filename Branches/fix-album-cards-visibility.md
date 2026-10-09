# fix/album-cards-visibility

- **Mục tiêu:** Thẻ album đều nhau ở mọi nơi; đổi công khai/riêng tư cho từng album ngay trên thẻ, và cho tất cả album cùng lúc.
- **Tạo từ:** `origin/main` @ d48105e, ngày 2026-10-09
- **Trạng thái:** chờ review
- **PR:** https://github.com/amthls/nmv/pull/45
- **Plan:** không cần (việc nhỏ)

## Thay đổi
- **Thẻ album lệch nhau** (`/bookmark` cả 2 tab, tổng quan `/tai-khoan`, "Album khác có truyện này" ở trang truyện): khung ảnh 4:3 thiếu `overflow-hidden` nên ảnh bìa dọc dài kéo giãn khung (quy tắc `aspect-ratio` của CSS). Thêm `overflow-hidden`, lưới ảnh phủ kín khung (`absolute inset-0`, luôn có số hàng), ảnh `min-h-0`. Tên album luôn chừa 2 dòng để các dòng dưới thẳng hàng.
- Ảnh ghép đầu trang `/album/[id]`: cùng lỗi khi album có 2 truyện → sửa tương tự.
- Đã rà các khung ảnh bìa khác (trang album, trang cá nhân, trang tài khoản): đều có `overflow-hidden`, không lỗi.
- **Công khai/riêng tư từng album:** nhãn "Công khai/Riêng tư" trên thẻ ở tab "Album của tôi" bấm được để đổi (trước đây chỉ đổi được trong trang chi tiết album).
- **Tất cả album cùng lúc:** thanh trên lưới "x công khai · y riêng tư" + nút "Công khai tất cả", "Riêng tư tất cả"; API mới `PUT /albums/me/visibility` (`is_public`).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Typecheck backend + frontend.
- Chrome `/bookmark`: tab "Album đã lưu" 4 thẻ khung ảnh cùng cao (194px), tên cùng hàng (trước đó lệch); tab "Album của tôi" tương tự.
- Bấm nhãn trên 1 thẻ → chỉ album đó đổi (UI + DB), không chuyển trang; "Riêng tư tất cả" / "Công khai tất cả" đổi cả 2 album; đã trả về trạng thái ban đầu (cả 2 công khai).
