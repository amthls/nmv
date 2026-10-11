# feat/community-service

- **Mục tiêu:** Giai đoạn F: bài Fandom, bình luận, cảm xúc, báo cáo, nội dung đã gỡ chuyển sang service community
- **Tạo từ:** `origin/main` @ 47ff8df, ngày 2026-10-11
- **Trạng thái:** xong, chờ CI
- **PR:** https://github.com/amthls/nmv/pull/73
- **Plan:** `Plan/community.md`, `Plan/microservices.md` (giai đoạn F)

## Thay đổi
- `services/community` (TS, Express): `community_db` (migration `001_init.sql`: posts, post_reactions, post_notification_mutes, comments,
  comment_likes, reports + ảnh chụp đối tượng báo cáo, mã thông minh P-/RP-), API `/posts`, `/comments`, `/reports`, `/moderation/removed`
  giữ nguyên JSON; người dùng + truyện/chương hỏi backend (cache 60 s); thông báo đẩy vào `novel.notifications`; consumer
  `identity.user.deleted`; API nội bộ cho backend (mã, số liệu hồ sơ, xóa bình luận của truyện bị xóa); `import-legacy` một lần; test.
- Backend: bỏ `post/comment/report/moderation.controller` + route; API nội bộ `stories/brief`, `stories/removed`, `comment-counts`,
  `users/profiles` thêm vai trò; mã P-/RP- và số liệu hồ sơ hỏi community; xóa truyện gọi community; bỏ lọc tắt-theo-bài + thông báo
  bài/bình luận khỏi `queue.service`/`notification.service`.
- identity ký thêm `X-User-Sig-Community`; gateway `/api/community/*`; compose (`community`, `community_db`, khóa); launch.py,
  `scripts/migrate.sh` chạy import; CI (typecheck + test community, quét image), deploy build/pull community.
- Frontend: Fandom, bình luận, báo cáo, Đã gỡ gọi `/api/community` (`COMMUNITY_URL`).
- `scripts/community-smoke.py`: thử trọn luồng qua gateway.

## Migration / biến môi trường mới
- Mới: `COMMUNITY_DB_PASSWORD`, `USER_SIG_KEY_COMMUNITY`, `INTERNAL_KEY_COMMUNITY` (launch.py tự thêm), `COMMUNITY_MEMORY` (256m).
- `community_db` do `db-init` tạo; migration nhúng chạy khi community khởi động.
- Bảng cũ (posts, comments, reports…) ở `novel_platform` **chưa xóa** (nhánh dọn dẹp sau).

## Đã kiểm tra
- `tsc` + `yarn test` community (chữ ký header, khóa nội bộ, ai nhận thông báo bình luận), `tsc` + `npm test` backend, `tsc` frontend,
  `go vet`/`go test` identity (cả test tích hợp với Postgres).
- Chuyển dữ liệu thật: 18/18 bài (mã giống hệt), 35/35 bình luận, 11/11 cảm xúc, 1/1 báo cáo.
- `python scripts/community-smoke.py --admin admin --writer reader_hana --reader reader_yuki`: All checks passed.
- `python scripts/workspace-smoke.py` vẫn qua (thông báo đề xuất/giao việc, thẻ nháp).
- Trình duyệt (admin): `/fandom`, bài viết có bình luận + trả lời, `/da-go`.

## Ghi chú cho người review
- shortcut: hồ sơ người dùng, truyện/chương, truyện đã gỡ hỏi API backend thay vì bản sao `ext_` theo sự kiện; số bình luận gửi về
  backend bằng API thay vì sự kiện outbox (đếm lại nên hội tụ). Đổi khi backend thành catalog (giai đoạn I).
- Tìm trong "Đã gỡ" theo người đăng bài: chỉ khớp đúng username (trước đây khớp một phần).
