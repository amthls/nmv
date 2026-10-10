# chore/land-identity-workspace

- **Mục tiêu:** Đưa phần còn lại của chuỗi PR #52–#55 (request-id + log, service identity, chuyển đăng nhập, workspace lịch sử chương) vào `main`
- **Tạo từ:** `origin/main` @ 9775eba, ngày 2026-10-10
- **Trạng thái:** mở PR
- **PR:** (chưa mở)
- **Plan:** `Plan/identity.md`, `Plan/chapter-workspace.md`, `Plan/microservices.md`

## Vì sao có nhánh này
Chuỗi PR xếp chồng được merge từ dưới lên: #51 vào `main` (squash), còn #52 → #55 merge vào nhánh base của chúng
(`chore/backup`, `chore/request-id-logs`, `feat/identity-service`, `feat/identity-cutover`), nên `main` chưa có chúng.
Toàn bộ nằm ở `feat/identity-cutover` @ aaf1f07. Nhánh này = `main` + merge nhánh đó; cây file **giống hệt**
`feat/identity-cutover` (nội dung squash #51 trên `main` đã có sẵn trong đó, đã kiểm `git diff` rỗng).

## Thay đổi
- Không có code mới. Xem các PR #52, #53, #54, #55 và `Branches/` của từng nhánh.

## Đã kiểm tra
- `git diff origin/feat/identity-cutover` rỗng; typecheck backend + frontend và test backend đã qua trên `feat/identity-cutover` / `feat/workspace-history` trước khi merge chuỗi.
