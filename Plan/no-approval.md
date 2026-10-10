# Bỏ khâu duyệt, admin/mod chỉ xoá/gỡ nội dung vi phạm

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.

Nhánh `feat/no-approval`. Chủ dự án chốt (2026-10-09):
- Truyện, chương, blog Fandom, nhóm dịch: đăng là hiện ngay, không ai duyệt (kể cả leader/mod nhóm).
- Admin/mod **không còn sửa** truyện/chương/blog của người khác; chỉ **xoá** truyện, chương, blog và **gỡ** (ẩn) blog.
- Bỏ luôn duyệt tạo nhóm dịch. Duyệt người xin vào nhóm (join request) giữ nguyên.

## Backend
- [x] `story.controller`: `canUserManageStory` bỏ admin/mod; bỏ `canUserReviewGroupStory`, `storyApprovalFor`,
      `notifyGroupStoryPending`, `getGroupPendingStories`, `approveStory/rejectStory`, `can_review`;
      `getManageableStories` bỏ admin/mod; `updateStory` bỏ đổi chủ truyện + duyệt lại, đổi nhóm thì cấp danh hiệu;
      `checkStoryReferences` admin/mod cũng phải là thành viên nhóm
- [x] `chapter.controller`: `createStory` luôn approved; `submitChapter` luôn xuất bản (trừ nháp), chặn 409 nếu số chương đã có;
      `canUserModifyChapter` bỏ admin/mod (sửa), `deleteChapter` vẫn cho admin/mod;
      bỏ `getChapterSubmissions`, `approveChapterSubmission`, `rejectChapterSubmission`
- [x] `post.controller`: chỉ tác giả sửa bài; bài bị gỡ sửa xong vẫn bị gỡ; bỏ feed `pending`, đếm `pending`, bulk;
      `approve` giữ làm "khôi phục" bài bị gỡ
- [x] `group.controller`: tạo nhóm là approved; bỏ `approveGroup/rejectGroup`, feed `pending`, chặn xem nhóm pending
- [x] `api.routes.ts`: bỏ các route đã xoá
- [x] Migration `019_no_approval.sql` + chép vào `sql/database.sql`: truyện pending/rejected, nhóm pending → approved;
      bài pending → approved + published; bản dịch chương pending → draft (giữ nội dung)
- [x] Typecheck backend

## Frontend
- [x] `truyen/[slug]`: bỏ banner chờ duyệt + nút duyệt; admin/mod chỉ thấy nút xoá truyện/chương
- [x] `truyen/[slug]/[chapterSlug]`: admin/mod chỉ xoá, không sửa
- [x] `nhom-dich/[slug]`: bỏ khối truyện chờ duyệt, tab "Duyệt bản dịch chương"
- [x] `nhom-dich`: bỏ tab chờ duyệt, nút duyệt/từ chối nhóm
- [x] `fandom`, `fandom/[slug]`, `PostCard`: bỏ hàng chờ duyệt + bulk; "từ chối" → "gỡ", "duyệt" → "khôi phục"; admin/mod không sửa bài người khác
- [x] `StoryForm`, `dang-truyen-tranh`, `dang-chuong`, `tai-khoan`: bỏ nhánh/nhãn "chờ duyệt"
- [x] Typecheck frontend

## Kết thúc
- [x] README (phân quyền, API, hạn chế) + `Branches/feat-no-approval.md`
- [x] Build lại, chạy migration, thử trên trình duyệt
- [x] Chủ dự án duyệt giao diện → commit/push/PR

## Phần 2 (chủ dự án yêu cầu thêm, 2026-10-09)
Admin không còn quyền gì trong nhóm dịch. Admin/Mod chỉ **xoá mềm** (gỡ) truyện và bài viết; mọi thứ bị gỡ vào trang
riêng `/da-go` (chỉ Admin/Mod), tìm theo mã, tên, nội dung, khôi phục được. Admin/Mod không xoá chương nữa (gỡ cả truyện).
- [x] Migration `020_soft_remove.sql`: `stories`, `posts` thêm `removed_by`, `removed_at`
- [x] `group.controller`: bỏ quyền admin (actor chỉ theo vai trò trong nhóm)
- [x] Truyện: `POST /stories/:id/remove` (Admin/Mod, `reason`) → `approval_status = rejected`; `POST /stories/:id/restore`;
      `DELETE /stories/:id` chỉ người đăng; Admin/Mod xem được truyện đã gỡ
- [x] Bài viết: gỡ/khôi phục ghi `removed_by/removed_at`; `DELETE /posts/:id` chỉ tác giả
- [x] Chương: `deleteChapter` bỏ Admin/Mod
- [x] `GET /moderation/removed?type=&q=&page=` (Admin/Mod): truyện + bài đã gỡ, tìm theo mã/tên/nội dung
- [x] Frontend: trang `/da-go`, link trong menu tài khoản; trang truyện: nút "Gỡ truyện" + banner đã gỡ (khôi phục);
      bỏ xoá chương của Admin/Mod; bài viết: Admin/Mod chỉ "Gỡ"; trang nhóm bỏ quyền admin
- [x] Typecheck, build, migrate, thử API + trình duyệt; README, Branches

## Phần 3: báo cáo vi phạm (2026-10-09)
- [x] Sửa nút "Báo cáo" không dùng được ở banner truyện (modal `fixed` bị kẹt trong khung có backdrop-filter → portal)
- [x] Chống spam: unique index 1 báo cáo đang chờ/người/nội dung (bấm 2 lần), chờ 24h sau khi báo cáo cũ được xử lý,
      tối đa 30 báo cáo/24h/người (ngoài giới hạn 10/giờ có sẵn) — migration `021_report_spam.sql`
- [x] `GET /reports`: lọc loại (`type`), tìm (`q`: mã báo cáo, mã/tên nội dung, mô tả), trả mã nội dung, số báo cáo đang chờ
      cùng nội dung, trạng thái gỡ
- [x] `/bao-cao`: tab loại nội dung, ô tìm, hiện mã nội dung + số báo cáo cùng nội dung + "đã gỡ"
- [x] Typecheck, build, thử; README, Branches

## Bẫy
- Chương nộp trùng số chương đã có: trước đây chỉ leader ghi đè được (ON CONFLICT DO UPDATE), giờ ai cũng nộp được nên phải chặn 409.
- Modal `position: fixed` nằm trong khung có `backdrop-filter`/`transform` bị kẹt trong khung đó: dùng `createPortal(…, document.body)`.
- Bản nháp chương lưu trên server (`chapter_submissions` status draft) vốn chỉ thấy ở tab "Duyệt bản dịch"; bỏ tab thì không còn chỗ xem.
