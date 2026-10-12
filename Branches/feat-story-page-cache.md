# feat/story-page-cache

- **Mục tiêu:** Cache Redis phần chung của trang truyện và chương, xóa ngay khi có thao tác ghi
- **Tạo từ:** `origin/main` @ 442fe73, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/load.md` (A5)

## Thay đổi
- `catalog/src/middlewares/cache.ts`: `cachedPublic(key, ttl, load)` (khóa `pub:<thế hệ>:…`), `bumpPublicCache()`, middleware `bumpOnWrite`
  (request ghi thành công tăng thế hệ trước khi gửi câu trả lời).
- `catalog/src/server.ts`: `bumpOnWrite` trên `/api/v1` (không trên `/internal`: phần lớn là POST chỉ đọc).
- `story.controller.ts`: `loadPublicStory` / `loadPublicChapter` qua cache 60 s; theo dõi, quyền, kiểm duyệt, lịch sử, lượt xem vẫn mỗi request.
- `workspaceSync.applyRevisionNow` và `storyPurge.purgeStory` tăng thế hệ sau commit (không đi qua request).
- README bảng hiệu năng.

## Migration / biến môi trường mới
- Không có. Không có Redis thì đọc thẳng DB như cũ.

## Đã kiểm tra
- `npx tsc --noEmit`, `yarn test` (10/10).
- Redis có khóa `pub:0:story:…`, `pub:0:chapter:…` sau lần đọc đầu.
- Sửa tóm tắt truyện (PUT với tài khoản người giữ truyện) rồi đọc ngay: thấy bản mới; trả lại tóm tắt cũ.
- Chrome: trang truyện và trang chương hiển thị đúng (9 chương, nút theo dõi, chương sau).

## Ghi chú cho người review
- Chưa thử đường "Dùng bản này" trên /ws (sự kiện workspace) với cache; code tăng thế hệ sau commit.
- Lượt xem / bình luận / tên người đăng trên trang truyện có thể trễ tối đa 60 s.
