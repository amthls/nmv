# Giai đoạn G: service library (Go)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Thiết kế chung: `Plan/microservices.md` (bảng service, "Lịch sử đọc (library)", giai đoạn G). Hai nhánh, mỗi nhánh một PR vào main.

## Hiện trạng (2026-10-11)
Backend giữ theo dõi truyện (`user_favorites`, 392 dòng), bookmark từng dòng (`bookmarks`), lịch sử đọc (`reading_history`, 1 dòng/người/chương,
2.930 dòng), album (`albums`, `album_stories`, `album_saves`, mã `AL-`), theo dõi người (`user_follows`, chỉ dùng để đếm).
Controller: `bookmark.controller.ts` (bookmark + theo dõi), `history.controller.ts` + `models/readingHistory.model.ts`, `album.controller.ts`.
Chỗ khác đọc thẳng các bảng này: hồ sơ (`user.controller`: số liệu, đọc gần đây, album, thể loại hay đọc), trang truyện (đang theo dõi?),
xóa truyện, xóa chương (`workspaceSync`), xóa tài khoản (`identitySync`: user_follows), mã `AL-`, người theo dõi cho thông báo chương mới
(messaging hỏi backend), **gợi ý truyện** (`recommender/train.ts`, `serve.ts`: lịch sử, theo dõi, album, bookmark).

## G1 `feat/library-service`: chuyển dữ liệu + API sang library

**Thiết kế:**
- `services/library` (Go, cùng khuôn messaging/workspace), `library_db`. Gateway `/api/library/*` (bỏ tiền tố, header ký `USER_SIG_KEY_LIBRARY`).
  **JSON giữ nguyên**: `/history`, `/bookmarks`, `/favorites` (+ `/toggle`, `/status/:storyId`), `/albums/*`; frontend chỉ đổi gốc.
- **Bản sao truyện/chương** `ext_stories`, `ext_chapters` (các cột các câu SQL cần: tên, slug, bìa, tác giả, loại, trạng thái, số chương,
  lượt xem/theo dõi, duyệt chưa, nhóm; chương: tên, slug, số, đã đăng) → các câu SQL cũ giữ gần nguyên (JOIN bản sao thay bảng thật).
  Đồng bộ: library hỏi backend `GET /internal/library/sync?since=` mỗi 30 giây (theo `updated_at`, có trigger sẵn) + đối soát cả bảng mỗi đêm
  (xóa dòng không còn); backend gọi `POST /internal/purge` của library khi xóa truyện/chương (xóa luôn lịch sử, bookmark, theo dõi, khỏi album
  như khóa ngoại `ON DELETE CASCADE` trước đây). shortcut: hỏi theo `updated_at` thay vì sự kiện outbox (backend chưa có); đổi khi có catalog.
- **Người dùng** (chủ album: tên, ảnh, khóa/xóa): hỏi backend `POST /internal/users/profiles` (cache 60 s) như messaging/community;
  `AL-` dùng số mã của chủ album lấy lúc tạo (`albums.owner_code_no`).
- **Số người theo dõi** (`stories.total_favorites` ở backend): library đếm lại và gửi `POST /internal/favorite-counts` sau mỗi lần theo dõi/bỏ.
- **Ai cũng hỏi library:** hồ sơ (`/internal/users/:id/overview`: số liệu + đọc gần đây + album + truyện hay đọc), trang truyện
  (`/internal/favorites/:user/:story`), mã `AL-` (`/internal/codes/album/:no`), messaging (`/internal/stories/:id/followers`, chuyển từ backend),
  **recommender ở backend** (`/internal/reco/export`, `/internal/reco/user/:id`: dữ liệu thô nó đang tự SELECT; tới giai đoạn H recommender
  đọc sự kiện). Xóa tài khoản: library nghe `identity.user.deleted` (xóa `user_follows` như trước).
- Chuyển dữ liệu: `library import-legacy` (giữ id, mã AL-, một lần, `legacy_imports`), lấy luôn bản sao truyện/chương.
- **Để G2:** gom ghi lịch sử qua Redis, `chapter.read`/`story.followed`, vị trí đọc + "Đọc tiếp" đúng đoạn, giới hạn ~1.000 truyện/người,
  gộp lịch sử khách khi đăng nhập.

- [x] library: khung (cấu hình, log, health/ready, khóa, migration), bản sao truyện/chương + đồng bộ, lịch sử, theo dõi, bookmark, album,
      API nội bộ (purge, profile overview, favorite status, codes, followers, reco), consumer identity, import-legacy, test tích hợp
- [x] Backend: `/internal/library/sync`, `/internal/favorite-counts`, profiles thêm `code_no`; hồ sơ/trang truyện/mã/xóa truyện/xóa chương/
      recommender hỏi library; bỏ controller + route + model cũ; messaging lấy người theo dõi từ library
- [x] identity ký `X-User-Sig-Library`; gateway `/api/library/*`; compose (`library`, `library_db`, khóa), launch.py, migrate.sh, CI, deploy;
      frontend đổi gốc
  - Trạng thái 2026-10-11 (WIP, đã commit lên nhánh, CHƯA build/chạy thật): `go test` library (Postgres) qua, `tsc`+`npm test` backend qua,
    `tsc` frontend qua, test messaging qua. `.env` máy này đã thêm 3 khóa. Chưa: build container, `migrate.sh` (import), smoke qua gateway,
    trình duyệt, README, Branches, PR. `scripts/simulateReaders.ts` (dev) vẫn ghi vào bảng cũ `reading_history` — sửa hoặc ghi chú.
- [ ] Thử: chuyển dữ liệu (đếm khớp, mã AL- giống hệt), lịch sử/theo dõi/bookmark/album qua gateway, trang truyện, hồ sơ, gợi ý,
      thông báo chương mới tới người theo dõi, xóa truyện; README, Branches; PR, tự merge

## G2 `feat/library-reading-position`
- [ ] Lịch sử gom qua Redis (như lượt xem), `chapter.read` ≤ 1 lần/chương/ngày, `story.followed|unfollowed` (outbox)
- [ ] Vị trí đọc (% cuộn) + "Đọc tiếp" đúng đoạn; giới hạn ~1.000 truyện/người; gộp lịch sử khách khi đăng nhập
