# Giai đoạn F: service community (TS)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Thiết kế chung: `Plan/microservices.md` (bảng service, "Gỡ, xóa, khôi phục", quy tắc chung). Một nhánh `feat/community-service`, một PR.

## Hiện trạng (2026-10-11)
Backend giữ bài Fandom (`post.controller.ts` 480 dòng), bình luận truyện/chương/bài (`comment.controller.ts`), báo cáo (`report.controller.ts`),
trang "Đã gỡ" (`moderation.controller.ts`), mã P-/RP- (`code.controller.ts`). Bảng: `posts`, `post_tags`, `post_reactions`,
`post_notification_mutes`, `comments`, `comment_likes`, `reports`. Trigger `trg_comment_counts` cộng `chapters.total_comments`,
`stories.total_comments`, `posts.comment_count`, `comments.reply_count` khi thêm bình luận.

## Thiết kế
- `services/community` (TS, Express, cùng khuôn `services/media`: config, auth header ký, log JSON, migration nhúng), `community_db`.
  Gateway `/api/community/*` (bỏ tiền tố, `auth_request` như mọi API; header ký `USER_SIG_KEY_COMMUNITY`). **JSON giữ nguyên**,
  frontend chỉ đổi gốc: `/api/v1/posts|comments|reports|moderation/removed` → `/api/community/...`.
- **Bảng chuyển sang** (giữ UUID, `code_no`/`code`): posts, post_tags, post_reactions, post_notification_mutes, comments, comment_likes, reports.
- **Người dùng** (tên, ảnh, vai trò, khóa/xóa): hỏi backend `POST /internal/users/profiles` (cache 60 s) như messaging; vai trò cần thêm vào
  API đó. shortcut: API thay bản sao `ext_` (backend chưa phát sự kiện hồ sơ).
- **Truyện/chương** (tiêu đề, slug, bìa, mã, đã gỡ?): backend `POST /internal/stories/brief {story_ids, chapter_ids}` (cache 60 s).
  Gắn truyện vào bài: kiểm tra qua API đó. Sidebar "truyện nhiều thảo luận": đếm ở community, tên truyện hỏi backend.
- **Số bình luận của truyện/chương** (`stories.total_comments`, `chapters.total_comments` ở backend): community gửi
  `POST /internal/comment-counts {chapter_ids, story_ids}` kèm số đếm lại sau mỗi lần thêm/xóa (đếm lại = hội tụ, gửi trùng không sai).
  shortcut: gọi API thay sự kiện outbox; đối soát đêm của backend đếm lại từ community khi cần.
- **Thông báo:** community tự dựng NotifyItem (chép `commentNotifications`, `postReactionNotification`, `postReviewNotifications`) và đẩy
  vào `novel.notifications` (amqplib, fallback HTTP sang messaging như backend); `link` tính tại chỗ (`/fandom/<slug>`, truyện/chương
  qua API brief); tắt theo bài lọc tại chỗ (bảng mute ở community). Backend bỏ phần mute khỏi `queue.service`.
- **Báo cáo:** lưu ảnh chụp đối tượng lúc báo cáo (`target_preview`, `target_code`, `target_path`) để danh sách tìm theo mã/tên không cần
  truy vấn chéo; trạng thái "đã gỡ" của truyện/chương hỏi backend khi liệt kê (batch).
- **Đã gỡ:** truyện đã gỡ vẫn ở backend → `/api/community/moderation/removed` lấy bài đã gỡ của mình + truyện đã gỡ từ backend
  `GET /internal/stories/removed?q=&limit=` rồi gộp, sắp theo `removed_at`. shortcut: gộp ở community thay vì bản sao từ `story.removed`.
- **Xóa tài khoản** (`identity.user.deleted` có `purge_content`): community nghe sự kiện (hàng `community.identity`), ẩn bài + bình luận
  như `purgeUserContent` hiện nay; backend bỏ phần posts/comments của hàm đó.
- **Xóa truyện** (story.controller xóa bình luận chương/truyện): backend gọi `POST /internal/comments/purge {story_id, chapter_ids}`.
- **Hồ sơ người dùng** (số bài, số bình luận, lượt thích nhận): backend hỏi community `GET /internal/users/:id/stats`.
- **Mã P-/RP-**: `/codes/:code` của backend chuyển tiếp mã P/RP sang community `GET /internal/codes/:code`.
- **Chuyển dữ liệu:** `community import-legacy` (node `dist/importLegacy.js`) chép bảng cũ bằng `LEGACY_DATABASE_URL`, một lần mỗi phần
  (`legacy_imports`, bẫy E3). Bảng cũ xóa ở nhánh dọn dẹp sau.

## Việc
- [x] Backend: API nội bộ `stories/brief`, `stories/removed`, `comment-counts`, `users/profiles` thêm vai trò; chuyển tiếp mã P/RP;
      hồ sơ hỏi stats; xóa truyện gọi purge; bỏ controller + route posts/comments/reports/removed, bỏ mute trong queue.service
- [x] services/community: khung (config, auth, log, health/ready, migration), posts + reactions + pin + mute, comments + like, reports,
      removed, thông báo qua hàng đợi, consumer identity, import-legacy, test
- [x] Compose (`community_db`, khóa), gateway `/api/community/*`, launch.py/migrate.sh, CI job, frontend đổi gốc
- [x] Thử: chuyển dữ liệu (đếm khớp), smoke Fandom/bình luận/báo cáo/đã gỡ qua gateway + trình duyệt; README, Branches; PR, tự merge
  - Thử 2026-10-11: chuyển 18/18 bài, 35/35 bình luận, 11/11 cảm xúc, 1/1 báo cáo, mã `P-` giống hệt bản cũ, số mã mới tiếp tục từ 20;
    `scripts/community-smoke.py` qua gateway: All checks passed (đăng bài, cảm xúc, bình luận + trả lời + thích, bộ đếm, thông báo tới chuông,
    tắt thông báo bài, bình luận chương → `total_comments` của truyện ở backend tăng/giảm, báo cáo + trùng 409 + Admin tìm/xử lý, mã `RP-`/`P-`,
    gỡ/khôi phục + Đã gỡ, hồ sơ đếm bài/bình luận); trình duyệt: Fandom, bài viết + bình luận, Đã gỡ.
  - Bẫy: số đếm gửi về backend phải tính **sau** khi transaction commit (đếm trong transaction đang mở thì backend nhận số cũ).
