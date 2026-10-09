# chore/dependabot-automerge

- **Mục tiêu:** Tự merge PR Dependabot bản vá/nhỏ khi CI xanh, hoàn toàn miễn phí; gom PR cho đỡ loạn; bản lớn để người duyệt.
- **Tạo từ:** `origin/main` @ 5e4dd41, ngày 2026-10-09
- **Trạng thái:** chờ review
- **PR:** https://github.com/amthls/nmv/pull/37
- **Plan:** không cần (việc nhỏ)

## Thay đổi
- `.github/dependabot.yml`: mỗi thư mục/hệ sinh thái chỉ còn **1 PR gom bản vá + bản nhỏ** mỗi tuần (`minor-and-patch`), **bỏ qua bản lớn** (major).
- `.github/workflows/dependabot-automerge.yml`: khi CI của PR Dependabot xanh → squash merge + xóa nhánh. Chỉ merge nhóm `minor-and-patch` hoặc PR lẻ có số major không đổi; bản lớn/không rõ thì để lại. `--match-head-commit` để không merge nếu PR đổi sau lần CI đó.
- `.github/workflows/ci.yml`: `push` chỉ chạy trên `main` (nhánh khác đã có CI qua PR), giảm một nửa số phút Actions.

## Vì sao không dùng auto-merge có sẵn của GitHub
Repo private gói Free không có auto-merge và branch protection (API trả 403). Workflow này chỉ dùng phút Actions miễn phí (2.000 phút/tháng); hết phút thì GitHub dừng chạy chứ không tính tiền (mức chi tiêu mặc định 0đ).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- 3 file YAML parse được.
- Bộ lọc tiêu đề: `pg 8.23.0 → 8.23.1` merge, nhóm `minor-and-patch` merge, `lucide-react 0.460 → 0.469` merge; `node 22-slim → 25-slim`, `actions/checkout 4 → 7` để lại.
- Workflow `workflow_run` chỉ chạy từ nhánh mặc định: **chỉ có hiệu lực sau khi PR này merge vào `main`**.

## Ghi chú cho người review
- Merge bằng `GITHUB_TOKEN` không kích hoạt workflow khác, nên sau mỗi lần tự merge, CI/Deploy trên `main` không chạy lại; lần merge tay tiếp theo sẽ build/deploy gộp luôn.
- 21 PR Dependabot đang mở (tạo theo cấu hình cũ) không tự đóng. Bản lớn nên đóng kèm bình luận `@dependabot ignore this major version`; bản nhỏ sẽ được thay bằng PR gom ở lượt chạy tới.
