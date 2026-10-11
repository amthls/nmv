# Giai đoạn I: catalog (phần còn lại của backend cũ)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Mục tổng ở `Plan/microservices.md` (giai đoạn I).

## Quyết định của chủ dự án (2026-10-11)
- Đổi tên service `backend` → `catalog` (service, container, thư mục, biến), giữ alias mạng `backend` cho lời gọi cũ.
- **Giữ tên database `novel_platform`** (không đổi tên DB).
- Xóa các bảng cũ đã chuyển sang service khác bằng migration, chạy luôn trên DB local (`migrate.sh` tự backup trước).

## I1: `chore/drop-legacy-tables`
Bảng đã chuyển (import-legacy một lần, đã chạy trên DB local):
- messaging: `direct_messages, group_messages, user_blocks, dm_labels, dm_label_conversations, notifications, broadcast_notifications`
- community: `posts, post_tags, post_reactions, post_notification_mutes, comments, comment_likes, reports`
- library: `user_favorites, bookmarks, reading_history, albums, album_stories, album_saves, user_follows`
- recommender: `rec_events, rec_item_factors, rec_item_similar, rec_model_runs, rec_user_factors, rec_user_scores`
- media: `story_exports` (migration 007; media có bảng riêng trong `media_db`)

Giữ lại: `user_settings` (backend còn đọc/ghi cài đặt đọc), `chapter_submissions` (backend còn dùng), `processed_events`.

Bẫy:
- `migrate.sh` chạy migration **trước** import-legacy: máy nào nhảy thẳng từ bản trước #69 lên bản này sẽ xóa dữ liệu
  chưa chép. Ghi ở README: nâng cấp qua bản #77 trước (backup pre-migrate vẫn giữ dữ liệu).
- Bản cài mới không còn bài Fandom/bình luận/thông báo/theo dõi mẫu (seed nằm ở các bảng bị xóa).
- import-legacy phải chịu được bảng cũ không còn (messaging, community, library đã kiểm tra `to_regclass`; recommender thêm ở nhánh này).
- `launch.py` chạy `seed-fandom.ts` khi cài mới (ghi `posts`): bỏ khỏi danh sách seeder, xóa script.

- [x] Migration `027_drop_legacy_tables.sql`, chép vào cuối `sql/database.sql` (như 026: tạo rồi xóa, giữ nguyên phần trên)
- [x] Prisma schema bỏ model/enum của các bảng đã xóa; script dev cũ ghi vào bảng đã xóa: xóa hoặc sửa
- [x] recommender import-legacy bỏ qua khi không còn `rec_events`
- [x] Thử trên DB nháp: bản sao `novel_platform` + 027 (chạy lại không lỗi), cài mới từ `database.sql` → 19 bảng; tsc, py_compile
- [x] Chạy `migrate.sh` trên DB local (chủ dự án cho phép, 2026-10-11): 20 bảng; smoke workspace, community, library OK; log không lỗi bảng thiếu
- [x] README (bảng, hạn chế, nâng cấp), Branches, PR #78, merge

## I2: đổi tên backend → catalog
- [x] Thư mục, service/container compose, biến môi trường, CI, gateway, scripts, launch.py, README; alias `backend`
  Bẫy: script đổi `./backend` cũng đổi nhầm `import './backend'` trong community (file `backend.ts`); gateway không bị tạo lại → `nginx -s reload`.
  Giữ tên hàng đợi `backend.*`, tên biến/hàm trong code và chữ "backend" trong comment.

## I3: quy trình nhóm + kệ "Đang hot"
- [x] Cài đặt quy trình nhóm (bước bật, ai được gộp) + API quyền trả về cho workspace
  Bước bật đã có từ 025. Thêm `translation_groups.mergers` (028, mặc định `{mod}`): chủ truyện + Trưởng nhóm luôn gộp;
  chỉ Trưởng nhóm đổi `mergers` (Mod không tự cấp quyền cho người khác). `storyRole` → keeper/keeperIds → `/internal/permissions`.
- [x] Kệ "Đang hot" tính sẵn vào Redis: worker ghi `cache:/api/v1/stories/trending` (cùng khóa với `cacheJson`) 2 phút/lần, TTL 6 phút;
  worker tắt thì API vẫn tự tính khi hụt. Giữ nguyên cách xếp (lượt xem tổng).

## I4: đo tải + README kiến trúc
- [ ] Đo lại bằng `scripts/bench.mjs`, so với mốc giai đoạn A; README viết lại phần kiến trúc
