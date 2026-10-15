# fix/aemeath-crystals-subtle

- **Mục tiêu:** Pha lê 3D của skin Aemeath nhỏ, mờ, chậm ("nhìn thấy nhưng không để ý")
- **Tạo từ:** `origin/main` ngày 2026-10-15
- **Trạng thái:** xong, chờ merge
- **PR:** (xem PR của nhánh)
- **Plan:** Plan/aemeath-3d.md

## Thay đổi
- Nền: 4 pha lê ~25-45px ở mép (xoay >= 50s, trôi vài px), 70 sao nhỏ mờ, camera theo chuột <= ~5px có lerp; canvas opacity .6, vật liệu mờ (.45), viền cyan .25.
- Đổi skin: 14 mảnh nhỏ (~12px), opacity <= .4, tản ngắn rồi ghép lại ~0.9s.
- 404: 3 pha lê ~15-30px, xoay chậm, nghiêng theo chuột rất nhẹ.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- tsc, build, trình duyệt skin Aemeath dark: trang chủ và 404, pha lê gần như hòa vào nền.

## Ghi chú cho người review
- Trước: pha lê lớn trắng chói ở rìa; sau: chỉ còn vài đốm nhỏ ở mép.
