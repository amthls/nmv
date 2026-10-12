# feat/purge-removed-stories

- **Mục tiêu:** Truyện bị Admin/Mod gỡ tự xóa hẳn sau 60 ngày
- **Tạo từ:** `origin/main` @ 2113095, ngày 2026-10-11
- **Trạng thái:** xong, chờ merge
- **PR:** (điền sau khi mở)
- **Plan:** Plan/remove-backup-purge.md (nhánh 2)

## Thay đổi
- `catalog/src/services/storyPurge.ts`: `purgeStory(id)` dùng chung cho chủ truyện tự xóa và job 60 ngày
  (kiểm tra lại "vẫn bị gỡ, quá hạn" dưới khóa dòng, truyện vừa khôi phục không bị xóa); `scheduleRemovedPurge()` trong worker
  (60 giây sau khi khởi động, rồi mỗi 24 giờ), ghi log từng truyện bị xóa.
- `deleteStory` gọi `purgeStory`.
- `GET /internal/stories/removed` trả thêm `purge_at`; trang `/da-go` hiện "Tự xóa hẳn vào …"; thông báo gỡ truyện ghi hạn 60 ngày.
- Compose: worker thêm `INTERNAL_KEY_COMMUNITY`, `COMMUNITY_INTERNAL_URL`, `SEARCH_*`, `REMOVED_PURGE_DAYS`.
- README: mục kiểm duyệt + worker.

## Migration / biến môi trường mới
- `REMOVED_PURGE_DAYS` (mặc định 60, worker + catalog đọc). Không có migration.

## Đã kiểm tra
- `tsc --noEmit` catalog + frontend.
- Trên máy: truyện gỡ giả `removed_at` 61 ngày (có chương, theo dõi ở library, bình luận truyện + chương ở community) bị worker xóa
  ở cả 3 service; truyện gỡ 10 ngày còn nguyên; `/api/community/moderation/removed` trả `purge_at` = gỡ + 60 ngày.

## Ghi chú cho người review
- Xóa giống hệt khi chủ truyện tự xóa (workspace/media không đụng, như trước).
