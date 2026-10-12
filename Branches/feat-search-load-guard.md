# feat/search-load-guard

- **Mục tiêu:** Chống quá tải Elasticsearch (cache theo từ khóa, gộp, giới hạn đồng thời, cầu dao) + nút Tìm tải tối thiểu 1 s
- **Tạo từ:** `origin/main` @ 4281d1f, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền khi mở)
- **Plan:** `Plan/load.md` (C4, C5)

## Thay đổi
- `catalog/src/services/search.service.ts` (`searchStoryIds`): id theo từ khóa cache 60 s trong Redis; truy vấn trùng đang chạy dùng chung;
  tối đa 4 truy vấn ES đồng thời, chờ > 1 s thì trả null (SQL); lỗi/timeout → nghỉ ES 30 s; `timeout: '1s'` trong ES, `timed_out` coi là lỗi.
- `app/kham-pha/page.tsx`, `components/explore/FilterSidebar.tsx`: sau "Tìm" kết quả hiện sau tối thiểu 1 s, nút "Đang tìm..." bị khóa.
- README, Plan/load.md.

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `npx tsc --noEmit` (catalog, frontend), `yarn test` catalog, `check-nav.sh`.
- Đếm truy vấn bằng `_stats/search` của ES: 20 tổ hợp lọc/trang/sắp xếp cùng từ khóa = 1; 40 từ khóa đồng thời đều 200 (chậm nhất 231 ms).
- Tắt ES: lần tìm đầu 3 s, 4 lần sau 15–21 ms bằng SQL có kết quả; bật lại ES.
- Chrome: "Tìm" → server 17 ms, hiện sau 1034 ms; bấm thêm 2 lần lúc chờ vẫn 1 request.

## Ghi chú cho người review
- Truyện mới có thể trễ tối đa 60 s mới hiện trong tìm theo từ khóa.
