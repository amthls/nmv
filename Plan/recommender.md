# Giai đoạn H: service recommender (Python)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Thiết kế chung: `Plan/microservices.md` (giai đoạn H). Một nhánh `feat/recommender-service`, một PR vào main.

## Hiện trạng (2026-10-11)
Recommender TS nằm trong backend (`backend/src/services/recommender/`: algorithms, train, serve, events; `recommendation.controller.ts`):
- Tín hiệu: `rec_events` của backend (xem truyện, mở chương cho cả khách qua cookie `nh_vid`, impression/click hàng gợi ý) +
  `GET /internal/reco/export` của library (lịch sử đọc, theo dõi, album, bookmark, dòng thời gian).
- Huấn luyện trong `worker` mỗi 30 phút (ALS, item-CF, co-visitation, nội dung TF-IDF, dò trọng số theo NDCG@10 leave-last-out),
  ghi `rec_item_similar`, `rec_user_scores`, `rec_user_factors`, `rec_item_factors`, `rec_model_runs`.
- API `/api/v1/recommendations/{home,related/:id,events,train,status}`; trang chủ, trang truyện, `RecommenderPanel` (admin).
- **Mốc TS** (run 138: 822 người, 100 truyện, 3.821 tương tác, 336 người dùng để đánh giá): trang chủ NDCG@10 0,322 / recall@10 0,595;
  truyện liên quan NDCG@10 0,192 / recall@10 0,396. Kết quả TS lưu ở scratchpad để so độ trùng.

## Thiết kế
- `services/recommender` (Python 3.12: FastAPI + uvicorn, psycopg 3, numpy, pika), `recommender_db`. Một container chạy API +
  luồng nhận sự kiện + luồng đồng bộ truyện + hẹn giờ huấn luyện. **Huấn luyện là tiến trình riêng** `python -m rec train`
  (chạy xong thoát, nhả RAM), khóa `pg_try_advisory_lock` trên Postgres (kết nối thẳng, không qua PgBouncer) để không chạy chồng.
- **Tín hiệu qua sự kiện** (bảng của recommender, không đọc DB người khác):
  - backend phát `catalog.story.viewed`, `catalog.chapter.read` (mọi lần mở trang truyện/chương, cả khách; gửi thẳng lên exchange,
    mất thì thôi: shortcut, không outbox vì là số liệu hành vi) → bảng `events` (≤ 1 lần đọc/chương/ngày/người).
  - library phát (outbox) `library.story.followed|unfollowed`, `library.album.story_added|removed`, `library.bookmark.created|deleted`
    → `favorites`, `album_stories`, `bookmarks` (giữ dòng đã bỏ + thời điểm: sự kiện đến sai thứ tự không làm sai trạng thái).
  - `identity.user.deleted` → xóa tín hiệu của người đó.
  - impression/click: frontend gửi thẳng `POST /api/rec/events`.
- **Bản sao truyện** `ext_stories` (thẻ truyện + thông tin cho mô hình nội dung): hỏi backend `GET /internal/library/stories` mỗi 30 s
  (cùng endpoint library dùng, thêm cột tóm tắt/nhóm/ngày), đối soát mỗi đêm.
- **Lịch sử đọc của người xem** (đọc tiếp, truyện đã đọc) vẫn hỏi library `GET /internal/reco/user/:id` lúc phục vụ.
- Chuyển dữ liệu một lần `python -m rec import-legacy`: `rec_events` của backend + `GET /internal/reco/export` của library.
- Bỏ khỏi mô hình: số giây đọc (library không phát; bù bằng số chương đã đọc). So mốc trước khi thay.
- API `/api/rec/*` (gateway bỏ tiền tố, `USER_SIG_KEY_RECOMMENDER`): `GET /home`, `GET /related/{id}`, `POST /events`,
  admin `POST /train`, `GET /status`. JSON giống `/api/v1/recommendations/*` cũ.
- Backend: xóa code recommender, route, lịch trong worker, `scripts/simulateReaders.ts` (đã không tới được recommender từ G1).
  Bảng `rec_*` cũ để nhánh dọn dẹp.

- [x] Sự kiện: schema `events/*.v1.json`; library outbox + phát (theo dõi, album, bookmark) + test; backend phát xem/đọc
- [x] recommender: khung (cấu hình, log, migration, health), đồng bộ truyện, nhận sự kiện, import-legacy
- [x] recommender: huấn luyện (port thuật toán TS sang numpy) + so với mốc TS (NDCG/recall, độ trùng top-10)
- [x] recommender: API FastAPI (home, related, events, train, status) + test
- [x] Nối dây: identity ký, gateway `/api/rec/*`, compose, launch.py, migrate.sh, CI, deploy, .env.example; frontend; xóa code TS
- [x] Thử trên máy: import, huấn luyện, trang chủ/trang truyện/admin qua trình duyệt, smoke; README, Branches; PR, tự merge

## Kết quả (2026-10-11)
- Import: 7.752 dòng `rec_events`, library 2.932 lượt đọc, 392 theo dõi, 767 truyện-album, 0 bookmark. Bản Python thấy đúng 822 người,
  100 truyện, 3.821 tương tác như run TS 138.
- So với TS (cùng dữ liệu, 336 người để đánh giá): trang chủ NDCG@10 0,321 / recall@10 0,604 (TS 0,322 / 0,595); liên quan 0,193 / 0,399
  (TS 0,192 / 0,396). Top-10 gợi ý cá nhân trùng 97% (cùng truyện đầu 93%); truyện liên quan trùng 75% (bộ dò trọng số chọn `cov` = 0 thay vì
  0,2, điểm gần như bằng). Huấn luyện ~7 s.
- Luồng sự kiện thử thật: khách mở truyện → `catalog.story.viewed` tới ngay, hàng trang chủ của khách xoay quanh truyện đó; theo dõi/bỏ ở library
  → outbox → `favorites`. `scripts/recommender-smoke.py` 13/13, `library-smoke.py` vẫn qua. Trình duyệt: hàng "Đề xuất cho bạn", bảng admin
  (số liệu + nút "Huấn luyện lại ngay").
- Bẫy: tab Chrome tự động bị ẩn (xem `Plan/library.md`); `docker compose run` của import cần backend đang chạy (đồng bộ truyện trước).
