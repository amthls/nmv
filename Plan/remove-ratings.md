# Kế hoạch: Bỏ hẳn chức năng đánh giá truyện

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Ghi ngày: 2026-10-09. Nhánh: `feat/smart-codes` (cùng PR với trang truyện mới, nơi nút Đánh giá đã bị bỏ). Dùng skill **ponytail**.
> Chủ dự án: "xoá hết đánh giá ở code, db đi tôi không cần nữa". DB local có 591 lượt đánh giá → mất vĩnh viễn (đã đồng ý).

## Bẫy
- `v_trending_stories` đọc `stories.rating_avg` → phải DROP VIEW trước khi bỏ cột, rồi tạo lại (sắp theo lượt xem tuần, rồi tổng lượt xem).
- Prisma chỉ dùng để `prisma generate` trong CI: schema phải bỏ model `StoryRating` và quan hệ, nếu không generate vẫn chạy nhưng lệch DB.
- `scripts/crawler.py` ghi `rating_avg` khi nhập truyện → bỏ cột khỏi câu INSERT (giữ `contentRating[]` của MangaDex: đó là lọc nội dung, không phải đánh giá).
- Recommender (`train.ts`) dùng điểm đánh giá làm tín hiệu → bỏ tín hiệu đó, các tín hiệu khác giữ nguyên.
- Cache API Redis còn JSON cũ có `rating_avg` → xóa khóa `cache:*` (không FLUSHDB).

## Việc
- [x] Migration `sql/migrations/018_drop_ratings.sql`: bỏ trigger/hàm `update_story_rating`, bảng `story_ratings`, cột `stories.rating_avg`, `rating_count` (+ index), dựng lại `v_trending_stories`
- [x] `sql/database.sql`: bỏ các phần trên khỏi schema cài mới; `backend/prisma/schema.prisma` khớp
- [x] Backend: bỏ `POST /stories/:slug/rate` + `rateStory`, sort `rating`, cột rating trong các SELECT, xóa rating khi xóa truyện, `ratings_count` trong thống kê tài khoản, recommender, `simulateReaders`
- [x] Frontend: sao trên thẻ truyện (grid, list, vòng quay ngẫu nhiên), lựa chọn sắp xếp "Đánh giá cao nhất", ô "Đánh giá" ở trang tài khoản, kiểu `rating_avg`/`rating_count`, `CardMeta 'rating'`
- [x] `scripts/crawler.py`
- [x] Mã người dùng ai cũng thấy (huy hiệu mã trên trang hồ sơ hiện cho mọi người; mã khác vẫn chỉ Admin/Mod)
- [x] README (bảng DB, API, sort, trang tài khoản, trang truyện)
- [x] Typecheck, test, build, chạy migration, thử: trang truyện, khám phá (mọi kiểu sắp xếp), tài khoản, gợi ý trang chủ, hồ sơ khi chưa đăng nhập thấy mã
- [x] Chủ dự án duyệt giao diện → commit, push, mở PR (không tự merge)
