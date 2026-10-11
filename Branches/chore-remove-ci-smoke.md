# chore/remove-ci-smoke

- **Mục tiêu:** Bỏ job smoke (build cả stack Docker + Trivy, ~11 phút) khỏi CI theo yêu cầu chủ dự án
- **Tạo từ:** `origin/main` @ b5d5c3d, ngày 2026-10-11
- **Trạng thái:** xong
- **PR:** https://github.com/amthls/nmv/pull/84
- **Plan:** không có (việc một bước)

## Thay đổi
- `.github/workflows/ci.yml`: xóa job `smoke` (dọn đĩa, `docker compose build`, 9 bước Trivy, khởi động stack, migrate, kiểm tra trang).
  Còn: branch-info, typecheck (+ test catalog), identity, workspace, messaging, library, recommender (~1–1,5 phút).
- Xóa `.trivyignore` (không còn ai đọc). README (mục CI/CD, workspace), CLAUDE.md (kiểm tra trên máy trước khi push).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- YAML hợp lệ; job còn lại không phụ thuộc `smoke`.

## Ghi chú cho người review
- Mất hai lưới an toàn của CI: build image thật + quét lỗ hổng CRITICAL bằng Trivy. Script smoke chạy tay vẫn còn (`scripts/*-smoke.py`).
