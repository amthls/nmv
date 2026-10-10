# Workspace quản lý chương: nhánh chính thức + bản nháp (kiểu PR)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Plan này làm trên nhánh riêng (`feat/chapter-workspace`), tạo **sau khi** `feat/no-approval` đã commit/merge.

## Đã chốt với chủ dự án (2026-10-09)
- Mỗi truyện có **nhánh chính thức**: các chương độc giả thấy + **lịch sử phiên bản** của từng chương, rewind được.
- Hai vai cho mỗi truyện:
  - **Người giữ truyện**: chủ truyện; nếu là truyện của nhóm thì thêm leader + mod nhóm. Được gộp đề xuất, sửa thẳng bản chính, rewind, giao việc.
  - **Người đóng góp**: thành viên nhóm + cộng tác viên. Tạo nháp, gửi đề xuất.
  - (Đổi so với `feat/no-approval`: thành viên thường không tự đưa vào chính thức nữa, phải qua người giữ truyện gộp.)
- Nháp có **một chủ**, không sửa chung **cùng lúc**. Có **nhận chương / giao việc** để khỏi trùng.
- Nhờ người khác sửa nháp, **ba** cách: *nhờ góp sức* (họ sửa trên bản sao, chủ nháp nhận cả bản hoặc từng đoạn), *giao hẳn*
  (chuyển quyền sở hữu nháp), và *cấp quyền sửa* (cập nhật 2026-10-09): người được cấp sửa thẳng vào nháp **luân phiên**:
  một người giữ **khóa sửa** tại một thời điểm, khóa tự nhả sau vài phút không gõ, mỗi lần lưu ghi lại ai sửa.
- Chia sẻ nháp qua **tin nhắn** (messaging): thẻ "bản nháp" trong hội thoại; chỉ thành viên nhóm của truyện (hoặc đội truyện nếu
  truyện không thuộc nhóm) mở được; từ thẻ: Xem · Tạo bản sao của tôi · Sửa (nếu được cấp quyền).
- Nháp **cập nhật theo bản chính** (kiểu `git pull`): đoạn chỉ bản chính sửa → tự lấy; đoạn cả hai cùng sửa → người dùng chọn.
- Plan ở dạng file này.

## Ba nguyên tắc
1. Bản chính thức **không bao giờ bị ghi đè**: gộp, sửa thẳng, rewind, xóa chương đều tạo **phiên bản mới** (vN+1).
2. Mọi sửa đổi đi qua **một bản nháp** có ghi *dựa trên gì* (chính thức vN, hoặc nháp của người khác). "Sửa thẳng" = nháp được gộp ngay.
3. Nháp chỉ **chủ của nó** và **người được chủ cấp quyền sửa** gõ vào được, mỗi lúc một người (khóa sửa);
   người khác giúp bằng bản sao của họ hoặc nhận chuyển giao.

## Các tình huống phải chạy đúng
| # | Tình huống | Xử lý |
|---|---|---|
| 1 | Người giữ truyện sửa chương đã đăng | "Sửa" → phiên bản mới ngay; hoặc "Mở nháp" nếu muốn người khác xem trước |
| 2 | Thành viên sửa chương đã đăng | "Đề xuất sửa" → nháp từ bản chính hiện tại → gửi → người giữ truyện gộp |
| 3 | Nháp đã gộp, muốn sửa tiếp | Nháp đã gộp đóng (chỉ đọc). "Sửa tiếp" tạo nháp **mới** từ bản chính mới nhất |
| 4 | Đề xuất bị trả lại kèm góp ý | Cùng nháp đó quay về chủ; gửi lại → người duyệt thấy "thay đổi từ lần gửi trước" |
| 5 | Nhờ người khác sửa nháp của mình | (a) chia sẻ → họ tạo bản sao, sửa, gửi lại → chủ nhận cả bản/từng đoạn; (b) giao hẳn quyền sở hữu; (c) cấp quyền sửa → sửa luân phiên có khóa |
| 5b | Gửi nháp qua tin nhắn | Thẻ nháp trong hội thoại (messaging chỉ lưu `draft_id`); workspace kiểm tra quyền khi mở; người ngoài nhóm thấy "không có quyền xem" |
| 5c | Hai người được quyền sửa cùng mở nháp | Người thứ hai thấy "@A đang sửa", chỉ xem; khi A rời/hết thời gian khóa thì nhận khóa |
| 6 | Người giữ truyện nhờ người khác sửa bản chính | "Giao việc: sửa chương N" cho @X → X tạo nháp → đề xuất → gộp → việc tự đóng |
| 7 | Hai người cùng sửa một chương | Cho phép, có cảnh báo "đã có người nhận/đang sửa"; người sau **pull** trước khi gộp |
| 8 | Bản chính đổi trong lúc đang viết nháp | Cảnh báo "bản chính đã đổi (v3 → v5)" → nút **Cập nhật theo bản chính** (pull) |
| 9 | Rewind | Chọn vK → tạo vN+1 = nội dung vK; nháp đang mở thấy cảnh báo ở #8 |
| 10 | Chương mới | Nháp ghi số chương dự kiến; gộp → tạo chương v1; hai nháp cùng số → cảnh báo |
| 11 | Xóa chương | Là một phiên bản "đã xóa", khôi phục được |
| 12 | Thành viên rời nhóm | Nháp vẫn của họ; người giữ truyện đọc được và "nhận lại" để không mất công dịch |
| 13 | Truyện bị Admin/Mod gỡ | Workspace vẫn mở cho đội truyện (đọc + nháp), không gộp được cho tới khi khôi phục |

## Nhóm dịch: quy trình theo vai trò + WS nhóm (chốt 2026-10-10)
- Vai trò trong nhóm **có tác dụng thật**: mỗi chương đi qua các bước, mỗi bước là một **việc** (`chapter_tasks.kind`) cho đúng vai trò:
  **RAW** (raw_provider tải bản gốc) → **DỊCH** (translator tạo nháp) → **BIÊN TẬP** (editor sửa trên nháp, cấp quyền sửa luân phiên)
  → **HIỆU ĐÍNH** (proofreader) → **GỘP** (leader/mod). **Mỗi nhóm tự chọn bước** (nhóm nhỏ: DỊCH → GỘP); cài đặt lưu ở catalog.
- Xong một bước → việc bước sau tự mở cho vai trò kế tiếp (thông báo cho người được giao / cả vai trò).
- **WS nhóm** `/ws/nhom/:slug` (ghép, nhóm không có kho riêng): tổng quan (đang làm, chờ gộp, sắp trễ hạn) · **bảng việc** dạng cột
  (Chưa nhận / Đang làm / Chờ duyệt / Đã đăng; lọc theo truyện, người) · đề xuất chờ gộp · truyện của nhóm (catalog) · thành viên,
  vai trò, mời/duyệt xin vào (catalog) · cài đặt quy trình + ai được gộp (catalog) · chat nhóm (messaging) ·
  hoạt động gần đây (`ws_activity`).
- WS cá nhân = cùng bảng việc lọc "việc của tôi ở mọi nhóm"; WS nhóm = lọc "mọi việc của nhóm" → không chồng nhau.
- **Hẹn giờ đăng:** gộp xong chọn thời điểm; workspace giữ, đến giờ mới phát `revision.merged` (catalog dựng bản đọc, báo người theo dõi).
  Trước giờ đăng, người giữ truyện còn đổi giờ hoặc hủy.

## Workspace = một dữ liệu, ba cách xem
- **WS cá nhân** `/ws`: truyện tôi giữ/tham gia · **Nháp của tôi** (mọi truyện) · **Được nhờ** (nháp chia sẻ cho tôi, việc giao cho tôi).
- **WS truyện** `/ws/truyen/:slug`: chương chính thức + lịch sử · đề xuất đang chờ · việc đang giao · ai nhận chương nào.
- **Nhóm dịch**: chỉ tổng hợp từ các truyện của nhóm, không có kho riêng → không thể xung đột.
- Nháp "đang viết" chỉ chủ + người được chia sẻ thấy; "đã gửi" thì người giữ truyện thấy.

## Bẫy đã phát hiện
- Chương nhập cũ lưu đoạn thường là `{text}`, trình soạn thảo gửi lại `{html:"<p>…</p>", text}`: khác hash → diff3 coi cả chương là
  xung đột. Sửa ở `canonicalBlock` (bỏ html thừa trước khi băm) + bước một-lần đổi hash đoạn cũ (`go:canonical_block_hash`).
- Trình soạn thảo **không giữ mã đoạn**: server đặt lại `b1, b2…` theo vị trí mỗi lần lưu (`normalizeContentBlocks`,
  `dang-chuong/page.tsx` không gửi `id`). Chèn một đoạn là lệch mọi mã → **không trộn theo mã đoạn được**.
  Cách làm: so theo **nội dung** từng đoạn (hash), thuật toán **diff3** trên dãy đoạn, như git so theo dòng.
- `chapter_submissions` (luồng duyệt cũ) đã có nhiều bản/chương + `is_active`: chuyển thành bảng nháp, đừng xây song song.
- PgBouncer chế độ transaction: khóa khi gộp dùng `SELECT … FOR UPDATE` trong transaction, không dùng advisory lock theo phiên.
- Dữ liệu hiện có (2026-10-09): 147 chương có block, trung bình ~10 KB, lớn nhất ~86 KB, ~68 đoạn/chương.

---

## Giai đoạn 0: thiết kế backend / database (làm cùng chủ dự án, chưa code)

**Đã chốt (2026-10-09):** quy mô mục tiêu *vừa* (chục nghìn truyện, vài trăm người dịch cùng lúc) · lưu nội dung **theo đoạn,
khóa là hash** · **giữ lịch sử mãi** · nháp không tự xóa, chỉ giới hạn số nháp đang mở mỗi người ·
**tách thành service riêng + DB riêng** (`workspace-service`).

**Chốt thêm:** DB workspace = **database riêng trên cùng máy Postgres** (tách container sau được) · quyền lấy qua
**API nội bộ + cache Redis** · **chuyển một lần** (nhập chương cũ thành v1, tắt đường đăng/sửa cũ cùng lúc) · service viết bằng **Go**.
Workspace là một phần của kiến trúc nhiều service: xem `Plan/microservices.md` (thứ tự tách, gateway, sự kiện dùng chung).

**Kiến trúc:**
- `workspace-service` (Go) + database riêng `ws_db`: **nguồn sự thật duy nhất của nội dung chương**
  (đoạn, phiên bản, nháp, lần gửi, chia sẻ, giao việc, góp ý).
- Backend chính giữ user, nhóm, truyện; bảng `chapters` thành **bản sao để đọc**, chỉ cập nhật khi nhận sự kiện.
  Bỏ đường ghi cũ `PUT /chapters/:id`, `POST /chapters/submissions` (không để hai nơi cùng ghi).
- Gộp → transaction DB workspace ghi phiên bản + dòng **outbox** → đẩy `chapter.published` lên RabbitMQ → backend chính
  áp dụng theo số phiên bản (trùng/lệch thứ tự thì bỏ qua) → bảng `chapters`, xóa cache, báo người theo dõi, cập nhật tìm kiếm.
- Chiều ngược lại: truyện bị gỡ/khôi phục/xóa, thành viên nhóm đổi → sự kiện sang workspace (khóa gộp, xóa cache quyền).
- Quyền: workspace hỏi backend chính qua HTTP nội bộ (chỉ mạng `data`), cache Redis ngắn, xóa cache khi có sự kiện.
- Gateway: `/api/ws/*` → workspace-service; dùng chung JWT. Ảnh manga vẫn upload qua backend chính.
- Bẫy: hai DB không chung transaction → mọi thứ qua outbox + xử lý idempotent; backup và migration cho cả hai DB
  (`launch.py`, `scripts/migrate.sh`, CI build thêm image).

Mục tiêu: đường đọc của độc giả **không chậm đi chút nào**, thao tác workspace nhẹ, không quá tải.
Đề xuất ban đầu để thảo luận, chốt từng mục rồi mới code:
- [x] **Tách đường đọc và đường viết**: độc giả vẫn đọc bảng `chapters` (bản phẳng hiện tại, có cache Redis);
      lịch sử/nháp nằm bảng riêng, chỉ workspace chạm tới. Gộp = cập nhật bản phẳng trong cùng transaction.
- [x] **Lưu đoạn theo nội dung (content-addressed)**: bảng `content_blocks(hash PK, data JSONB)`; phiên bản và nháp chỉ lưu
      **mảng hash**. Sao chép nháp, rewind, chụp mỗi lần gửi gần như miễn phí; diff = so hai mảng hash (không so chữ trên server).
- [x] Bảng: `chapter_revisions` (chapter, số phiên bản, mảng hash, tác giả, nguồn: nháp/sửa thẳng/rewind/xóa),
      `chapter_drafts` (chủ, truyện, chương hoặc số chương mới, dựa trên revision/nháp nào, trạng thái, mảng hash, `version` để chống ghi đè),
      `draft_rounds` (chụp mỗi lần gửi), `draft_shares`, `chapter_tasks` (giao việc/nhận chương), góp ý theo đoạn.
- [x] **Lưu nháp tự động**: client gom thay đổi (debounce vài giây), chỉ gửi đoạn đổi; khóa lạc quan bằng `version` (2 tab không đè nhau).
- [x] **Gộp/pull**: diff3 trên mảng hash ở server (rẻ: ~70 phần tử); kiểm tra `current_revision` đúng như lúc mở (compare-and-swap) + `FOR UPDATE`.
- [x] So sánh chữ trong một đoạn (word diff) làm ở **trình duyệt**, chỉ cho đoạn đã đổi.
- [x] Manga: đoạn = trang ảnh (tham chiếu URL), không chép ảnh.
- [x] Danh sách workspace: index theo (chủ nháp), (truyện, trạng thái), (người được giao); phân trang theo khóa; bộ đếm "đề xuất đang chờ".
- [x] Thông báo (gửi, trả lại, gộp, giao việc) đi qua hàng đợi RabbitMQ có sẵn; tìm kiếm chỉ cập nhật khi bản chính đổi.
- [x] Dọn rác: **giữ luôn** (khớp "giữ lịch sử mãi"; ~10 KB/chương, cả web hiện ~700 KB nội dung).
- [x] Giới hạn: tối đa **50 nháp đang mở/người**; phiên bản giữ hết.
- [x] Viết bản thiết kế chốt (schema SQL + API) vào cuối file này.

## Thiết kế chốt (2026-10-10)

**Lọc HTML (chủ dự án chọn 2026-10-10):** nội dung chương **luôn đi qua backend** (bộ lọc `sanitize-html` hiện có), backend gọi API nội bộ của
workspace. Workspace không nhận HTML trực tiếp từ trình duyệt → chỉ có một bộ lọc. Thao tác không mang nội dung mới (xem lịch sử, so sánh,
rewind, gộp, pull chọn đoạn theo hash) gọi thẳng workspace qua gateway `/api/ws/*`.

**Quyền** (backend là nguồn, `GET /internal/permissions?user=&story=` → `{keeper, contributor, removed}`, workspace cache 30 s):
người giữ truyện = chủ truyện, hoặc leader/mod nhóm của truyện; người đóng góp = người giữ + thành viên nhóm + cộng tác viên.

**`ws_db` (giai đoạn 1):**
```sql
content_blocks (hash TEXT PRIMARY KEY,          -- sha256 của JSON chuẩn hóa của đoạn (không gồm id vị trí)
                data JSONB NOT NULL)
chapter_heads  (chapter_id UUID PRIMARY KEY,    -- cùng UUID với catalog.chapters
                story_id UUID NOT NULL, current_version INT NOT NULL, deleted BOOLEAN NOT NULL)
chapter_revisions (chapter_id UUID, version INT, story_id UUID,
                meta JSONB NOT NULL,             -- title, chapter_number, volume_id, intro_note, outro_note
                blocks TEXT[] NOT NULL,          -- mảng hash theo thứ tự
                deleted BOOLEAN NOT NULL, source TEXT NOT NULL, -- import | create | edit | rewind | delete | restore
                based_on INT, author_id UUID, created_at TIMESTAMPTZ, PRIMARY KEY (chapter_id, version))
outbox (như identity)
```
Giai đoạn 2+ thêm `chapter_drafts`, `draft_rounds`, `draft_shares`, `chapter_tasks`, `ws_activity`.

**API nội bộ (backend → workspace, `X-Internal-Auth`):** `POST /internal/chapters` (tạo, v1) · `POST /internal/chapters/{id}/revisions`
(sửa; `expected_version` để chống ghi đè) · `POST /internal/chapters/{id}/delete` · `GET /internal/chapters/{id}` (bản hiện tại).
Mỗi lần trả về revision đầy đủ để backend **áp dụng ngay** vào bản đọc (trang chuyển hướng sang chương mới không phải chờ sự kiện).
**API công khai `/api/ws/*`** (header ký, như backend): `GET chapters/{id}/revisions` · `GET chapters/{id}/revisions/{v}` ·
`GET chapters/{id}/compare?from=&to=` (diff theo hash, LCS) · `POST chapters/{id}/rewind {to_version}` (người giữ truyện; tạo vN+1).

**Sự kiện** `workspace.revision.merged {chapter_id, story_id, version, deleted, meta, blocks[] (đầy đủ), author_id, source}` → backend áp dụng
nếu `version` mới hơn `chapters.ws_version` (idempotent, cùng hàm với áp dụng đồng bộ). Xóa chương: backend xóa dòng đọc nhưng **giữ bình luận**
(khôi phục = phiên bản mới, cùng UUID, bình luận gắn lại). Thông báo người theo dõi chỉ khi chương mới (v1, nguồn `create`).

**Chuyển một lần:** `workspace import` đọc `GET backend /internal/chapters/export` (phân trang) → mỗi chương thành v1 (`source=import`), bỏ qua
chương đã có head; chạy trong `migrate.sh`/`launch.py` như identity. Nháp cũ (`chapter_submissions` draft) giữ nguyên tới giai đoạn 2.

## Giai đoạn 1: lịch sử phiên bản bản chính
- [x] Service `services/workspace` (Go) + `ws_db` (db-init) + migration nhúng + outbox; Dockerfile, compose, CI
- [x] Băm đoạn (JSON chuẩn hóa) + diff LCS theo hash (test)
- [x] API nội bộ tạo/sửa/xóa + import; API công khai lịch sử/so sánh/rewind (quyền qua backend `/internal/permissions`)
- [x] Backend: `/internal/permissions`, `/internal/chapters/export`; `submitChapter` (đăng, không phải nháp), `updateChapter`, `deleteChapter` gọi workspace
      rồi áp dụng revision; consumer `workspace.revision.merged`; migration `chapters.ws_version`
- [x] Gateway `/api/ws/*`; frontend: trang lịch sử chương (danh sách, so sánh hai bản, khôi phục) + nút ở trang đọc cho người giữ truyện
- [x] Chuyển thật + thử (`scripts/workspace-smoke.py` 20/20)
- [x] README (mục Service workspace), Branches
- [x] Chủ dự án duyệt giao diện trang lịch sử (2026-10-10) → commit, push, PR

## Giai đoạn 2: workspace cá nhân + nháp riêng + pull (nhánh `feat/ws-drafts`)

**Thiết kế giai đoạn 2 (2026-10-10):**
- Quyền giữ như hiện nay cho tới giai đoạn 3: tạo/sửa nháp = người đóng góp (`canUserManageStory`); **Đăng** nháp chương mới = người đóng góp,
  đăng nháp sửa chương cũ = người được sửa chương hôm nay (`canUserModifyChapter`). Giai đoạn 3 mới đổi thành đề xuất → người giữ truyện gộp.
- Nháp chỉ **chủ nháp** đọc/sửa/bỏ. Tối đa 50 nháp đang mở mỗi người. Mở "Sửa" một chương đã có nháp đang mở của mình → dùng lại nháp đó.
- `ws_db.chapter_drafts (id, owner_id, owner_name, story_id, chapter_id NULL = chương mới, base_version, meta, blocks TEXT[], status open|published|discarded,
  version (khóa lạc quan), published_version, created_at, updated_at)`.
- Nội dung mới vẫn đi qua backend (lọc HTML): `POST /api/v1/drafts`, `PUT /api/v1/drafts/:id`, `POST /api/v1/drafts/:id/publish` → API nội bộ workspace.
  Không mang nội dung mới → gọi thẳng `/api/ws`: `GET drafts` (của tôi), `GET drafts/:id`, `DELETE drafts/:id`, `GET|POST drafts/:id/pull`.
- **Đăng** nháp sửa chương: bản chính phải còn đúng `base_version`, nếu không → 409 "cập nhật theo bản chính trước". Nháp chương mới: số chương trùng → 409.
- **Pull** = diff3 (gốc = `base_version`, của tôi = nháp, của họ = bản chính hiện tại) trên mảng hash; meta so từng trường. Xung đột: chọn *bản của tôi* /
  *bản chính* / *cả hai* (chỉ đoạn). Sau pull `base_version` = bản chính hiện tại.
- Trình soạn thảo `/dang-chuong?draft=<id>`: lưu tự động lên server (3 giây sau lần gõ cuối, kèm `version`), bỏ nháp `localStorage` cũ.
  `?edit=<chapterId>` (truyện chữ) tạo/dùng lại nháp rồi chuyển sang `?draft=`. Truyện tranh giữ đường cũ (đăng/sửa thẳng), làm sau.
- `chapter_submissions` đang **rỗng** (0 dòng): không cần chuyển dữ liệu; chỉ ngừng ghi nháp vào đó (bảng xóa ở nhánh sau).

- [x] Workspace (Go): migration `002_drafts.sql`; lõi **diff3 theo đoạn** + merge meta + test (chỉ một bên sửa, cả hai sửa giống nhau, chèn/xóa, xung đột)
- [x] Workspace (Go): API nháp nội bộ (tạo, lưu, đăng) + công khai (danh sách, xem, bỏ, pull xem trước/áp dụng) + test tích hợp
- [x] Backend: `POST/PUT /drafts`, `POST /drafts/:id/publish` (lọc nội dung, quyền như trên, áp revision). Trang truyện chữ thôi ghi nháp vào
      `chapter_submissions`; trình đăng truyện tranh vẫn dùng nó cho tới khi truyện tranh chuyển sang nháp
- [x] Frontend: trình soạn thảo trên nháp (lưu tự động, Đăng, banner "bản chính đã đổi" + hộp pull chọn xung đột)
- [x] Frontend: trang `/ws` (truyện của tôi, nháp của tôi) và `/ws/truyen/[slug]` (chương + lịch sử + nháp của tôi trong truyện); lối vào ở Navbar
- [x] Build, smoke (`scripts/workspace-smoke.py` 38/38, thêm ca nháp/pull), thử trình duyệt, README, Branches
- [x] Chủ dự án duyệt giao diện (`/ws`, `/ws/truyen/[slug]`, trình soạn thảo trên nháp, hộp cập nhật; 2026-10-10) → commit, push, PR vào `main`

## Giai đoạn 3: đề xuất, duyệt, gộp (nhánh `feat/ws-proposals`)

**Thiết kế giai đoạn 3 (2026-10-10, chủ dự án giao tự làm hết plan):**
- Chỉ **người giữ truyện** (chủ truyện, Trưởng nhóm/Mod nhóm) đưa vào bản chính: "Đăng" nháp của chính họ = gộp ngay (sửa thẳng).
  **Người đóng góp** khác (thành viên nhóm, cộng tác viên, kể cả người đã đăng chương đó) bấm **Gửi đề xuất**.
- Gửi đề xuất: nháp khóa (`status = submitted`), chụp một vòng `draft_rounds` (meta, mảng hash, `base_version`, lời nhắn). Chủ nháp **rút lại** được
  (vòng `withdrawn`, nháp mở lại). Người giữ truyện: **Gộp** (vòng `merged`) hoặc **Trả lại** kèm lời nhắn (vòng `returned`, nháp mở lại cho chủ sửa).
  Gửi lại = vòng mới; trang duyệt có tab "Thay đổi từ lần gửi trước" (so mảng hash vòng trước với vòng này).
- Góp ý theo đoạn `draft_comments (draft, vòng, hash đoạn | NULL = chung, nội dung chữ thường ≤ 2000)`: chủ nháp và người giữ truyện viết/đọc.
- Gộp khi bản chính đã đổi: người giữ truyện gộp được nếu diff3 **không xung đột** (tự gộp); có xung đột → 409, trả lại để chủ nháp cập nhật.
  Chủ nháp tự đăng vẫn phải pull trước (như giai đoạn 2).
- Đường đi: gửi / rút / trả lại / gộp qua **backend** (`/api/v1/drafts/:id/submit|withdraw|return|publish`): backend biết ai là người giữ truyện,
  kiểm nội dung (không rỗng, tập còn), áp revision ngay và **gửi thông báo qua hàng đợi** (`enqueueNotificationJob`, `reference_type = 'draft'`
  → bấm mở `/ws/de-xuat/:id`): gửi → người giữ truyện (trừ người gửi), trả lại/gộp → chủ nháp. Góp ý và xem đề xuất gọi thẳng `/api/ws`.
- Trang `/ws/de-xuat/[id]` (duyệt): thay đổi so với bản chính lúc gửi (theo đoạn + từng chữ), thay đổi từ lần gửi trước, góp ý theo đoạn,
  nút Gộp / Trả lại (người giữ) hoặc Rút lại / Mở nháp (chủ). `/ws/truyen/[slug]`: mục "Đề xuất chờ gộp". `/ws`: nháp đã gửi hiện "Chờ duyệt".

- [x] Workspace: migration `003_proposals.sql`; API nội bộ submit/withdraw/return + publish nhận đề xuất (tự gộp khi không xung đột); công khai
      `GET /proposals?story_id=`, `GET /drafts/:id/review`, `POST /drafts/:id/comments`, `can_merge` trong `GET /drafts/:id`; test
- [x] Backend: quyền người giữ truyện dùng chung (`storyRole`); `publish` chỉ người giữ; `submit|withdraw|return`; thông báo `draft`
- [x] Frontend: trình soạn thảo (Gửi đề xuất / Đăng theo quyền, trạng thái đã gửi/bị trả lại + góp ý), component diff dùng chung,
      trang `/ws/de-xuat/[id]`, mục đề xuất ở `/ws/truyen/[slug]` và `/ws`, thông báo bấm mở trang duyệt
- [x] Smoke (ca đề xuất), README, Branches; PR vào `main`, tự merge

## Giai đoạn 4: cộng tác
- [ ] Chia sẻ nháp → bản sao của người giúp → gửi lại cho chủ nháp → nhận cả bản / từng đoạn
- [ ] Giao hẳn nháp (chuyển chủ); "nhận lại" nháp của thành viên đã rời nhóm
- [ ] Cấp quyền sửa nháp + **khóa sửa** luân phiên (giữ trong Redis, có hạn, tự nhả), ghi tác giả mỗi lần lưu
- [ ] Thẻ "bản nháp" trong tin nhắn (cùng messaging): API thẻ tóm tắt + kiểm tra quyền (thành viên nhóm của truyện)
- [ ] Giao việc / nhận chương; cảnh báo hai nháp cùng chương
- [ ] Trang nhóm dịch: tổng hợp việc đang chờ của các truyện trong nhóm
- [ ] Quy trình theo vai trò (RAW → DỊCH → BIÊN TẬP → HIỆU ĐÍNH → GỘP), nhóm tự chọn bước; xong bước tự mở việc bước sau
- [ ] WS nhóm `/ws/nhom/:slug`: tổng quan, bảng việc dạng cột, đề xuất chờ gộp, hoạt động gần đây (`ws_activity`)
- [ ] Hẹn giờ đăng chương (đổi giờ / hủy trước khi đăng)

## Kết thúc mỗi giai đoạn
- [ ] Typecheck, build, migrate, thử API + trình duyệt; README; `Branches/<nhánh>.md`; chủ dự án duyệt giao diện trước khi push
