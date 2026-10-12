# Kế hoạch: điều hướng "quay lại" đúng route cũ, bỏ đường dẫn ghi cứng

## Context
- Trang truyện có breadcrumb ghi cứng `Trang chủ > Khám phá > <truyện>`. Từ trang chủ bấm vào truyện rồi bấm "Khám phá" để quay lại thì vào Khám phá, sai chỗ. Chủ dự án muốn **bỏ hẳn** breadcrumb và **sửa mọi chỗ ghi cứng kiểu này**.
- Gốc lỗi hệ thống nằm ở `frontend/src/components/common/BackLink.tsx`: luôn gọi `router.back()` khi `history.length > 1`, bất kể nhãn nút ghi gì. Vì vậy:
  - "Quay lại mục lục truyện" trong trình đọc: sau ch1 → ch2, bấm nút thì về **ch1**, không về trang truyện.
  - Các nút "Workspace của tôi", "Fandom" về trang vừa xem, không phải trang ghi trên nhãn.
  - Mở link trong tab mới: `history.length` vẫn > 1 (tính cả trang New Tab), nên bấm "quay lại" là **rời khỏi site**.
- `UploadHeader.tsx` cũng dùng `history.length`. Sau các thao tác, vài chỗ đẩy cứng về một trang cố định (xóa truyện → `/kham-pha`), không về nơi người dùng đến.
- Kết quả cần có: một quy tắc điều hướng duy nhất, một module duy nhất, và một lệnh kiểm tra để lỗi này không quay lại.

## Quy tắc (ghi vào CLAUDE.md)
1. **Không breadcrumb, không link "đi đâu đó" ghi cứng mà giả làm nút quay lại.**
2. Có đúng 3 cách quay lại, đều nằm trong `frontend/src/lib/nav.ts`:
   - `<BackLink href="/x">Nhãn tên trang X</BackLink>`: **luôn đến trang X** như nhãn ghi. Chỉ dùng `router.back()` khi trang trước trong site đúng là X (so pathname), để giữ vị trí cuộn.
   - `<BackButton fallback="/y" />`: nút "← Quay lại" chung, dùng cho trang vào được từ nhiều nơi. Về trang trước **trong site**; không có thì về `fallback`. Không bao giờ ra khỏi site.
   - `goBack(router, fallback)`: dùng sau một thao tác (xóa, bỏ nháp...), cùng cách như `BackButton`.
3. Cấm dùng thẳng `router.back()`, `history.back()`, `history.length` ở mọi nơi khác. Có script kiểm tra.

## Thực hiện
Nhánh `fix/navigation-back`, tạo bằng `scripts/new-branch.sh`. Bước đầu tiên là chép checklist này vào `Plan/navigation.md`, đánh dấu `[x]` khi xong từng mục.

- [x] **`frontend/src/lib/nav.ts` + `components/common/NavTracker.tsx`** (gắn một lần trong `app/layout.tsx` cạnh `NavigationProgress`):
  - Giữ một ngăn xếp URL trong site (pathname+search) trong `sessionStorage`, khớp với lịch sử trình duyệt:
    - Bọc `history.pushState`: thêm URL mới vào ngăn xếp.
    - Bọc `history.replaceState`: thay phần tử trên cùng (bắt được cả `/ws` đổi `?chuong=`).
    - Bắt `popstate`: nếu URL mới bằng phần tử kế trên cùng thì lấy bỏ phần tử trên cùng (đi lùi), ngược lại thì thêm vào (đi tiến).
  - Xuất ra: `previousRoute()`, `goBack(router, fallback)`, `BackLink`, `BackButton`.
  - Ngăn xếp rỗng hoặc chỉ có một phần tử (tab mới, link mở thẳng) thì dùng `fallback`.
  - `BackLink.tsx` cũ: chuyển sang dùng module mới, giữ nguyên chỗ import để ít sửa.
- [x] **Bỏ breadcrumb** ở `app/truyen/[slug]/page.tsx:408-415`, và bỏ import `ChevronRight` nếu không còn dùng.
- [x] **Rà và sửa từng chỗ** (đã tìm bằng grep):

| Chỗ | Hiện tại | Sau khi sửa |
|---|---|---|
| Trình đọc `truyen/[slug]/[chapterSlug]` ← "mục lục" | lùi 1 trang (về chương trước) | `BackLink` đến trang truyện |
| `truyen/[slug]/lich-su/[chapterId]` ← | lùi 1 trang | `BackLink` đến trang truyện |
| `dang-truyen/sua/[slug]` "Quay lại trang truyện" (2 chỗ) | lùi 1 trang | `BackLink` đến trang truyện |
| `fandom/[slug]` "← Fandom" | lùi 1 trang | `BackLink` đến `/fandom` |
| `ws/nhom`, `ws/truyen`, `ws/de-xuat` "Workspace của tôi" | lùi 1 trang | `BackLink` đến `/ws` (giữ `?truyen=` nếu trang trước là `/ws`) |
| `dang-truyen` "Quay lại Nhóm Dịch" | nhãn cứng, lùi 1 trang | `BackButton` (fallback `/nhom-dich`), vì vào từ nhiều nơi |
| `UploadHeader` "Quay lại" | `history.length` | `BackButton` (fallback `/ws`) |
| Xóa truyện (`truyen/[slug]/page.tsx:221`) | `push('/kham-pha')` | `goBack` (fallback `/`) |
| Bỏ nháp / chuyển nháp (`dang-chuong:679, 881`) | `push('/ws')` | `goBack` (fallback `/ws`) |
| Xóa bài fandom (`fandom/[slug]:109`) | `push('/fandom')` | `goBack` (fallback `/fandom`) |

  Giữ nguyên các link "Về trang chủ" / "Quay lại danh sách nhóm" trên trang lỗi hoặc không tìm thấy: nhãn nói đúng nơi link dẫn tới. Giữ nguyên Ctrl+K → `/kham-pha` (đó là phím tắt tìm kiếm, không phải quay lại).
- [x] **`scripts/check-nav.sh`**: grep `frontend/src` tìm `router.back(`, `history.back`, `history.length`, `Trang chủ</Link>`. Có kết quả ngoài `lib/nav.ts` / `NavTracker.tsx` thì thoát mã 1. Thêm vào danh sách "kiểm tra trước khi merge" trong CLAUDE.md và README (mục Kiểm tra & migration).
- [x] **CLAUDE.md**: thêm mục "Điều hướng" với 3 quy tắc trên. **README**: một dòng về `lib/nav.ts`.
- [x] `Branches/fix-navigation-back.md`, rồi commit, PR, merge (`gh` tại `/c/Program Files/GitHub CLI/gh.exe`).

## Kiểm tra
- `cd frontend && npx tsc --noEmit`; `sh scripts/check-nav.sh` sạch; `docker compose up -d --build frontend`.
- Chrome (đo URL sau mỗi bước):
  1. Trang chủ → truyện Komi: không còn breadcrumb; Back của trình duyệt về trang chủ.
  2. Trang truyện → ch1 → ch2 → nút "mục lục": về **trang truyện**, không về ch1.
  3. Mở thẳng `/truyen/komi-nu-than-so-giao-tiep/<chương>` trong tab mới, bấm nút mục lục: về trang truyện, không rời site.
  4. `/ws?truyen=x&chuong=y` → "Giao việc" (`/ws/truyen/x`) → "Workspace của tôi": về `/ws?truyen=x&chuong=y`, giữ vị trí cuộn.
  5. Trang nhóm → `/dang-truyen` → "Quay lại": về trang nhóm. Mở `/dang-truyen` trong tab mới → "Quay lại": về `/nhom-dich`.
  6. `/fandom/<bài>` mở từ trang chủ → "← Fandom": về `/fandom` (đúng nhãn).
