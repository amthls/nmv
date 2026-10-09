# chore/branch-workflow

- **Mục tiêu:** Quy trình nhánh/PR/plan rõ ràng và tự động: mỗi việc một nhánh mới từ `main`, mỗi nhánh có file thông tin, kế hoạch nằm trong `Plan/`.
- **Tạo từ:** `origin/main` @ 5e4dd41, ngày 2026-10-09
- **Trạng thái:** đã gộp vào `chore/bundle-pending-work` (PR cũ đóng)
- **PR:** https://github.com/amthls/nmv/pull/35
- **Plan:** `Plan/branch-workflow.md`

## Thay đổi
- `CLAUDE.md`: quy trình git, file thông tin nhánh, quy tắc Plan, lệnh hay dùng, bẫy đã biết. Claude Code tự đọc file này mỗi phiên.
- `scripts/new-branch.sh <loại>/<tên> "mục tiêu"`: kiểm tra tên, fetch, tạo nhánh từ `origin/main` (không track `main`), tạo `Branches/<tên-nhánh>.md` từ mẫu.
- CI job `branch-info`: PR (trừ Dependabot) thiếu `Branches/<tên-nhánh>.md` thì báo đỏ.
- `.gitattributes`: file `*.sh` luôn LF.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- Script: tên sai định dạng bị từ chối, tên nhánh đã có bị từ chối, tên đúng tạo nhánh + file (dùng thật để tạo `security/hardening`).
- `ci.yml` parse được bằng PyYAML.

## Ghi chú cho người review
- Nên bật branch protection cho `main` trên GitHub (Settings → Branches): bắt buộc qua PR và CI xanh, để quy trình không bị bỏ qua.
