# chore/remove-github-actions

- **Mục tiêu:** Gỡ GitHub Actions (CI/CD tốn tiền), kiểm tra trên máy trước khi merge
- **Tạo từ:** `origin/main` @ 5f94e69, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** không có

## Thay đổi
- Xóa `.github/workflows/ci.yml`, `deploy.yml`, `dependabot-automerge.yml`. Lý do: tài khoản GitHub bị chặn chạy Actions
  ("recent account payments have failed or your spending limit needs to be increased"), mọi job đỏ ngay; chủ dự án quyết định gỡ hẳn.
- `.github/dependabot.yml`: giữ (miễn phí), bỏ mục `github-actions` (không còn workflow), sửa chú thích.
- `CLAUDE.md`, `README.md`, chú thích `docker-compose.yml`: bỏ nhắc CI/CD/GHCR; quy tắc mới: tự chạy typecheck + test phần đã sửa trên máy rồi mới merge; deploy thủ công.

## Migration / biến môi trường mới
- Không có. Biến `IMAGE_REGISTRY` / `IMAGE_TAG` vẫn giữ (mặc định `local` / `latest`).

## Đã kiểm tra
- Không còn tham chiếu `.github/workflows` / GHCR ngoài `Plan/` và `Branches/` (lịch sử).

## Ghi chú cho người review
- Không đụng code chạy.
