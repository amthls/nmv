# refactor/nestjs-go-layout

- **Mục tiêu:** Catalog, community, media chuyển sang NestJS 11 (mỗi chức năng một module); library, identity, messaging, workspace theo bố cục Go chuẩn (`cmd/` + `internal/<chức-năng>/`). Giữ nguyên URL, JSON, mã HTTP, SQL.
- **Tạo từ:** `origin/main` @ bec5e83, ngày 2026-10-14 (nhánh đổi tên từ `refactor/catalog-modules`)
- **Trạng thái:** đang làm (chi tiết từng mốc trong plan)
- **PR:** không mở PR, không merge: chủ dự án tự quyết khi nào merge (quyết định 2026-10-14)
- **Plan:** `Plan/nestjs-go-layout.md`

## Thay đổi
- Mốc 0: `scripts/contract-snapshot.py` và bản mẫu hợp đồng chụp từ code của `main`.
- (các mốc sau ghi dần trong plan)

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- (ghi theo từng mốc)

## Ghi chú cho người review
- Mỗi mốc là một commit; so hợp đồng bằng `python scripts/contract-snapshot.py --compare`.
