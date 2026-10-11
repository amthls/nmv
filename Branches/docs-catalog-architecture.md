# docs/catalog-architecture

- **Mục tiêu:** Giai đoạn I4: đo lại tải, RAM; README viết lại phần kiến trúc
- **Tạo từ:** `origin/main` @ c503740, ngày 2026-10-11
- **Trạng thái:** xong
- **PR:** https://github.com/amthls/nmv/pull/82
- **Plan:** `Plan/catalog.md` (I4), `Plan/microservices.md` (giai đoạn I)

## Thay đổi
- README "Kiến trúc & Công nghệ": bảng 8 service (ngôn ngữ, database, giữ gì), sơ đồ gateway → service, danh sách container,
  RAM lúc rảnh, bảng độ trễ so với mốc giai đoạn A. Cây thư mục viết lại (bỏ phần Go của service search cũ, thêm `services/*`).
- Plan: tick giai đoạn I, mục đo RAM.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `node scripts/bench.mjs http://127.0.0.1:3000 100` và `docker stats --no-stream` trên máy local (bản main sau #81).
- Đối chiếu route gateway (`nginx.conf`) và mạng của từng service (`docker-compose.yml`) với sơ đồ.
