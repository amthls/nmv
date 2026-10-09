# Kế hoạch: Tự động hoá quy trình nhánh / PR / plan

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Bắt đầu: 2026-10-09. Nhánh: `chore/branch-workflow` (tạo từ `origin/main` @ 5e4dd41).

## Vì sao
PR #13 đã merge nhưng commit bảo mật `2f8a3af` lại được push tiếp vào nhánh cũ `feat/scale-phase1`, nên không vào `main`.
Cần quy tắc rõ ràng, có công cụ và có CI nhắc để không lặp lại.

## Checklist
- [x] `CLAUDE.md`: quy trình git (mỗi việc một nhánh mới từ `origin/main`, không đẩy tiếp vào nhánh đã merge), file thông tin nhánh, quy tắc Plan, lệnh build/test/migrate, bẫy đã biết
- [x] `scripts/new-branch.sh <loại>/<tên> "mục tiêu"`: fetch, tạo nhánh từ `origin/main` (không track main), tạo `Branches/<tên-nhánh>.md` từ mẫu
- [x] CI job `branch-info` (chỉ PR, bỏ qua Dependabot): PR thiếu `Branches/<tên-nhánh>.md` thì đỏ
- [x] `Branches/chore-branch-workflow.md` cho chính nhánh này
- [x] Thử script trên máy (tên sai bị từ chối, tên đúng tạo nhánh + file), YAML hợp lệ
- [x] Commit, push, mở PR
- [x] Đưa commit bảo mật `2f8a3af` sang nhánh mới `security/hardening` (dùng script), thêm file Branches, push, mở PR
