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
- [x] Thử: chuyển dữ liệu (đếm khớp, mã AL- giống hệt), lịch sử/theo dõi/bookmark/album qua gateway, trang truyện, hồ sơ, gợi ý,
      thông báo chương mới tới người theo dõi, xóa truyện; README, Branches; PR, tự merge
  - 2026-10-11: import khớp (392 theo dõi, 2.932 lịch sử, 184 album, 767 truyện-album, 43 lưu, 8 theo dõi người; 184 mã AL- giống hệt).
    `scripts/library-smoke.py` qua gateway 30/30 (xóa chương thay cho xóa truyện: cùng `/internal/purge`). Trình duyệt: lịch sử,
    tủ truyện, album, nút theo dõi. Lỗi tìm được và đã sửa: `code_no` bigint tới Go dạng chuỗi (tạo album 500); chương vừa đăng < 2 s
    không vào lịch sử (thêm `?ids=` hỏi đúng dòng); `worker` thiếu khóa/URL library (huấn luyện gợi ý); số người theo dõi trên trang
    truyện cộng chuỗi khi bấm theo dõi (lỗi cũ).

## G2 `feat/library-reading-position`

**Thiết kế (chốt 2026-10-11):**
- Trang đọc gửi `POST /api/library/history {chapter_id, scroll_position}` (% cuộn) mỗi 15 giây nếu đổi và khi rời trang/ẩn tab
  (`fetch keepalive`). Khách: lưu % vào mục lịch sử trong trình duyệt. Mở chương thì backend vẫn ghi "đã đọc" (`/internal/history`);
  bỏ lời gọi thừa `POST /api/v1/history` của frontend (404 từ G1).
- **Gom ghi:** library giữ vị trí trong bộ nhớ (theo người → chương, ghi đè %, cộng giây), ghi xuống DB mỗi 60 giây bằng một câu
  (`jsonb_to_recordset`), khi tắt service, và **ngay trước khi đọc lịch sử của chính người đó** (`GET /history`, overview hồ sơ) nên
  không thấy dữ liệu cũ. shortcut: bộ nhớ trong process thay vì Redis (library chạy 1 bản, mất tối đa 60 s vị trí nếu sập); đổi sang
  Redis khi chạy nhiều bản.
- **"Đọc tiếp" đúng chỗ:** link ở `/lich-su` và trang truyện thêm `#vt=<%>`; trang đọc thấy `#vt=` thì cuộn tới đó sau khi nội dung hiện.
- **Giới hạn ~1.000 truyện/người:** đối soát hằng đêm xóa lịch sử của các truyện cũ hơn 1.000 truyện gần nhất.
- **Gộp lịch sử khách:** đăng nhập xong, frontend gửi `POST /api/library/history/merge {items: [{chapter_id, read_at, scroll_position}]}`
  (≤ 200 mục, chỉ chương đã đăng, chỉ ghi đè khi mới hơn) rồi xóa danh sách khách trên trình duyệt.
- **Để giai đoạn H** (chưa ai nhận): sự kiện `chapter.read` (≤ 1 lần/chương/ngày) và `story.followed|unfollowed`; recommender Python
  là bên nhận đầu tiên, làm cùng lúc để thử được hai đầu.

- [x] library: bộ đệm vị trí + flush (60 s, tắt service, trước khi đọc), `POST /history/merge`, cắt 1.000 truyện trong reconcile, test
- [x] frontend: gửi vị trí 15 s / rời trang (cả khách), `#vt=` khi mở + link "Đọc tiếp", gộp lịch sử khách khi đăng nhập, bỏ POST thừa
- [x] Thử: smoke (vị trí, merge), trình duyệt (cuộn → rời → Đọc tiếp đúng chỗ, khách → đăng nhập), README, Branches; PR, tự merge
  - 2026-10-11: smoke 32/32; trình duyệt: cuộn 60% → rời → link `#vt=60` → mở lại đúng 60%; mục khách gộp vào tài khoản (33%), trình duyệt
    xóa danh sách khách. Bẫy: `html { scroll-behavior: smooth }` làm `scrollTo` thành hoạt ảnh → dùng `behavior: 'instant'`; nội dung
    chương dựng chậm → đợi chiều cao trang ổn định rồi mới cuộn; xóa lịch sử phải ghi bộ đệm trước (không thì dòng vừa xóa quay lại).
    Tab Chrome tự động bị ẩn: không có sự kiện scroll và timer bị hãm, phải phát tay khi thử. Còn lại: trang `/lich-su` mở ngay sau khi
    rời chương có thể chưa thấy vị trí mới nhất (POST đến sau GET), lần gộp khách hiện ở lần tải sau.
