# Tách NovelHub thành nhiều service

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Mỗi giai đoạn là một (hoặc vài) nhánh riêng tạo bằng `scripts/new-branch.sh`; web phải chạy được sau **mỗi** giai đoạn.
> Liên quan: `Plan/chapter-workspace.md` (workspace-service là một service trong plan này).

## Mục tiêu
- Mỗi mảng nghiệp vụ một service, **một database riêng**, deploy và mở rộng riêng; tải của mảng này không kéo chậm mảng khác.
- Đường đọc của độc giả (trang truyện, đọc chương) luôn nhanh nhất: có cache, không phụ thuộc service phụ.
- Không quá ít (một khối to như bây giờ) và không quá nhiều (mỗi bảng một service): chia theo **nghiệp vụ + kiểu tải**.

## Cách chia: 1 gateway + 9 service nghiệp vụ + 1 service backup

| # | Service | Lo việc gì | Dữ liệu (DB riêng) | Kiểu tải | Ngôn ngữ |
|---|---|---|---|---|---|
| 0 | **gateway** (nginx có sẵn) | Cổng duy nhất, điều hướng `/api/<service>/*`, giới hạn tần suất, cache ảnh, WebSocket, **xác thực tập trung** (`auth_request` → identity) | không | rất nhiều request nhỏ | nginx |
| 1 | **identity** (bảo mật) | Đăng ký, đăng nhập, JWT, thu hồi phiên, quên mật khẩu, xác thực email, gửi mail; vai trò site (admin/mod/author/translator); khóa/xóa tài khoản; hồ sơ cơ bản + cài đặt | `identity_db`: users, user_roles, token, cài đặt | ít ghi, đọc nhiều (verify token) | **Go** |
| 2 | **catalog** (kho truyện) | Truyện, tập, tag, nhóm dịch + thành viên + xin gia nhập, cộng tác viên; **bản đọc** của chương (nhận từ workspace); lượt xem; tìm truyện dự phòng bằng SQL khi search lỗi; gỡ/khôi phục truyện; **API quyền** "ai giữ/đóng góp truyện nào" | `catalog_db`: stories, volumes, tags, groups, chapters (bản đọc), chapter_pages, views | **đọc rất nhiều**, cache Redis | TS |
| 3 | **workspace** (soạn chương) | Nháp, phiên bản, pull/gộp, đề xuất, giao việc (chi tiết: `Plan/chapter-workspace.md`) | `ws_db`: blocks, revisions, drafts, rounds, tasks | ghi nhỏ liên tục (lưu nháp) | **Go** |
| 4 | **library** (thư viện cá nhân) | Theo dõi truyện, bookmark từng dòng, lịch sử đọc, album | `library_db` | ghi rất nhiều (lịch sử mỗi lần đọc), gom qua Redis | **Go** |
| 5 | **community** (tương tác) | Bài Fandom, bình luận (truyện/chương/bài), cảm xúc, ghim; **báo cáo vi phạm**; danh sách **nội dung đã gỡ** (gộp cả truyện qua sự kiện) | `community_db` | đọc + ghi vừa | TS |
| 6 | **messaging** (tin nhắn & thông báo) | Tin nhắn riêng (nhãn, chặn, ghim), chat nhóm, **hộp thông báo**, đẩy realtime (WebSocket thường, bỏ Socket.IO), phân phát thông báo hàng loạt (khi có chương mới) | `messaging_db` | kết nối giữ lâu (WebSocket), fan-out lớn | **Go** |
| 7 | **recommender** (học thói quen) | Nhận sự kiện đọc/xem/theo dõi, huấn luyện định kỳ, trả gợi ý trang chủ + truyện liên quan | `reco_db` | huấn luyện nặng chạy nền, phục vụ nhẹ | **Python** |
| 8 | **media** (tệp) | Upload ảnh/trang manga, đổi kích thước `?w=`, xuất EPUB/PDF | `media_db` (bản ghi tệp, job xuất) + ổ `uploads/` | CPU + ổ đĩa nặng | TS |
| 10 | **search** (tìm kiếm công khai) | Chủ duy nhất của Elasticsearch: đánh index truyện, bài viết, nhóm dịch, người dùng (tên công khai) từ sự kiện; một ô tìm chung, gợi ý khi gõ, trang khám phá; từ khóa hot, thống kê tìm không ra | Elasticsearch + `search_db` (thống kê từ khóa) | đọc nhiều, gợi ý cần <50ms | **Go** |
| 9 | **backup** (sao lưu, vận hành) | Sao lưu **mọi database** + `uploads/`, giữ nhiều bản, gửi bản sao ra ngoài máy, tự thử khôi phục, báo khi lỗi; **kho lưu trữ** nội dung đã xóa thật (gọn, tìm lại được, khôi phục được); trang trạng thái + kho cho Admin | `backup_db` (chỉ mục kho) + thư mục backup + kho ngoài máy | chạy nền theo lịch | Go (+ công cụ có sẵn) |

**Chốt (2026-10-09):** giữ đủ 8 service nghiệp vụ · xác thực ở gateway (`auth_request` → identity) ·
thứ tự: backup → nền móng → identity → workspace → … · thêm **service backup riêng** (chủ dự án sợ mất dữ liệu).

Hạ tầng dùng chung (không phải service nghiệp vụ): **Postgres** (một máy, mỗi service một database, PgBouncer chia pool theo database),
**Redis** (cache, đếm, rate limit; khóa có tiền tố theo service), **RabbitMQ** (sự kiện), **Elasticsearch** (chỉ search dùng).

**Vì sao chia như vậy (không gộp/không tách thêm):**
- `workspace` tách khỏi `catalog`: viết (soạn, gộp) và đọc (độc giả) khác hẳn nhau về tải và độ phức tạp.
- `library` tách khỏi `catalog`: dữ liệu theo **người dùng**, ghi liên tục; để chung sẽ tranh tài nguyên với đường đọc truyện.
- `messaging` tách khỏi `community`: WebSocket giữ kết nối lâu và fan-out hàng chục nghìn thông báo; bài viết/bình luận là CRUD thường.
- `media` riêng: xử lý ảnh/PDF ngốn CPU, không được làm chậm API.
- `search` riêng (đổi 2026-10-09): một ô tìm chung cho truyện, bài viết, nhóm, người dùng cần gom sự kiện của nhiều service;
  để trong catalog thì catalog phải ôm dữ liệu của community/identity.
- **Không** tách riêng: tag (nhỏ, thuộc catalog), báo cáo (thuộc community),
  mail (identity gửi mail tài khoản; messaging gửi mail thông báo nếu sau này có).

## Ngôn ngữ và RAM (chốt 2026-10-09)
Mục tiêu chủ dự án: **không để service ngốn RAM mà không giải quyết vấn đề gì.**
- Đo lúc rảnh (2026-10-09): Elasticsearch 668 MB · RabbitMQ 165 MB · frontend 130 MB · mỗi tiến trình Node 40–90 MB ·
  Postgres 64 MB · gateway 31 MB · PgBouncer, Redis ~10 MB. Một service Go lúc rảnh ước ~10–25 MB.
- **Go (6):** workspace, backup, identity (gọi ở mọi request), messaging (giữ nhiều kết nối), search (gọi khi gõ), library (ghi nhiều).
- **TS (3), giữ để không viết lại chỗ rủi ro:** catalog (khối code lớn nhất), community (lọc HTML chống XSS), media (`sharp`, EPUB/PDF).
- **Python (1): recommender** (chủ dự án chọn): huấn luyện là **job theo lịch, chạy xong thoát** (numpy, scikit-learn, `implicit`);
  phục vụ gợi ý là API nhỏ (FastAPI) chỉ đọc kết quả tính sẵn. Chỉ **nhận** sự kiện, không phát → bản Python của thư viện dùng chung
  chỉ cần phần nhận sự kiện + kiểm tra JSON Schema.
- **Realtime: WebSocket thường, không dùng Socket.IO.** Socket.IO là lớp bọc trên WebSocket (tiện: tự kết nối lại, room, xác nhận,
  dự phòng long-polling) nhưng nặng hơn và thư viện Go không theo kịp bản 4. Tự làm gọn: gói tin `{type, data, id}`, ping/pong,
  client tự kết nối lại (chờ tăng dần), nhận lại sự kiện bị lỡ theo `id` cuối cùng; room = theo user/cuộc trò chuyện ở server.
- **Ping chỉ để dọn kết nối chết, không quyết định tin đã giao hay chưa.** Postgres là sự thật; socket chỉ là đường đẩy nhanh;
  kết nối lại thì lấy bù theo id. Ping sai → tệ nhất chậm vài giây hoặc kết nối lại thừa, **không mất tin**. Cụ thể:
  ping **tầng giao thức do server gửi** (trình duyệt tự trả pong, tab chạy nền không bị chậm) mỗi ~30s; chỉ cắt khi im lặng
  ~75–90s (lỡ 2–3 lần), dữ liệu bất kỳ cũng tính là còn sống; mốc cắt của nginx (120s) và Cloudflare (~100s) phải lớn hơn chu kỳ ping;
  client bỏ tin trùng id; mỗi tab một mã kết nối, kết nối mới thay kết nối cũ của cùng tab; giới hạn số kết nối mới/giây khi kết nối lại hàng loạt.
- **Giữ Elasticsearch** (chủ dự án chọn) và **giữ RabbitMQ**. Giới hạn bộ nhớ trong compose cho mọi container; ES giữ cấu hình heap nhỏ hiện có.
- Thư viện dùng chung có hai bản đầy đủ (TS + Go) và một bản rút gọn (Python, chỉ nhận sự kiện): outbox, nhận sự kiện, đọc header xác thực, log; sự kiện mô tả bằng **JSON Schema**
  chung trong repo, cả hai bản test với cùng các file đó.
- Viết lại identity bằng Go: phải có test cho đăng nhập, khóa, thu hồi phiên, đặt lại mật khẩu trước khi chuyển (phần bảo mật).

## Container sau khi chuyển (chốt 2026-10-10)
**Hạ tầng giữ nguyên, chỉ đổi cấu hình:**
- `postgres`: mỗi service một database + user riêng; bật lưu WAL cho backup.
- `pgbouncer`: pool theo từng database.
- `redis`: dùng chung, tiền tố khóa theo service; thêm cache quyền, khóa sửa nháp, số chưa đọc, pub/sub realtime.
- `rabbitmq`: thành trục sự kiện chung `novelhub.events` + dead-letter.
- `search` (Elasticsearch): đổi chủ sang search-service; thêm index bài viết, nhóm, người dùng.
- `gateway` (nginx): định tuyến `/api/<service>/*`, xác thực tập trung, `request_id`, WebSocket tới messaging.
- `cloudflared`, `pgadmin` (profile tools): không đổi.

**Worker cũ tan vào service mới:** `worker` → thông báo sang messaging, gộp lượt xem sang catalog (tiến trình nền); `export-worker` → media. Hai container cũ bị xóa.

**Số container:** hạ tầng 6 + gateway + frontend + 8 service (identity, catalog, workspace, library, community, media, search,
recommender-api) + messaging + backup = **18 chạy thường trực**, ~~cộng **bộ giám sát** (victorialogs, victoriametrics, vmalert,
bộ gom log từ Docker; ~100–200 MB) → **~21–22**~~ (**bỏ bộ giám sát**, chủ dự án 2026-10-10); `recommender-train` là job chạy theo lịch rồi thoát; `pgadmin` khi cần.
- **messaging mặc định là 1 container** (một file chạy Go, bật cả 3 vai trò api/realtime/worker); chỉ tách 3 container khi cần mở rộng riêng
  (cờ khởi động chọn vai trò, không phải sửa code). Tương tự media chạy xử lý xuất file trong cùng container.
- Máy phát triển: profile compose để chỉ bật service đang làm + hạ tầng (ví dụ làm workspace không cần recommender, search).

**Ước tính RAM lúc rảnh:** hiện tại ~1,3 GB (đo 2026-10-09) → sau khi chuyển ~1,9–2,2 GB (không còn bộ giám sát; ES ~670 MB vẫn là lớn nhất; 6 service Go
~15–25 MB mỗi cái; 3 service TS ~70–100 MB; recommender-api ~70 MB). Máy hiện có ~7,6 GB. Mọi container đặt `mem_limit`.
- [ ] Đo lại RAM thực tế sau mỗi giai đoạn tách, ghi vào đây.

## Sơ đồ

```
 Trình duyệt / Next.js (frontend, giữ nguyên, gọi API qua gateway)
        │
   gateway (nginx) ── auth_request ──► identity /internal/verify (cache 30s) → thêm X-User-Id, X-User-Roles
        │
   ┌────┼──────────┬────────────┬───────────┬────────────┬─────────────┬────────────┐
 identity catalog  workspace(Go) library   community    messaging     recommender   media
   │       │  ▲        │          │           │         (WebSocket)      │           │
   ▼       ▼  │        ▼          ▼           ▼             ▼              ▼           ▼
 identity catalog    ws_db    library_db  community_db  messaging_db    reco_db    media_db
  _db     _db │                                                                   + uploads/
              │
   RabbitMQ (exchange "novelhub.events") ◄── outbox của từng service ──► các service đăng ký sự kiện mình cần
```

## Tổ chức dữ liệu (chốt 2026-10-09)
Mỗi dữ liệu có **đúng một service chủ** được ghi; nơi khác chỉ giữ **bản sao để đọc** cập nhật qua sự kiện.

| Database | Bảng (hiện có → chuyển sang) + bảng mới |
|---|---|
| `identity_db` | users, user_roles, auth_tokens, user_settings |
| `catalog_db` | stories, volumes, **chapters + chapter_pages (bản đọc)**, tags, tag_categories, story_tags, story_collaborators, **translation_groups, group_members, group_join_requests**, story_views, story_views_daily |
| `ws_db` | chapter_submissions (→ drafts) + content_blocks, chapter_revisions, draft_rounds, draft_shares, chapter_tasks |
| `library_db` | user_favorites, bookmarks, reading_history, albums, album_stories, album_saves, user_follows |
| `community_db` | posts, post_tags, post_reactions, **comments, comment_likes** (truyện + chương + bài), reports, removed_items, appeals |
| `backup_db` | archived_items (chỉ mục kho lưu trữ; gói nội dung nằm trong thư mục backup) |
| `messaging_db` | direct_messages, dm_labels, dm_label_conversations, user_blocks, **group_messages**, notifications, broadcast_notifications, post_notification_mutes |
| `reco_db` | rec_events, rec_item_factors, rec_item_similar, rec_user_factors, rec_user_scores, rec_model_runs |
| `search_db` | search_query_stats (từ khóa theo ngày, ẩn danh, số kết quả); dữ liệu tìm kiếm thật nằm trong Elasticsearch |
| `media_db` | story_exports + bản ghi tệp upload; tệp thật ở ổ `uploads/` (sau này có thể MinIO/S3) |

- **Người dùng:** identity là chủ duy nhất. Email, mật khẩu, token, trạng thái khóa **không rời identity**; service khác chỉ có bản sao
  công khai `user_profiles` (id, username, tên hiển thị, avatar, vai trò công khai).
- **Nội dung chương có hai bản:** gốc ở `ws_db` (lịch sử, nháp, hash), bản đọc phẳng ở `catalog_db` (nhanh, có cache, dựng lại được từ workspace).
- **Bình luận:** một hệ thống chung ở community cho truyện, chương và bài post (`target_type` = story|chapter|post).
  Catalog chỉ giữ số đếm `total_comments` cập nhật từ `comment.created|deleted`. Trang truyện tải phần bình luận riêng.
- **Nhóm dịch:** ở catalog cạnh truyện (kiểm tra quyền truyện trong cùng database). Trang nhóm ghép: thông tin/thành viên/truyện (catalog)
  + chat nội bộ (messaging) + việc giao, đề xuất chờ gộp (workspace).
- **Liên kết chéo:** dùng UUID, **không** có khóa ngoại xuyên database; xóa/ẩn lan truyền bằng sự kiện (`story.deleted`, `user.deleted`, …),
  mỗi service tự dọn phần của mình.
- **Vật lý:** một máy Postgres, mỗi database có user riêng (service này không đọc được DB service khác); Redis dùng chung có tiền tố;
  Elasticsearch chỉ search; backup chụp mọi database cùng thời điểm + `uploads/`.

## Thiết kế tìm kiếm (chốt 2026-10-09)
**Hai loại, tách rõ:**
1. **Nội dung công khai → search-service + Elasticsearch.** Chỉ mục: `stories` (tên, tên gốc, tác giả, họa sĩ, tóm tắt, tag, nhóm, mã,
   tên chương để "nhảy tới chương"), `posts` (tiêu đề, nội dung dạng chữ, tag, truyện gắn kèm), `groups`, `users` (username, tên hiển thị).
   **Không** tìm trong nội dung chương (để sau nếu thật cần; tốn RAM ES).
2. **Dữ liệu riêng tư / có quyền → ở lại service chủ, Postgres `pg_trgm` + `unaccent`:** tin nhắn (messaging), nháp (workspace),
   báo cáo + `/da-go` + khiếu nại (community), quản trị người dùng theo email (identity), kho lưu trữ (backup).
   Dữ liệu riêng tư **không bao giờ** vào Elasticsearch.

**Đánh index:** nhận `story.*`, `group.*`, `chapter.published|deleted`, `post.*`, `user.updated` → gom lô ~1 giây → ghi hàng loạt;
mỗi tài liệu có **số phiên bản** (ES bỏ bản cũ hơn → lệch thứ tự vẫn đúng); gỡ/xóa → rút khỏi index ngay.
Chỉ mục giữ sẵn trường để hiện thẻ (tên, bìa, slug, số chương…); số đếm hay đổi (lượt xem, theo dõi) cập nhật hàng loạt vài phút/lần.

**Dựng lại index không gián đoạn:** đọc dữ liệu từ service chủ qua API nội bộ phân trang → index mới → đổi **alias** sang index mới.

**Truy vấn:** `GET /api/search?q=&type=story|post|group|user&…bộ lọc` (trang khám phá: tag gồm/loại trừ, trạng thái, ngôn ngữ,
số chương, sắp xếp) · `GET /api/search/suggest?q=` cho ô tìm ở menu (nhóm theo loại, <50ms, cache Redis từ khóa phổ biến).
Tiếng Việt: bỏ dấu, gợi ý theo tiền tố, chịu gõ sai nhẹ. Xếp hạng: độ khớp × độ phổ biến × độ mới (sau này + cá nhân hóa từ recommender).

**Khi ES lỗi:** trang khám phá truyện dùng SQL dự phòng ở catalog; loại khác báo "tạm thời không tìm được".

**Từ khóa hot + tìm không ra:** ghi từ khóa ẩn danh, gom theo ngày vào `search_db`; ô tìm hiện "từ khóa hot";
Admin xem từ khóa không ra kết quả (biết người đọc đang cần truyện gì). Giới hạn tần suất tìm theo IP như hiện tại.

## Tính năng chính: service nào lo (chốt 2026-10-10)
- **Nhóm dịch:** dữ liệu nhóm, thành viên, vai trò, **cài đặt quy trình** (bước nào bật, ai được gộp) ở catalog; việc theo vai trò,
  đề xuất, hoạt động ở workspace; chat ở messaging. WS nhóm `/ws/nhom/:slug` ghép từ ba nơi (chi tiết `Plan/chapter-workspace.md`).
- **Lịch sử đọc (library):** trang đọc gửi vị trí (% cuộn) mỗi ~15s / khi rời trang → Redis `hist:{user}:{story}` → gộp xuống DB
  mỗi ~60s (1 dòng/người/truyện) → `chapter.read` tối đa 1 lần/chương/ngày/người. "Đọc tiếp" mở đúng chương + vị trí.
  `/lich-su` dùng bản sao `ext_stories` (tên, bìa, slug, đã gỡ) → một lời gọi. Khách: trình duyệt, gộp khi đăng nhập.
  Giữ ~1.000 truyện gần nhất/người; xóa từng truyện hoặc tất cả.
- **Khám phá:** `/kham-pha` (lọc tag gồm/loại trừ, trạng thái, ngôn ngữ, số chương, sắp xếp) do **search** (ES). Trang chủ = các "kệ"
  tải độc lập: Đang hot (catalog, job tính sẵn vào Redis mỗi vài phút) · Mới cập nhật (catalog) · Gợi ý cho bạn (recommender) ·
  Đọc tiếp (library) · Đang được thảo luận (community, tính sẵn).
- **Đăng truyện:** upload bìa (media) → catalog tạo truyện (kiểm tra thành viên nhóm) → `story.created` → search, recommender.
- **Đăng chương:** workspace (nháp → các bước nhóm → gộp, có **hẹn giờ đăng**) → `revision.merged` → catalog dựng bản đọc + xóa cache
  → `chapter.published` → messaging báo người theo dõi, search cập nhật. Manga: ảnh qua media, workspace lưu đường dẫn.
- **Thảo luận (community):** bình luận truyện/chương + bài Fandom gắn truyện; tab "Thảo luận" ở trang truyện = bài có `story_id`;
  số bình luận/bài ở catalog qua sự kiện + đếm lại định kỳ.

## Thiết kế messaging: tin nhắn + thông báo (chốt 2026-10-09)
Một codebase, `messaging_db`, **3 vai trò** (mặc định chạy chung 1 container, tách ra khi cần mở rộng riêng): `messaging-api` (REST), `messaging-realtime` (WebSocket thường + Redis pub/sub giữa các bản,
chạy nhiều bản), `messaging-worker` (nhận sự kiện, phân phát, gộp thông báo).

**Tin nhắn: tin riêng + chat nhóm gộp thành "cuộc trò chuyện"**
- `conversations` (loại dm|group, group_id, last_message_at, xem trước) · `conversation_members` (vai trò, `last_read_message_id`,
  tắt tiếng, ghim, nhãn riêng) · `messages` (id tăng theo thời gian, nội dung, đính kèm, `edited_at`, `deleted_at`, `pinned_at`) ·
  `user_blocks`, `dm_labels` giữ như cũ.
- Danh sách hội thoại = một lần tra index `conversation_members(user_id, last_message_at)`; chưa đọc = so với `last_read_message_id`
  (đọc xong cập nhật 1 dòng); phân trang tin theo id; chat nhóm đồng bộ thành viên từ `catalog.group.member_changed`.
- Gửi: kiểm tra chặn + giới hạn tần suất → ghi → phát Redis → realtime đẩy **nguyên tin**; offline thì lần sau tải từ tin cuối đã có.
- **Đính kèm bản nháp** (sau này, liên quan workspace): tin lưu `{type: 'draft', draft_id}`; nội dung + quyền do workspace quyết khi mở
  (chỉ thành viên nhóm của truyện xem được); thao tác Xem · Tạo bản sao của tôi · Sửa (nếu được cấp, luân phiên có khóa).
  Chi tiết ở `Plan/chapter-workspace.md`. Đính kèm ảnh qua media; báo cáo tin nhắn qua community.
- Chuyển dữ liệu: `direct_messages` → một conversation dm cho mỗi cặp; `group_messages` → conversation group cho mỗi nhóm.
- Lớn lên: chia bảng `messages` theo tháng.

**Thông báo**
- worker nhận sự kiện (bình luận/trả lời, cảm xúc, chương mới, nháp gửi/trả lại, giao việc, truyện bị gỡ, nhóm…) → chọn người nhận →
  kiểm tra cài đặt/tắt tiếng → **gộp** vào thông báo chưa đọc cùng loại ("Yuki và 12 người khác đã thích…", "Truyện X có 3 chương mới")
  → ghi theo lô → đẩy realtime → tăng số chưa đọc (Redis, đối chiếu DB định kỳ).
- Chương mới: messaging giữ **bản sao người theo dõi** (từ `library.story.followed|unfollowed`), phân phát lô 1000.
- Thông báo toàn site của Admin: 1 dòng + bảng đánh dấu đã đọc, không chép cho từng người.
- Cài đặt theo loại × kênh (web; email để sau), giữ tắt thông báo theo bài/truyện; `dedupe_key` chống trùng.
- **Giữ:** đã đọc **30 ngày**, chưa đọc **60 ngày**; bảng chia theo tháng để xóa nhẹ.
- Email: **để sau** (thiết kế sẵn kênh trong cài đặt).
- **Bỏ enum `notification_type`** (thêm loại phải migration, nhiều thứ đang dồn vào `system`): `type` là chuỗi đăng ký trong code,
  kèm `category` để bật/tắt theo nhóm.
- **Bảng `notifications`:** user_id, `category`, `type`, `actors` (≤ 3 người gần nhất) + `actor_count`, `target` (loại + id),
  `data` (**ảnh chụp** tên truyện/tiêu đề/đoạn trích → hiện ngay không hỏi service khác), `group_key`, `seen_at` (đã mở chuông),
  `read_at` (đã bấm), created_at, updated_at. Gộp = cập nhật thông báo **chưa đọc** cùng `group_key`. Nội dung đã gỡ/xóa → bấm vào
  hiện "không còn tồn tại".
- **Danh mục (category → loại):**
  - *Đọc truyện:* chương mới của truyện theo dõi (gộp theo truyện) · truyện theo dõi bị gỡ/khôi phục.
  - *Tương tác:* trả lời bình luận · bình luận trên bài · cảm xúc (gộp theo bài/bình luận). Tin nhắn mới chỉ ở biểu tượng tin nhắn, không vào chuông.
  - *Nhóm dịch:* xin gia nhập (leader/mod) · được duyệt/từ chối/thêm/loại/đổi vai trò.
  - *Workspace:* được giao việc / tới lượt bước của bạn · đề xuất chờ gộp (gộp theo truyện) · đề xuất được gộp/bị trả lại ·
    được chia sẻ nháp/cấp quyền sửa/nhận chuyển giao · chương hẹn giờ đã đăng.
  - *Kiểm duyệt:* nội dung của bạn bị gỡ/khôi phục (kèm lý do) · kết quả khiếu nại · báo cáo/khiếu nại mới (Admin/Mod, gộp).
  - *Hệ thống:* thông báo toàn site của Admin (1 dòng) · đăng nhập thiết bị lạ, mật khẩu vừa đổi (kèm mail).
  - Cảnh báo kỹ thuật (không có bộ giám sát): thông báo hệ thống cho Admin như backup, kèm mã để tìm trong `docker compose logs`.
- **Không tắt được:** thay đổi vai trò/thành viên nhóm của chính mình, đề xuất được gộp/trả lại, nội dung bị gỡ/khôi phục,
  kết quả khiếu nại, thông báo toàn site, cảnh báo bảo mật tài khoản.
- **Giao diện:** chuông có số **chưa xem** (mở chuông → về 0, từng mục vẫn "chưa đọc" tới khi bấm), tab Tất cả / Chưa đọc /
  Nhóm dịch / Workspace, "đánh dấu đã đọc hết"; trang `/thong-bao` lọc theo nhóm; cài đặt dạng bảng nhóm × kênh (web; email sau)
  + tắt theo truyện, bài, nhóm, hội thoại; realtime qua WebSocket, kết nối lại thì lấy bù theo id.

## Gỡ, xóa, khôi phục, khiếu nại (chốt 2026-10-09)
- **Service chủ nhận lệnh:** truyện → catalog, bài viết/bình luận → community, tài khoản → identity. Service chủ đổi trạng thái
  (1 transaction + outbox) rồi phát sự kiện; service khác tự xử lý phần của mình.
- **Gỡ (Admin/Mod, ngang quyền nhau, ai cũng khôi phục được thứ người kia gỡ):** `story.removed|restored`, `post.removed|restored`.
  Nhận sự kiện: community (thêm/bớt ở `/da-go`, **tự đóng mọi báo cáo đang chờ** của nội dung đó), messaging (báo người đăng + lý do),
  workspace (khóa gộp, nháp vẫn sửa được), recommender (bỏ khỏi gợi ý), library (giữ theo dõi, hiện "đã bị gỡ"); catalog tự ẩn,
  xóa khỏi tìm kiếm, xóa cache.
- Lệnh chỉ chạy khi trạng thái đúng (gỡ thứ đang hiện, khôi phục thứ đang gỡ), không thì 409; sự kiện có số phiên bản nên lệch thứ tự
  vẫn ra đúng trạng thái cuối.
- **Không** làm nhật ký kiểm duyệt riêng; người gỡ, thời điểm, lý do lưu trên chính nội dung (`removed_by`, `removed_at`, lý do).
- **Khiếu nại:** người bị gỡ bấm "Yêu cầu xem lại" + lời giải thích, **mỗi nội dung một lần**; hiện trong `/da-go` cho Admin/Mod
  (khôi phục hoặc giữ gỡ, báo kết quả qua messaging). Bảng `appeals` ở community.
- **Chủ tự xóa (truyện, bài viết):** vào **thùng rác 30 ngày**, chủ tự khôi phục được. Hết hạn → **xóa thật ở mọi service
  trừ backup** (backup lưu trữ lại, xem "Kho lưu trữ" ở giai đoạn 0).
- **Quy trình xóa thật an toàn (không mất dữ liệu giữa chừng):**
  1. Service chủ phát `story.purge_started {id}` (hoặc `post.…`).
  2. Mỗi service có dữ liệu của nội dung đó gửi **phần của mình** cho backup (`POST /internal/archive/<loại>/<id>/parts/<service>`),
     backup lưu xong mới trả OK → service đó mới xóa dữ liệu của mình, phát `…part_purged`.
  3. Service chủ gửi phần của mình và xóa sau cùng; media xóa ảnh cuối cùng.
  4. Backup đánh dấu mục đã đủ khi nhận đủ các phần (danh sách phần cần có theo loại); thiếu phần quá vài giờ → báo Admin.

## Nhất quán dữ liệu giữa các service (chốt 2026-10-10)
**Ba loại dữ liệu:**
- **Gốc:** chỉ một service ghi (vd `identity.users`, `ws.chapter_revisions`, `community.posts`). Hỏng → sửa tại gốc rồi phát lại; nặng → PITR.
- **Bản sao:** chép từ sự kiện để đọc nhanh (`catalog.chapters`, `*.ext_user_profiles`, index ES, người theo dõi ở messaging) →
  hỏng thì **xóa và dựng lại** từ gốc. Tên bảng có tiền tố **`ext_`** + cột `source_version`, `synced_at`.
- **Cache (Redis):** có hạn sống, xóa thoải mái.
Mỗi database có thêm `outbox` (sự kiện chờ gửi) và `inbox` (event_id đã xử lý).

**Đường đi sự kiện:** ghi gốc + outbox **cùng transaction** → đẩy RabbitMQ (hàng đợi bền, tin lưu đĩa, xác nhận đã nhận mới xóa outbox)
→ bên nhận trong 1 transaction: bỏ nếu `event_id` đã có trong inbox, chỉ áp dụng nếu `version` mới hơn, ghi inbox → **ack sau khi commit**
→ lỗi thì thử lại chờ tăng dần, quá 5 lần vào **hàng cách ly** (dead-letter) + báo Admin.

**Sự kiện mang ảnh chụp đầy đủ** (`{id, version, …trạng thái}`), không mang thay đổi kiểu `+1` → lỡ/trùng vẫn hội tụ.
**Bộ đếm** (lượt xem, bình luận, theo dõi) **đếm lại định kỳ từ gốc**, không cộng dồn theo sự kiện.

**Dữ liệu sai đã gửi đi:**
1. *Chặn từ đầu:* JSON Schema cho mỗi sự kiện; bên gửi kiểm tra trước khi ghi outbox; test hợp đồng trong CI; schema chỉ được thêm trường,
   đổi phá vỡ → sự kiện `v2` chạy song song tới khi mọi bên nhận chuyển xong.
2. *Bên nhận tự vệ:* kiểm tra lại; không hợp lệ → không áp dụng, vào hàng cách ly kèm lý do, báo Admin; không làm tắc sự kiện khác.
   Bên gây hiệu ứng không rút lại được (thông báo, mail) có **ngưỡng an toàn** (vd > 100k thông báo từ 1 sự kiện → giữ chờ Admin).
3. *Sai nội dung (lỗi logic):* sửa ở gốc → `republish --type … --ids …` để bản sao khớp lại → lỗi lan rộng thì dựng lại toàn bộ bản sao
   (API xuất nội bộ phân trang; ES đổi alias) → hiệu ứng đã xảy ra thì phát **sự kiện bù** (vd `notification.retract`)
   → gốc hỏng nặng thì PITR service đó rồi phát lại.

**Đối soát đêm:** catalog.chapters ↔ revision mới nhất ở workspace (hash) · số tài liệu ES ↔ gốc · `ext_user_profiles` ↔ identity
(`updated_at`) · người theo dõi messaging ↔ library. Lệch → tự phát lại cho đúng đối tượng + báo cáo.

**Cache:** đọc cache trước, trượt thì đọc DB; hạn sống ngắn + **xóa ngay khi có sự kiện**; khóa kèm version (`story:{id}:v42`);
không bao giờ ghi dữ liệu thật vào cache; Redis sập → đọc thẳng DB.

**Theo dõi:** báo Admin khi outbox dồn, hàng cách ly có tin, bên nhận chậm quá vài phút, đối soát phát hiện lệch.

## Phiên, cookie, hoạt động người dùng (2026-10-10)
**Phiên (identity là chủ):** `identity_db.sessions` (sid, user_id, `refresh_token_hash` (chỉ lưu băm), `family_id` cho xoay vòng,
tên thiết bị, IP tạo + dùng gần nhất, created/last_used/expires (30 ngày)/revoked). Redis: `sess:{sid}` (cache 30s),
`revoked:{sid}` giữ 15 phút. Token truy cập chỉ chứa `user_id` + `sid`; gateway verify không chạm DB mỗi request.
Trang "Thiết bị đang đăng nhập": đăng xuất từng thiết bị/tất cả; khóa tài khoản hoặc đổi mật khẩu → thu hồi mọi phiên (≤ 30s).

**Cookie:** `nh_access` (httpOnly, Secure, Lax, 15 phút) · `nh_refresh` (httpOnly, Secure, Strict, chỉ path `/api/identity/refresh`, 30 ngày)
· `nh_csrf` (JS đọc được, gửi kèm header cho request ghi) · `nh_vid` (mã khách ẩn danh, 1 năm).
**Không token nào trong `localStorage`**; `localStorage` chỉ giữ thứ không nhạy cảm (giao diện, cài đặt đọc, nháp tạm); cài đặt đọc
của người đăng nhập đồng bộ lên DB.

**Hoạt động người dùng, mỗi loại về đúng nơi:**
| Hoạt động | Nơi lưu | Giữ |
|---|---|---|
| Đọc tới đâu | library `reading_history` (1 dòng/người/truyện, gom qua Redis) | tới khi người dùng xóa |
| Theo dõi, bookmark, album | library | tới khi người dùng xóa |
| Bài, bình luận, cảm xúc / tin nhắn | community / messaging | theo quy tắc gỡ-xóa của service |
| Hành vi cho gợi ý | recommender `rec_events` | thô 180 ngày, sau đó chỉ bản tổng hợp |
| Lượt xem | catalog, **chỉ con số** | mãi (số) |
| Từ khóa tìm | search `search_db`, ẩn danh, theo ngày | 1 năm |
| Đăng nhập/đăng xuất/đổi mật khẩu/đổi vai trò/sai mật khẩu | identity `security_log` (có IP, trình duyệt) | 90 ngày |
| Log kỹ thuật | stdout/file, nối bằng `request_id`; **không** ghi nội dung request, mật khẩu, token | 14 ngày |
| Khách chưa đăng nhập | trình duyệt + `nh_vid` | gộp vào tài khoản khi đăng nhập |

**Riêng tư:** IP đầy đủ chỉ ở `sessions` + `security_log`; nơi khác cắt bớt hoặc không lưu. `user.deleted` → mỗi service xóa/ẩn danh
hoạt động của người đó. Sau này: nút "Tải dữ liệu của tôi" (mỗi service xuất phần của mình).

## Mail tài khoản: xác thực email, quên mật khẩu (chốt 2026-10-10)
**Đã tốt, giữ khi viết lại bằng Go:** trả lời giống nhau dù email có tồn tại hay không; token chỉ lưu băm, dùng 1 lần
(đặt lại 1 giờ); 1 mail / 2 phút / tài khoản + giới hạn theo IP; đặt lại mật khẩu → đăng xuất mọi thiết bị.

**Thay đổi:**
- **identity tự gửi mail tài khoản** (không qua messaging, để messaging sập vẫn đặt lại được mật khẩu): tạo token + ghi `mail_outbox`
  **cùng transaction** → tiến trình nền `identity-mail` gửi, thử lại chờ tăng dần (~1 giờ), thất bại hẳn → đánh dấu + thông báo cho Admin.
- Tạo token mới thì hủy token cũ cùng mục đích. Xác thực email 24 giờ.
- **Mail mới:** "Mật khẩu vừa được đổi" (kèm link "Không phải bạn? Khóa tài khoản ngay"); **đổi email** = xác thực email mới trước, báo email cũ.
- Giới hạn số mail/ngày/email (vd 5). **Cloudflare Turnstile** ở form đăng ký + quên mật khẩu (dùng khóa thử của Cloudflare khi chạy local).
- Token trên URL: trang `/dat-lai-mat-khau`, `/xac-thuc-email` đọc xong **xóa khỏi thanh địa chỉ**, `Referrer-Policy: no-referrer`;
  gateway không ghi query string của các đường này vào log.
- Xác thực xong → sự kiện `identity.user.email_verified`.
- **Gửi qua Gmail SMTP** (chủ dự án chọn giữ): ~500 mail/ngày, dễ vào spam, không có báo mail bị trả về. Khi chạy thật nên xem lại
  (dịch vụ gửi mail giao dịch + tên miền riêng SPF/DKIM/DMARC, có webhook báo trả về).
- **Để sau, khi đưa web ra công khai** (hiện đang chạy local): chặn chức năng với tài khoản chưa xác thực email; nhắc/dọn tài khoản
  không bao giờ xác thực.

## Log lỗi, giám sát, cảnh báo (chốt 2026-10-10)
> **Đổi 2026-10-10 (chủ dự án): bỏ container gom log/giám sát** (VictoriaLogs, VictoriaMetrics, vmalert, Alertmanager, Vector).
> Giữ: `request_id`, log JSON che dữ liệu (đọc bằng `docker compose logs … | grep <mã>`), `/health` + `/ready`, che lỗi;
> cảnh báo việc nặng (backup, mail, hàng cách ly) bằng thông báo hệ thống cho Admin. Phần **Công cụ** dưới đây không làm.
**Mã theo dõi xuyên suốt:** gateway sinh `request_id` → header `X-Request-Id` qua mọi lời gọi nội bộ → metadata sự kiện
`{request_id, event_id, causation_id}` → consumer ghi log cùng mã. Dán mã người dùng báo ("lỗi mã r-7f3a") vào ô tìm log → thấy cả chuỗi;
dòng lỗi đầu tiên = service gây lỗi; `causation_id` lần ngược cả lỗi xảy ra sau khi request đã trả lời (worker, consumer).
- Log JSON thống nhất: thời gian, service, phiên bản, `request_id`, `event_id`, route, mã trạng thái, thời gian xử lý, mã lỗi
  (`CAT-DB-001`, `WS-MERGE-409`… chỉ trong log), thông báo; `user_id` dạng băm.

**Biết service nào bị ảnh hưởng:** mỗi service `/health` + `/ready` (DB, Redis, RabbitMQ, service phụ thuộc); **bản đồ phụ thuộc**
trong plan/cấu hình → trang giám sát tô đỏ service lỗi, tô vàng service bị kéo theo + hậu quả ("workspace không gộp được…");
chỉ số: tỉ lệ lỗi, độ trễ, trạng thái ngắt mạch, outbox/hàng đợi dồn, hàng cách ly.

**Không lộ lỗi ra ngoài:** 5xx chỉ "Lỗi hệ thống (mã …)" (như `maskServerErrors` hiện tại, mã = `request_id`); 4xx chỉ câu tiếng Việt,
không SQL/đường dẫn/tên service/stack; service A gặp lỗi của B → đổi thành lỗi chung của A; gateway có trang 502/503/504 riêng;
không header `Server`/`X-Powered-By`; logger tự che mật khẩu, token, cookie, email, `Authorization`, không ghi body;
công cụ xem log chỉ `127.0.0.1` hoặc sau Cloudflare Access.

**Công cụ:** **VictoriaLogs + VictoriaMetrics + vmalert** (~100–200 MB, có giao diện web). Cảnh báo gửi **ra ngoài hệ thống** qua
**Telegram + Discord** (không đi qua messaging/gateway của chính mình). Luật: 5xx > 2%/5 phút mỗi service, p95 > 1s, `/ready` lỗi,
outbox dồn, hàng cách ly có tin, ổ đĩa sắp đầy, backup > 26h. **Giữ log: lỗi 30 ngày, log thường 14 ngày.**
Tracing chi tiết (OpenTelemetry) để sau; `request_id` đủ cho hầu hết việc tìm lỗi.

## Bảo mật (chốt 2026-10-10)
**Hiện trạng tốt:** chỉ gateway mở cổng; Postgres/Redis/ES/RabbitMQ chỉ `127.0.0.1`; nginx giới hạn tần suất; cookie `httpOnly`;
che lỗi 5xx; Trivy trong CI. **Lỗ hổng phải sửa:** token sống 30 ngày và **chứa email + vai trò**; frontend vẫn giữ token trong
`localStorage` (XSS lấy được); tài khoản mẫu kể cả `admin` dùng `password123`; Elasticsearch tắt xác thực.

**5 lớp:**
1. **Rìa mạng (DDoS, bot):** Cloudflare trước mọi thứ, máy chủ không mở cổng ra Internet (cổng gateway chỉ nghe máy/tunnel);
   luật Cloudflare cho đăng nhập/đăng ký, chặn bot; chế độ "Under Attack" khi bị đánh; chống cào truyện (giới hạn số chương/phút
   theo IP + tài khoản, bất thường → thử thách hoặc chặn tạm).
2. **Gateway:** xác thực tập trung; **xóa mọi header `X-User-*` client tự gửi** trước khi gắn header thật; **chặn `/internal/*`**
   từ ngoài; giới hạn tần suất theo IP và tài khoản, kích thước request, thời gian chờ; CSP chặt, HSTS, `X-Frame-Options`, `nosniff`.
3. **Mạng nội bộ:** mạng `edge` (gateway + service) và `data` (service + hạ tầng), gateway/frontend không chạm DB/Redis/RabbitMQ;
   **mỗi service một khóa bí mật riêng ký lời gọi nội bộ** (không dùng mTLS); mỗi database một user chỉ có quyền trên DB của mình;
   bật mật khẩu cho Elasticsearch, RabbitMQ, Redis.
4. **Danh tính & quyền:**
   - **Token mới:** token truy cập **15 phút**, chỉ chứa mã người dùng (không email); token làm mới **30 ngày** trong cookie `httpOnly`,
     **xoay vòng** mỗi lần dùng; token làm mới bị dùng lại → thu hồi cả chuỗi phiên; **bỏ `localStorage`**.
   - Thao tác nguy hiểm (khóa tài khoản, đổi vai trò, gỡ hàng loạt) phải **nhập lại mật khẩu**.
   - **Xác thực 2 lớp: chưa làm** (chủ dự án chọn), để sau.
   - Kiểm tra quyền ở **service chủ dữ liệu, mỗi lần truy cập**; không tin id client gửi (chặn đổi id trên URL để xem đồ người khác).
   - Mật khẩu **argon2id**, chặn mật khẩu yếu/đã lộ, khóa tạm sau nhiều lần sai; **xóa/đổi tài khoản mẫu `password123` trước khi chạy thật**.
5. **Dữ liệu:** email/mật khẩu/token chỉ ở identity; SQL luôn có tham số; HTML qua bộ lọc XSS; ảnh upload kiểm tra loại thật + mã hóa lại
   (sharp) để xóa mã giấu trong ảnh; bí mật trong `.env` riêng từng service, không commit, có quy trình đổi khóa; backup mã hóa;
   Dependabot + Trivy + thư viện phát hành ≥ 2 tuần.

**Chống quá tải lan dây chuyền:** lời gọi nội bộ có thời gian chờ ngắn + ngắt mạch khi lỗi liên tục; giới hạn số request đồng thời
mỗi service; consumer sự kiện tiêu thụ chậm lại khi DB quá tải; frontend tải từng phần độc lập.

**Nhật ký bảo mật + cảnh báo (identity, giữ 90 ngày):** đăng nhập thành công/thất bại, đổi mật khẩu, đổi vai trò, thu hồi phiên,
kèm IP + trình duyệt (khác nhật ký kiểm duyệt nội dung đã bỏ). Cảnh báo Admin: đăng nhập sai hàng loạt, một tài khoản đăng nhập từ
nhiều nơi lạ, tải dữ liệu bất thường, 401/403 tăng vọt.
**Khi bị xâm nhập:** thu hồi mọi phiên → đổi khóa bí mật → khôi phục backup về trước thời điểm xâm nhập (PITR).

## Quy tắc chung (bắt buộc cho mọi service)
1. **Không truy vấn chéo database.** Cần dữ liệu của service khác thì: (a) gọi API nội bộ (có cache), hoặc (b) giữ **bản sao nhỏ** cập nhật qua sự kiện.
2. **Sự kiện qua outbox:** ghi dữ liệu + dòng outbox trong cùng transaction; tiến trình đẩy lên RabbitMQ; bên nhận xử lý **idempotent**
   (nhận trùng, lệch thứ tự không sai). Tên sự kiện `<service>.<đối tượng>.<việc>` + số phiên bản/thời điểm.
3. **Xác thực một chỗ:** gateway hỏi identity, gắn `X-User-Id/X-User-Roles`; service chỉ tin header này khi request đến từ gateway
   (mạng nội bộ + header bí mật). API nội bộ giữa service chỉ mở trong mạng `data`.
4. **Hiển thị tên/ảnh người dùng:** mỗi service cần hiện tác giả giữ bảng `user_profiles` nhỏ (id, username, tên, ảnh, vai trò công khai)
   cập nhật từ sự kiện `identity.user.updated`, không gọi identity cho từng dòng.
5. **Quyền theo truyện/nhóm:** catalog là nguồn duy nhất; service khác hỏi `GET /internal/permissions?user=&story=` (cache Redis ngắn,
   xóa khi có `catalog.group.member_changed`, `catalog.story.updated`).
6. **Mã thông minh** (`/ma/:code`): tiền tố cho biết service (U- identity, LN/MG/G catalog, P-/RP- community, AL- library); mỗi service tự tra mã của mình.
7. Mỗi service có: `/health`, log có `request_id` (gateway sinh), migration riêng (`services/<tên>/migrations`), Dockerfile, job CI riêng.

## Danh sách sự kiện chính (bản đầu, chốt ở giai đoạn A)
- identity: `user.created`, `user.updated` (tên/ảnh/vai trò), `user.banned`, `user.deleted`
- catalog: `story.created|updated|removed|restored|deleted`, `group.member_changed`, `chapter.published|deleted` (sau khi áp dụng từ workspace)
- workspace: `revision.merged` (catalog dựng bản đọc), `draft.submitted|returned`, `task.assigned`
- library: `story.followed|unfollowed`, `chapter.read`
- community: `post.created|removed|restored`, `comment.created`, `reaction.added`, `report.created`
- messaging: tiêu thụ hầu hết sự kiện trên để tạo thông báo; không phát nhiều
- recommender: tiêu thụ `chapter.read`, `story.followed`, `story.*`; không phát

## Trang ghép từ nhiều service (frontend gọi song song)
- Trang truyện: catalog (truyện, chương) + library (đã theo dõi?) + community (bình luận, số bài thảo luận) + recommender (liên quan).
- Hồ sơ người dùng: identity (hồ sơ) + catalog (truyện đã đăng, nhóm) + community (bài viết) + library (album công khai).
- Mỗi phần tải độc lập: một service chậm/hỏng chỉ làm trống phần đó, trang vẫn hiện.

---

## Lộ trình tách (strangler: backend hiện tại co dần, cuối cùng chính nó thành `catalog`)

### Giai đoạn 0: backup (LÀM TRƯỚC TIÊN, kể cả trước khi tách gì)
Hiện trạng 2026-10-09: **chưa có backup nào** (không pg_dump, `archive_mode = off`, `uploads/` 351 MB không sao lưu; DB 28 MB).
Thiết kế service `backup`:
- **Postgres, 2 lớp:**
  - Bản đầy đủ hằng ngày + **lưu WAL liên tục** (pgBackRest hoặc WAL-G): khôi phục về **bất kỳ thời điểm nào** (mất tối đa vài phút dữ liệu),
    cho mọi database trên máy Postgres (hiện `novel_platform`, sau này từng `*_db` của các service).
  - `pg_dump` từng database hằng ngày: dễ đọc, khôi phục riêng một service, dùng khi nâng cấp Postgres (đổi major không dùng lại volume được).
- **Tệp `uploads/`:** sao lưu tăng dần (restic): chỉ gửi tệp mới/đổi, mã hóa, khử trùng lặp.
- **Không sao lưu** (dựng lại được): Redis (cache), Elasticsearch (search dựng lại index từ các service), RabbitMQ (outbox phát lại), `image_cache`.
- **Quy tắc 3-2-1:** bản trên máy (khôi phục nhanh) + **bản ngoài máy** (ổ khác / cloud) để sống sót khi hỏng ổ hoặc mất máy; bản ngoài máy **mã hóa**.
- **Giữ bản:** WAL 7 ngày · bản ngày 14 · bản tuần 8 · bản tháng 12 (chốt lại theo dung lượng kho).
- **Tự kiểm tra:** mỗi tuần khôi phục bản mới nhất vào database tạm, so số bảng/dòng với thật, ghi kết quả. Backup chưa thử khôi phục coi như không có.
- **Báo lỗi:** backup/khôi phục thử thất bại hoặc quá 26 giờ không có bản mới → báo Admin (qua messaging, tạm thời qua mail).
- **Trước việc rủi ro:** `scripts/migrate.sh`, nâng cấp, chuyển dữ liệu khi tách service → tự chụp một bản trước.
- **Khôi phục:** script + hướng dẫn từng bước (DB theo thời điểm và `uploads/`), **không** có nút khôi phục trên web (quá nguy hiểm).
  Trang Admin chỉ xem trạng thái: bản gần nhất, dung lượng, lần thử khôi phục gần nhất.
- Nhiều service: khôi phục mọi database về **cùng một thời điểm**; sau đó chạy lại outbox để sự kiện không mất.

**Kho lưu trữ (vai trò thứ hai của backup, chủ dự án yêu cầu 2026-10-09):** nội dung bị **xóa thật** (truyện, bài viết hết 30 ngày
thùng rác) vẫn được backup giữ lại, gọn và **tìm lại được**, tách biệt với bản sao lưu chống sự cố (vốn chỉ khôi phục cả database).
- Nhận từng phần qua API nội bộ (quy trình xóa thật ở mục "Gỡ, xóa, khôi phục"), chỉ trả OK khi đã ghi chắc chắn.
- **Lưu gọn:** mỗi mục một gói JSON nén (zstd); đoạn văn chương lưu theo **hash** (trùng với cách workspace lưu, nên các phiên bản
  gần giống nhau gần như không tốn thêm chỗ); ảnh lưu theo hash (khử trùng lặp); nén theo lô.
- **Tìm lại dễ:** `backup_db.archived_items` (loại, id, mã thông minh, tên, chủ, username lúc xóa, ngày xóa, kích thước, vị trí gói,
  chỉ mục tìm kiếm tiếng Việt bỏ dấu) → trang Admin "Kho lưu trữ": tìm theo mã, tên, người đăng, khoảng ngày; xem lại nội dung (chỉ đọc).
- **Khôi phục từ kho:** Admin chọn mục → backup gửi lại từng phần cho service tương ứng qua API nhập nội bộ (UUID giữ nguyên).
- Kho lưu trữ cũng phải nằm trong bản sao lưu ngoài máy (3-2-1).
- Lưu ý pháp lý/riêng tư: người dùng tưởng đã xóa nhưng hệ thống vẫn giữ → ghi rõ trong điều khoản sử dụng; **không** lưu thông tin
  đăng nhập (email, mật khẩu, token) của người dùng vào kho.
- [ ] Kho lưu trữ: API nhận phần, lưu gói nén + hash, `archived_items` + tìm kiếm, trang Admin, khôi phục từ kho

- [x] Chốt (2026-10-10): máy **chỉ có một ổ** → chưa có bản ngoài máy; RPO **1 ngày** (chỉ `pg_dump` hằng đêm, **không** WAL);
      giữ bản ngày 14 · tuần 8 · tháng 12. Rủi ro còn lại: hỏng ổ/mất máy là mất cả web lẫn backup (ghi trong README).
- [x] Container `backup` (postgres:16-alpine + restic, crond): kho restic `./backups` trên host, `RESTIC_PASSWORD` trong `.env` (launch.py tự sinh)
- [x] `pg_dump` từng database + globals hằng đêm; sao lưu `uploads/`; `restic forget --prune` theo lịch giữ
- [ ] Đẩy bản ra ngoài máy: hoãn cho tới khi có ổ thứ hai/cloud (`restic copy` sang kho mới là xong)
- [x] Tự thử khôi phục hằng tuần (`restic check` + khôi phục dump vào DB tạm, so số bảng/dòng) + báo lỗi (thông báo cho Admin, quá 26 giờ không có bản mới)
- [x] `scripts/migrate.sh` và `launch.py` chụp bản trước khi chạy
- [x] Script + hướng dẫn khôi phục (`scripts/restore.sh`): đã thử khôi phục DB vào DB riêng và `uploads/` (giống hệt); `--replace` chưa thử trên DB thật
- [x] Trang trạng thái backup cho Admin (`/tai-khoan` → quản trị); README mục "Sao lưu & khôi phục"
- [x] Chủ dự án duyệt giao diện → commit/push/PR (nhánh `chore/backup`)

Bẫy (backup):
- `set -e` bị shell **bỏ qua** bên trong `if`/`&&`/`||` (kể cả trong hàm được gọi từ đó): bước lỗi vẫn chạy tiếp và báo thành công.
  Chạy việc chính bằng câu lệnh thường trong subshell `(set -e; …)` rồi đọc `$?`.
- restic gom snapshot theo **host**: hostname container đổi mỗi lần tạo lại → luôn `--host nmv`, nếu không `forget` không dọn được bản cũ.
- `restic dump latest` với nhiều database: phải lọc `--path /<db>.dump`, chỉ `--tag db` sẽ lấy nhầm dump của DB khác.
- busybox crond chỉ nạp lại crontab khi có `/etc/crontabs/cron.update`.

Bẫy (giai đoạn A):
- nginx: `location` nào có `proxy_set_header` riêng thì **không kế thừa** header nào của `server` → lặp lại đủ ở location đó.
- Gateway chỉ nghe `127.0.0.1`: trên Windows, công cụ không tự thử song song IPv4/IPv6 (Python `urllib`) gọi `localhost` mất ~10 giây vì thử `::1` trước
  (Docker Desktop không nghe được `[::1]`) → script dùng `127.0.0.1`; trình duyệt, curl, Node không bị.
- `fetch()` của Node từ chối URL có `user:pass@` → mật khẩu ES gửi qua header `Authorization`.
- Đo tải từ một máy: đừng lách giới hạn theo IP (giả `CF-Connecting-IP`); đo độ trễ ở tốc độ dưới giới hạn.
- Git Bash đổi đường dẫn trong `-v host:/ctr` → `MSYS_NO_PATHCONV=1` + `pwd -W`.

### Giai đoạn A: nền móng (chưa tách service nào)
- [ ] Cấu trúc repo: `services/<tên>/` cho service mới, thư viện dùng chung TS (`packages/shared`: outbox, consumer RabbitMQ, đọc header xác thực, log)
- [ ] Postgres: tạo các database theo service + user riêng mỗi database; PgBouncer cấu hình pool theo database
- [ ] RabbitMQ: exchange `novelhub.events` (topic), quy ước tên sự kiện, dead-letter queue
- [ ] Bảng `outbox` + tiến trình đẩy (xác nhận của RabbitMQ) và consumer idempotent (bảng `inbox`, so `version`, ack sau commit,
      thử lại chờ tăng dần, hàng cách ly) trong thư viện dùng chung TS + Go (+ bản nhận của Python)
- [ ] JSON Schema cho mọi sự kiện + test hợp đồng trong CI; quy tắc đổi schema (chỉ thêm trường, phá vỡ → `v2`)
- [ ] Công cụ `republish` (phát lại sự kiện theo loại/id) và API xuất nội bộ phân trang để dựng lại bản sao
- [ ] Job đối soát đêm + cảnh báo (outbox dồn, hàng cách ly, consumer chậm, lệch dữ liệu)
- [x] Log JSON + che dữ liệu nhạy cảm cho backend/worker hiện có (`backend/src/utils/logger.ts`, AsyncLocalStorage giữ `request_id`) và gateway
- [ ] Log JSON + che dữ liệu cho Go/Python (làm cùng service Go đầu tiên); `request_id` qua HTTP nội bộ và metadata sự kiện
- [x] ~~VictoriaLogs + VictoriaMetrics + vmalert, cảnh báo Telegram + Discord, bản đồ phụ thuộc~~: **bỏ** (chủ dự án, 2026-10-10)
- [ ] `/health` + `/ready` mọi service (làm cùng từng service); trang lỗi 502/503/504 riêng ở gateway
- [x] Gateway: `request_id` (sinh mới, ghi đè giá trị client, trả về trình duyệt, là mã lỗi 5xx người dùng thấy)
- [ ] Gateway: định tuyến theo tiền tố, `auth_request` (làm cùng identity)
- [ ] CI build/test theo từng thư mục service; `launch.py` + `scripts/migrate.sh` chạy migration cho mọi database
- [x] Đo tải hiện tại: `scripts/bench.mjs`. Mốc 2026-10-10 (máy dev, có cache, ~15 req/s): `/stories/trending` p50 3 ms; chi tiết truyện API 7 ms;
      trang truyện 9 ms (p95 10); đọc chương API 7 ms; trang chương 9 ms (p95 12)
- [x] Bảo mật nền (phần làm được ngay): gateway xóa `X-User-*` client gửi, chặn `/internal`, CSP/HSTS (đã có); mật khẩu Elasticsearch;
      cổng gateway mặc định `127.0.0.1` (`GATEWAY_BIND`); sửa lỗi nginx: `location /` và `/socket.io/` mất `X-Forwarded-For`/`Host`
- [ ] Khóa ký nội bộ riêng từng service (cùng service đầu tiên); luật Cloudflare (đăng nhập, bot, chống cào: cần tài khoản Cloudflare của chủ dự án)
- [ ] Thư viện dùng chung: thời gian chờ + ngắt mạch cho lời gọi nội bộ, giới hạn request đồng thời

### Giai đoạn B: identity
- [ ] Service identity + `identity_db`; chuyển bảng users, user_roles, token/cài đặt
- [ ] `/internal/verify` + gateway `auth_request` (cache ngắn); backend cũ đọc header thay vì tự verify JWT
- [ ] Sự kiện `user.*`; bảng `user_profiles` ở backend cũ cập nhật từ sự kiện (bỏ JOIN users)
- [ ] Chuyển khóa/xóa tài khoản, phân quyền site, gửi mail
- [ ] Token mới: truy cập 15 phút (chỉ mã người dùng) + làm mới 30 ngày cookie `httpOnly` xoay vòng, phát hiện dùng lại → thu hồi chuỗi;
      frontend bỏ `localStorage`, tự làm mới token
- [ ] Mật khẩu argon2id (đổi dần khi người dùng đăng nhập), chặn mật khẩu yếu/đã lộ, khóa tạm khi sai nhiều; nhập lại mật khẩu cho thao tác nguy hiểm
- [ ] Nhật ký bảo mật (90 ngày) + cảnh báo Admin; nút "thu hồi mọi phiên" toàn hệ thống
- [ ] Bảng `sessions` + Redis `sess:`/`revoked:`; cookie `nh_access`/`nh_refresh`/`nh_csrf`/`nh_vid`; chống CSRF cho request ghi;
      trang "Thiết bị đang đăng nhập"; cài đặt đọc đồng bộ lên DB; gộp lịch sử khách vào tài khoản khi đăng nhập
- [ ] Test bảo mật trước khi chuyển: đăng nhập, khóa, thu hồi phiên, đặt lại mật khẩu, giả header, đổi id trên URL
- [ ] Xóa/đổi mật khẩu tài khoản mẫu trước khi chạy thật
- [ ] Mail tài khoản: `mail_outbox` + tiến trình `identity-mail` (thử lại, cảnh báo), mail "mật khẩu vừa đổi", luồng đổi email,
      hủy token cũ, giới hạn mail/ngày/email, Turnstile (đăng ký, quên mật khẩu), xóa token khỏi URL + `no-referrer` + không log query
- [ ] (Khi công khai) chặn chức năng với tài khoản chưa xác thực; nhắc/dọn tài khoản không xác thực; xem lại nhà cung cấp mail

### Giai đoạn C: workspace (Go), làm theo `Plan/chapter-workspace.md`
- [ ] Backend cũ (đang đóng vai catalog) mở `/internal/permissions` và nhận `revision.merged` để dựng bản đọc
- [ ] Các giai đoạn 1–4 của plan workspace; chuyển một lần, tắt đường đăng/sửa chương cũ

### Giai đoạn D: media
- [ ] Upload, đổi kích thước ảnh, xuất EPUB/PDF (export-worker hiện có chuyển sang đây); gateway định tuyến `/uploads`, `/api/media`

### Giai đoạn E: messaging
- [ ] Tin nhắn riêng, chat nhóm, hộp thông báo, worker phân phát thông báo (worker hiện có chuyển sang đây), viết bằng Go
- [ ] Realtime: WebSocket thường (Go) thay Socket.IO; sửa client realtime ở frontend (kết nối lại tự động, nhận sự kiện theo loại)
- [ ] Chịu tải: `ulimit -n` cho container, nginx `worker_connections`/`worker_rlimit_nofile`, chỉ người đăng nhập mới mở kết nối,
      đóng khi tab ẩn lâu, ping ~30s, giới hạn số tab/tài khoản, client kết nối lại **chờ ngẫu nhiên tăng dần**, kênh Redis theo user/hội thoại
- [ ] **Thử tải thật** (client giả lập bằng Go/k6): 10k → 30k → 100k kết nối giữ lâu + gửi tin + thông báo hàng loạt; ghi RAM/CPU
      mỗi kết nối, độ trễ; ước tính máy hiện tại (~7,6 GB) chịu ~10–30k, trên 100k cần nhiều bản `messaging-realtime` ở máy riêng
      + nhiều bản cloudflared
- [ ] Cấu trúc "cuộc trò chuyện" (chuyển `direct_messages`, `group_messages`), `last_read_message_id`, phân trang theo id
- [ ] Gộp thông báo cùng loại; bản sao người theo dõi; thông báo toàn site 1 dòng; dọn đã đọc 30 ngày / chưa đọc 60 ngày
- [ ] Bảng `notifications` mới (category, type chuỗi, actors, data ảnh chụp, group_key, seen/read); chuyển dữ liệu cũ từ enum
- [ ] Danh mục loại thông báo + danh sách không tắt được; chuông (chưa xem/chưa đọc, tab), trang `/thong-bao`, cài đặt nhóm × kênh
- [ ] (Sau, cùng workspace giai đoạn 4) đính kèm bản nháp trong tin nhắn
- [ ] Thông báo chương mới: lấy danh sách người theo dõi từ library (tạm thời từ backend cũ)

### Giai đoạn F: community
- [ ] Bài Fandom, bình luận, cảm xúc, báo cáo, nội dung đã gỡ (truyện đã gỡ nhận qua `story.removed/restored`)

### Giai đoạn F2: search
- [ ] search-service nhận sự kiện từ catalog, community, identity; chuyển Elasticsearch từ backend cũ sang (index truyện hiện có)
- [ ] Index bài viết, nhóm, người dùng; API `/search`, `/search/suggest`; ô tìm chung ở menu (nhóm theo loại)
- [ ] Dựng lại index qua alias; SQL dự phòng cho trang khám phá
- [ ] Tìm riêng tư bằng `pg_trgm` + `unaccent` ở messaging, community, identity (thay `ILIKE` hiện tại)
- [ ] Từ khóa hot + trang Admin xem từ khóa không ra kết quả

### Giai đoạn G: library
- [ ] Theo dõi, bookmark, lịch sử đọc (gom qua Redis như lượt xem), album; phát `chapter.read`, `story.followed`
- [ ] Vị trí đọc (% cuộn) + "Đọc tiếp" đúng đoạn; `ext_stories` cho `/lich-su`; giới hạn ~1.000 truyện/người; gộp lịch sử khách

### Giai đoạn H: recommender (Python)
- [ ] Viết lại bằng Python: nhận sự kiện thay vì đọc DB chung (thư viện nhận sự kiện bản Python + JSON Schema)
- [ ] Huấn luyện là job theo lịch (chạy xong thoát); so chất lượng gợi ý với thuật toán TS hiện tại trước khi thay
- [ ] API gợi ý (FastAPI) đọc kết quả tính sẵn: trang chủ, truyện liên quan

### Giai đoạn I: catalog (phần còn lại của backend cũ)
- [ ] Đổi tên backend còn lại thành `catalog`, xóa code đã chuyển đi, dọn bảng thừa trong `catalog_db`
- [ ] Cài đặt quy trình nhóm (bước bật, ai được gộp) + API quyền trả về cho workspace; kệ "Đang hot" tính sẵn vào Redis
- [ ] Đo lại tải so với mốc ở giai đoạn A; README viết lại phần kiến trúc

## Rủi ro / bẫy
- Số container tăng (~10 → ~17): kiểm tra RAM máy chạy; service nhỏ đặt giới hạn bộ nhớ trong compose.
- Hai nơi cùng ghi một dữ liệu trong lúc chuyển: mỗi giai đoạn **chuyển một lần** (dừng ghi ngắn, chép bảng, bật service mới), không chạy song song.
- Nhất quán sau (eventual consistency): giao diện phải chịu được độ trễ vài trăm ms (ví dụ vừa gộp chương xong, trang đọc cập nhật sau).
- Lỗi một service không được kéo sập trang: frontend tải từng phần độc lập, timeout ngắn cho API nội bộ.
- PgBouncer transaction mode vẫn áp dụng cho mọi service (không advisory lock theo phiên, `SET LOCAL`).
