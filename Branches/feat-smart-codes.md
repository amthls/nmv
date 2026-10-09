# feat/smart-codes

- **Mục tiêu:** Mã định danh thông minh; trang truyện gọn lại; bỏ hẳn chức năng đánh giá truyện
- **Tạo từ:** `origin/main` @ 6f9d881, ngày 2026-10-09
- **Trạng thái:** xong, chủ dự án đã duyệt giao diện, chờ review PR
- **PR:** https://github.com/amthls/nmv/pull/48
- **Plan:** `Plan/smart-codes.md`, `Plan/remove-ratings.md`

## Thay đổi
- Migration `017_smart_codes.sql`: cột `code_no` + `code` cho `users`, `translation_groups`, `stories`, `posts`, `albums`, `reports`; trigger tự cấp/cập nhật mã; backfill dữ liệu cũ theo thứ tự tạo (giữ nguyên `updated_at`). UUID vẫn là khóa chính.
- API trả `code` ở chi tiết truyện, chương (ghép), hồ sơ, nhóm, bài viết, album, danh sách báo cáo.
- `GET /codes/:code` → `{ type, path }`, tra theo số cố định, tôn trọng quyền xem.
- Frontend: `CodeBadge` (bấm để chép, rê chuột xem giải nghĩa) trên 7 trang: mã người dùng ai cũng thấy, mã khác chỉ Admin/Mod; trang `/ma/[code]`.
- Trang truyện: giữ giao diện cũ, chỉ bỏ phần đánh giá (thống kê còn lượt xem, người theo dõi, chương) và chip "Chủ thầu / Quản lý"; tag thể loại chuyển xuống đầu khung Tóm tắt (trước nội dung), hàng Quản lý thành thanh riêng dưới banner (banner mọi truyện cùng khung); mã truyện nằm trong thanh Quản lý.
- **Bỏ hẳn đánh giá truyện**: migration `018_drop_ratings.sql` xóa bảng `story_ratings`, cột `stories.rating_avg/rating_count`, trigger; bỏ `POST /stories/:slug/rate`, sort `rating`, sao trên thẻ truyện, ô Đánh giá ở trang tài khoản (thay bằng Người theo dõi), tín hiệu đánh giá của recommender, crawler, Prisma schema.
- Test `parseCode` (`backend/src/controllers/code.controller.test.ts`).

## Migration / biến môi trường mới
- `sql/migrations/017_smart_codes.sql` (đã chép vào `sql/database.sql`).
- `sql/migrations/018_drop_ratings.sql` (**xóa dữ liệu đánh giá vĩnh viễn**; `database.sql` đã bỏ phần đánh giá).
- `011_rating_avg_scale.sql` sửa lại: tự bỏ qua khi cột `rating_avg` không còn (`launch.py` chạy lại mọi migration mỗi lần khởi động).
- Sau migrate trên server: xóa khóa `cache:*` trong Redis (không FLUSHDB).

## Đã kiểm tra
- Chạy migration 2 lần liền trong transaction (idempotent), rồi chạy thật; cài mới từ `database.sql` trên DB tạm.
- Trigger: user mới `U-RD`, cấp dịch giả → `U-TR`, thu lại → `U-RD`; đổi nhóm truyện → `G03`; xóa nhóm → `G00`; `updated_at` không đổi khi backfill.
- `yarn test` 10/10; typecheck 2 bên; build.
- `/codes/:code` cho đủ 7 loại, chữ thường, mã có vai trò cũ; album riêng tư và báo cáo trả 404 với khách, báo cáo mở được với admin.
- Đánh giá: migration 018 chạy thật (591 lượt đánh giá local bị xóa), `sort=rating` không lỗi (về mặc định), `/rate` 404, train recommender chạy được, `/profile/me` không còn `ratings_count`, trang khám phá không còn sao.
- Trình duyệt: hồ sơ hiện mã người dùng với tài khoản thường; huy hiệu trên trang truyện và hồ sơ, `/ma/LN-JA-G01-0001` chuyển đúng trang, `/ma/<mã sai>` báo không tìm thấy kèm giải nghĩa.

- `python launch.py --no-crawl`: All checks passed (sau khi sửa 011). Cài mới: `database.sql` + chạy lại cả 18 migration trên DB tạm đều qua.

## Ghi chú cho người review
- Số thứ tự cho biết tổng số tài khoản/truyện xấp xỉ.
- Mã người dùng/truyện đổi khi vai trò/nhóm đổi; link `/ma/...` cũ vẫn chạy vì chỉ dựa vào số.
