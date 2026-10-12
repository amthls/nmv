# feat/search-debounce-cache

- **Mục tiêu:** Tìm kiếm: đợi gõ xong, hủy yêu cầu cũ, thanh tải, cache Redis 30s
- **Tạo từ:** `origin/main` @ c2b15f8, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** https://github.com/amthls/nmv/pull/97
- **Plan:** Plan/ui-overhaul.md (B9)

## Thay đổi
- `SearchBox`: `SEARCH_DELAY_MS = 400` (trước 250), AbortController hủy yêu cầu đang chạy khi gõ tiếp, vòng xoay trong ô nhập,
  thanh tải `.nh-loadbar` ở đầu ô gợi ý, kết quả cũ mờ đi trong lúc chờ.
- `/kham-pha`: cùng độ trễ 400 ms (trước 300), hủy yêu cầu cũ, thanh tải dưới ô tìm kiếm.
- `globals.css`: `.nh-loadbar` (thanh chạy trong một khung, tắt hiệu ứng khi giảm chuyển động).
- Catalog: `GET /stories/explore` thêm `cacheJson(30)` (Redis theo nguyên URL, chung cho mọi người xem; route không đọc người dùng).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `tsc --noEmit` frontend + catalog.
- `/stories/explore?q=tensei` lần 1 `X-Cache: MISS`, lần 2 `HIT`; gõ nhanh "solo leveling" ở thanh trên → đúng 1 yêu cầu, có vòng xoay + "Đang tìm..." trong lúc chờ.
