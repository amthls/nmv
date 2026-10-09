# chore/bundle-pending-work

- **Mục tiêu:** Gom mọi thay đổi chưa lên `main` thành một PR duy nhất.
- **Tạo từ:** `origin/main` @ 5e4dd41, ngày 2026-10-09
- **Trạng thái:** chờ review
- **PR:** (điền sau khi mở)
- **Plan:** `Plan/branch-workflow.md`, `Plan/security-hardening.md`

## Gồm những gì (merge nguyên nhánh, giữ lịch sử commit)
| Nhánh | PR cũ | Nội dung | Chi tiết |
|---|---|---|---|
| `chore/branch-workflow` | #35 | `CLAUDE.md`, `scripts/new-branch.sh`, CI job `branch-info` | `Branches/chore-branch-workflow.md` |
| `security/hardening` | #36 | Mật khẩu bắt buộc, thu hồi token, đổi/quên mật khẩu, xác thực email, HTTPS-ready, container không root, CSP | `Branches/security-hardening.md` |
| `chore/dependabot-automerge` | #37 | Gom PR Dependabot, tự merge bản vá/nhỏ khi CI xanh (miễn phí), CI push chỉ chạy trên `main` | `Branches/chore-dependabot-automerge.md` |

## Đã rà soát và không cần gom
- `feat/scale-phase1`: 2 commit đầu đã vào `main` qua PR #13 (cây thư mục giống hệt); commit `2f8a3af` trùng nội dung với `security/hardening`.
- `fix/notification-checks`: không có commit riêng.
- Stash cũ trên `fix/windows-launch`: chỉ có `frontend/tsconfig.tsbuildinfo` (file sinh khi build).

## Migration / biến môi trường mới
- `sql/migrations/015_account_security.sql`
- Bắt buộc: `POSTGRES_PASSWORD`, `PGADMIN_DEFAULT_PASSWORD` (server deploy phải thêm vào `.env` trước). Tùy chọn: `SMTP_URL`, `MAIL_FROM`, `SITE_URL`, `COOKIE_SECURE`, `CLOUDFLARE_TUNNEL_TOKEN`.

## Đã kiểm tra
- 3 nhánh merge không xung đột; `ci.yml` có đủ cả 3 phần sửa (job `branch-info`, mật khẩu test, `push` chỉ `main`).
- Typecheck backend + frontend; 4 file YAML; `docker compose config` (kèm profile `tools`, `tunnel`).
- Code app giống hệt commit bảo mật đã thử end-to-end và CI xanh (`2f8a3af`).

## Ghi chú cho người review
- Merge PR này thì đóng được #35, #36, #37 (đã đóng kèm bình luận trỏ về đây).
- Sau khi merge: CLAUDE.md và `scripts/new-branch.sh` có trên `main`; workflow tự merge Dependabot bắt đầu chạy.
