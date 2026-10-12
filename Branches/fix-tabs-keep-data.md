# fix/tabs-keep-data

- **Mục tiêu:** Tab và kệ truyện tải lần đầu rồi giữ dữ liệu, không gọi lại mỗi lần chuyển
- **Tạo từ:** `origin/main` @ 7e6aa07, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/load.md` (A3)

## Thay đổi
- Mới `frontend/src/lib/memo.ts`: `remembered(key, ttl, load)` giữ câu trả lời trong bộ nhớ trang (lỗi không giữ), `forget(key)`.
- `components/workspace/StoryFlow.tsx`: truyện trên kệ và danh sách phiên bản giữ 60 s; "Dùng bản này" xóa mục của chương đó.
- `app/nhom-dich/[slug]/page.tsx`: tab Chat chỉ tải lại khi có tin nhắn mới đẩy tới trong lúc ở tab khác (còn 30 s dự phòng khi đang mở).
- `app/tai-khoan/page.tsx`: tab Quản lý vai trò tải danh sách một lần (tìm kiếm vẫn gọi như cũ).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit`, `check-nav.sh` sạch.
- Chrome: /ws đổi truyện A→B→A→B: 1 request (trước 4); mở chương qua lại 4 lần: 1 request phiên bản; tab Chat nhóm mở 3 lần: 1 request.

## Ghi chú cho người review
- Chỉ frontend. Dữ liệu ở /ws có thể cũ tối đa 60 s khi người khác sửa cùng lúc.
