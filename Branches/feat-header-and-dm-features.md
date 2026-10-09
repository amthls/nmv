# feat/header-and-dm-features

- **Mục tiêu:** Gộp header mới + bố cục rộng hơn và tính năng tin nhắn (nhãn, tìm theo nhãn, chặn, ghim) thành một PR.
- **Tạo từ:** `origin/main` @ d48105e, ngày 2026-10-09
- **Trạng thái:** chờ review
- **PR:** https://github.com/amthls/nmv/pull/43
- **Plan:** `Plan/dm-labels-block-pin.md`

## Gồm những gì (merge nguyên nhánh, giữ lịch sử commit)
| Nhánh | Nội dung | Chi tiết |
|---|---|---|
| `fix/navbar-compact` | Header trải ngang mảnh, nhiều màu (đường gradient, icon màu, link đang xem gradient), Ctrl+K, nút Tiện ích icon ô lưới; bảng Tiện ích gọn 3 cột; trang danh sách rộng 1600px; ảnh minh họa lưới đều; tiêu đề nhẹ hơn | `Branches/fix-navbar-compact.md` |
| `feat/dm-labels-block-pin` | Tin nhắn: nhãn riêng, lọc + tìm theo nhãn, chặn hai chiều, ghim tin | `Branches/feat-dm-labels-block-pin.md` |

## Migration / biến môi trường mới
- `sql/migrations/016_dm_labels_block_pin.sql` (đã chép vào `sql/database.sql`). Server: chạy `sh scripts/migrate.sh` sau khi deploy.

## Đã kiểm tra
- Nội dung giống hệt nhánh xem thử đã build và chủ dự án xem trên localhost; typecheck backend + frontend.
- Header, bảng Tiện ích, trang chủ: Chrome màn rộng, chế độ tối và sáng.
- Tin nhắn: trên Chrome (tạo / đổi màu / gắn nhãn, lọc, tìm có tô sáng, ghim + thanh "Đã ghim"); qua API bằng 2 tài khoản test (chặn hai chiều, bỏ chặn, quyền ghim, nhãn không lộ cho người kia).

## Ghi chú cho người review
- Giao diện điện thoại chưa xem trực quan được (cửa sổ trình duyệt phóng to); tính theo class thì vừa 390px.
