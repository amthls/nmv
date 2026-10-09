# fix/navbar-compact

- **Mục tiêu:** Thanh header gọn và đẹp hơn: bớt thứ hiển thị cùng lúc, mọi nút cùng một kiểu, chức năng phụ vào menu.
- **Tạo từ:** `origin/main` @ 24cc99a, ngày 2026-10-09
- **Trạng thái:** chờ review
- **PR:** (điền sau khi mở)
- **Plan:** không cần (việc nhỏ)

## Thay đổi
- Header thấp hơn (`h-16` → `h-14`). Logo nhỏ lại, bỏ dòng phụ "Light Novel & Manga".
- Bỏ link "Trang chủ" (bấm logo đã về trang chủ); "Fandom / Blog" → "Fandom". Link chỉ hiện từ màn `lg`.
- Ô tìm kiếm gọn hơn (`max-w-sm`, bo góc vuông vừa); màn nhỏ thay bằng icon kính lúp dẫn tới `/kham-pha`.
- Random, giao diện sáng/tối, tin nhắn, thông báo: icon cùng cỡ 36px, không viền, không gradient. Chỉ nút **+** (Tiện ích) có màu nhấn.
- Avatar không còn tên + huy hiệu vai trò bên cạnh; tên và vai trò nằm ở đầu menu tài khoản (bỏ email khỏi menu).
- Khách: chỉ còn nút "Đăng nhập" (đăng ký vẫn có trong hộp đăng nhập và menu ☰).
- Menu ☰ (dưới `lg`): tìm kiếm, các link, lịch sử, album; dưới `sm` thêm hòm truyện ngẫu nhiên và nút đổi giao diện.
- `ThemeToggle`: cùng kiểu icon với các nút khác (chỉ dùng ở header).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Typecheck frontend; build lại container frontend.
- Chrome màn rộng: header một hàng gọn, menu tài khoản hiển thị tên + vai trò, trang không tràn ngang.
- Màn điện thoại chưa xem trực quan được (cửa sổ trình duyệt đang phóng to); tính theo class thì header ~320px, vừa khung 390px.
