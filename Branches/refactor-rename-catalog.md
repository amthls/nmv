# refactor/rename-catalog

- **Mục tiêu:** Giai đoạn I2: đổi tên service backend thành catalog
- **Tạo từ:** `origin/main` @ 26a7e58, ngày 2026-10-11
- **Trạng thái:** xong
- **PR:** (chưa mở)
- **Plan:** `Plan/catalog.md` (I2)

## Thay đổi
- Thư mục `backend/` → `catalog/`; compose service `catalog`, container `novel_catalog`, image `nmv-catalog` (cả worker);
  alias mạng `backend` trên cả hai mạng nên `http://backend:5000` cũ vẫn chạy.
- Biến: `USER_SIG_KEY_BACKEND` → `USER_SIG_KEY_CATALOG`, `INTERNAL_KEY_BACKEND` → `INTERNAL_KEY_CATALOG`,
  `BACKEND_INTERNAL_URL` → `CATALOG_INTERNAL_URL`, `BACKEND_ORIGIN` → `CATALOG_ORIGIN` (mọi service, `.env.example`, CI, launch.py).
- nginx (`$catalog_upstream`), CI/CD (thư mục, image, cache scope, `compose pull/logs`), dependabot, `restore.sh`, `crawler.py`,
  `launch.py`, `package.json` gốc, log mặc định `service: catalog`.
- README (ghi chú đổi tên + nâng cấp máy cũ), CLAUDE.md, scripts/README.

## Migration / biến môi trường mới
- `.env` cần `USER_SIG_KEY_CATALOG`, `INTERNAL_KEY_CATALOG` (launch.py tự thêm; hoặc chép giá trị hai khóa cũ). Không có migration.

## Đã kiểm tra
- tsc (catalog, frontend, community, media), go vet (identity, workspace, messaging, library), `docker compose config`.
- Máy local: `docker compose up -d --build --remove-orphans` (container `novel_backend` bị gỡ, `novel_catalog` chạy), `nginx -s reload`;
  trang chủ, /fandom, trang truyện, `/api/v1/health` 200; `workspace-smoke`, `community-smoke`, `library-smoke` qua; log không lỗi.

## Ghi chú cho người review
- Giữ nguyên: tên database `novel_platform` (chủ dự án quyết định), hàng đợi `backend.identity`/`backend.workspace` (đổi tên là mất
  message đang chờ), tên biến/hàm trong code (`BackendKey`, `backend.go`, `callBackend`) và chữ "the backend" trong comment.
