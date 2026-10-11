# feat/group-mergers-hot-shelf

- **Mục tiêu:** Giai đoạn I3: nhóm chọn ai được gộp + kệ Đang hot tính sẵn vào Redis
- **Tạo từ:** `origin/main` @ 50da18c, ngày 2026-10-11
- **Trạng thái:** xong
- **PR:** (chưa mở)
- **Plan:** `Plan/catalog.md` (I3)

## Thay đổi
- Migration `028_group_mergers.sql` (+ `database.sql`): `translation_groups.mergers TEXT[]` mặc định `{mod}`, CHECK trong
  `mod, translator, editor, raw_provider, proofreader, member`.
- `storyRole` (catalog): người giữ truyện = chủ truyện, Trưởng nhóm, hoặc vai trò có trong `mergers` (keeperIds cũng vậy) → workspace qua `/internal/permissions`.
- `PUT /groups/:id/workflow {steps, mergers?}`: `mergers` chỉ Trưởng nhóm đổi (Mod → 403), vai trò sai → 400; bỏ trống thì giữ nguyên.
- Trang nhóm (`/nhom-dich/[slug]`, tab thông tin): hàng chọn vai trò được gộp (Trưởng nhóm sửa, người khác chỉ xem).
- Worker: `services/hotShelf.ts` tính kệ "Đang hot" vào khóa cache của `GET /stories/trending` mỗi 2 phút (`HOT_SHELF_MS`), TTL 6 phút.
- README.

## Migration / biến môi trường mới
- `028_group_mergers.sql` (chỉ thêm cột). Biến tùy chọn `HOT_SHELF_MS` (mặc định 120000).

## Đã kiểm tra
- tsc catalog + frontend; migration 028 trên DB local.
- `storyRole`: thành viên thường không phải người giữ truyện với `{mod}`, là người giữ truyện khi thêm vai trò của họ; CHECK chặn vai trò lạ.
- API qua gateway: Trưởng nhóm lưu `[editor, mod]` → `[mod, editor]`; vai trò lạ 400; chỉ gửi `steps` giữ nguyên `mergers`;
  Mod nhóm (tạm thêm rồi gỡ) và người ngoài nhóm → 403. Đã trả cài đặt nhóm về `{mod}`.
- Redis có `cache:/api/v1/stories/trending` (TTL ~6 phút), API trả `X-Cache: HIT`. `workspace-smoke` qua.
- Trình duyệt (neko_trans, Trưởng nhóm): hàng "Người giữ truyện" hiện, Mod nhóm được tick, đổi lựa chọn thì hiện nút Lưu.
