# fix/navbar-compact

- **Mục tiêu:** Thanh header gọn và đẹp hơn: bớt thứ hiển thị cùng lúc, mọi nút cùng một kiểu, chức năng phụ vào menu.
- **Tạo từ:** `origin/main` @ 24cc99a, ngày 2026-10-09
- **Trạng thái:** chờ chủ dự án duyệt giao diện (chưa push bản thiết kế lại)
- **PR:** (điền sau khi mở)
- **Plan:** không cần (việc nhỏ)

## Thay đổi
**Bố cục rộng hơn, hết cảm giác "đóng hộp"**
- Khung nội dung các trang danh sách (trang chủ, khám phá, fandom, nhóm dịch, đăng truyện tranh, carousel, footer) nới từ `max-w-7xl` (1280px) lên `max-w-[1600px]`.

**Giao diện thanh mảnh hơn (bớt "béo")**
- Ảnh minh họa trang chủ: lưới ô đều tỉ lệ 3:4 (cắt từ trên), 3/4/6/8 cột theo màn hình, thay cho masonry cao tự do (ảnh truyện tranh dài thành dải khổng lồ khi trang rộng).
- Tiêu đề banner "Truyện nổi bật tuần" 40px → 28px, bớt đậm; tiêu đề các mục nhỏ và nhẹ hơn một nấc.

**Header** (`Navbar.tsx`, `ThemeToggle.tsx`)
- Thanh trải hết chiều ngang như thiết kế cũ, mảnh (cao 56px), nội dung rộng 1600px thẳng hàng với trang.
- Logo gradient 32px + chữ "Novel**Hub**"; bỏ dòng phụ và link "Trang chủ" (logo đã về trang chủ).
- Link Khám phá / Fandom / Nhóm dịch; **trang đang xem có nền gradient xanh–hồng tím** (`aria-current`).
- Điểm nhấn màu: đường gradient phát sáng dọc mép dưới header, chữ "Hub" gradient, icon mỗi nút một màu (Random cam, tin nhắn xanh trời, thông báo hồng), nút Tiện ích gradient hồng tím–xanh–cyan.
- Ô tìm kiếm rộng hơn, gợi ý `Ctrl K`; **Ctrl/Cmd + K** nhảy vào ô tìm (màn nhỏ mở `/kham-pha`).
- Sáng/tối, Random, tin nhắn, thông báo: nút vuông bo 36px, nền + viền nhẹ.
- Nút Tiện ích: **icon ô lưới** gradient thay cho "+ Đăng" (xoay nhẹ khi rê chuột); avatar viền gradient, tên + vai trò trong menu tài khoản.
- Màn nhỏ: menu ☰ chứa tìm kiếm, link, lịch sử, album, hòm Random, đổi giao diện.

**Bảng Tiện ích** (`QuickActionModal.tsx`)
- Gọn như thiết kế cũ (icon + tiêu đề + mô tả một dòng) nhưng **rộng hơn**: `max-w-4xl`, 3 cột trên màn rộng.
- Mỗi mục một màu icon riêng (trước đây nhiều mục bị theme đổi thành cùng màu xanh).
- Đóng bằng ✕, **bấm ra ngoài hoặc Esc**.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Typecheck frontend; build lại container frontend.
- Chrome màn rộng: header trải ngang mảnh, nội dung 1600px, ảnh bìa tải đủ, ảnh minh họa 8 cột đều, bảng Tiện ích 3 cột.
- Bảng Tiện ích: bấm bên trong không đóng, bấm ngoài và Esc đóng, không chuyển trang.
- Màn điện thoại chưa xem trực quan được (cửa sổ trình duyệt đang phóng to); tính theo class thì header ~320px, vừa khung 390px.
