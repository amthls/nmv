# feat/ws-tasks

- **Mục tiêu:** Workspace giai đoạn 4b: việc, quy trình theo vai trò, WS nhóm
- **Tạo từ:** `origin/main` sau #60, ngày 2026-10-10
- **Trạng thái:** xong, đã thử local; tự merge
- **PR:** (điền khi mở)
- **Plan:** `Plan/chapter-workspace.md` (4b)

## Thay đổi
- Backend: migration `025_group_workflow.sql` (`translation_groups.workflow`), `PUT /groups/:id/workflow`; `storyRole` có `role`, `workflow`;
  `/internal/permissions` trả thêm; worker nhận `workspace.task.opened` → thông báo (`ws_story` → `/ws/truyen/:slug`).
- Workspace: migration `005_tasks.sql` (`chapter_tasks`, `ws_activity`); `tasks.go` (giao, nhận, trả, giao lại/hạn, bắt đầu trên nháp, xong
  bước → bước sau / tự gửi đề xuất, hủy, việc của tôi, bảng việc nhiều truyện); gộp/trả lại cập nhật chuỗi việc; cảnh báo trùng chương
  (`others`, `claims`); nhật ký hoạt động; sự kiện + schema `events/workspace.task.opened.v1.json`. Tách `insertDraft`, `submitRound`.
- Frontend: `/ws/nhom/[slug]`; việc ở `/ws` và `/ws/truyen/[slug]` (`TaskCard`, `AssignForm`); quy trình + nút Workspace nhóm ở trang nhóm;
  cảnh báo trùng trong trình soạn thảo; thông báo việc mở trang workspace truyện.

## Migration / biến môi trường mới
- `sql/migrations/025_group_workflow.sql`; workspace tự chạy `005_tasks.sql`.

## Đã kiểm tra
- Go test tích hợp `TestTasks` (vai trò, trùng chương, bước sau dùng chung nháp, cảnh báo, tự đề xuất, trả lại mở lại bước, gộp, bảng, schema).
- Typecheck, test backend; `scripts/workspace-smoke.py` 78/78 (thêm 11 ca việc, có thông báo qua hàng đợi).
- Trình duyệt: mục Việc ở trang truyện, `/ws/nhom/neko-translation` (thành viên).
