# Kế hoạch: Mã định danh thông minh

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Ghi ngày: 2026-10-09. Nhánh: `feat/smart-codes` (từ `origin/main` @ 6f9d881). Dùng skill **ponytail**.

## Quyết định (chủ dự án đã chốt)
- **Giữ UUID làm khóa chính**, thêm cột `code` để hiển thị/tìm/quản trị. Không đụng khóa ngoại, token, cache.
- Mã gồm **lõi cố định** (số thứ tự, không bao giờ đổi, duy nhất) + **phần thông tin tự cập nhật**
  (vai trò, nhóm, loại...). Lý do: user đăng ký luôn là độc giả, vai trò cấp sau; truyện có thể đổi nhóm.
  Tra mã chỉ dựa vào lõi → mã cũ in ra trước khi đổi vẫn tra được.
- Số có tối thiểu 4 chữ số, vượt 9999 thì dài thêm (không cắt).

| Đối tượng | Mẫu | Ý nghĩa | Lõi |
|---|---|---|---|
| Người dùng | `U-AD-26-0007` | vai trò cao nhất (AD admin, MO mod, TR dịch giả, AU tác giả, RD độc giả) · năm tham gia · số | `0007` |
| Nhóm dịch | `G03` | số nhóm | `03` |
| Truyện | `LN-JA-G03-0042` | LN/MG · ngôn ngữ gốc · nhóm (G00 = không nhóm) · số | `0042` |
| Chương | `LN-JA-G03-0042-C12` | mã truyện · số chương (`C12.5` nếu lẻ) | truyện + số chương |
| Bài viết | `P-RV-26-0015` | mục (DS thảo luận, RV review, FA fanart, TH giả thuyết, NW tin, QA hỏi) · năm · số | `0015` |
| Album | `AL-0007-26-0184` | số của chủ album · năm · số album | `0184` |
| Báo cáo | `RP-CM-26-0001` | loại bị báo cáo (ST truyện, CH chương, CM bình luận, PO bài) · năm · số | `0001` |

## Bẫy
- `lpad` cắt chuỗi dài hơn độ dài → dùng `lpad(n::text, GREATEST(4, length(n::text)), '0')`.
- Mã chương không lưu cột: ghép từ mã truyện + `chapter_number` (đổi theo truyện, khỏi trigger dây chuyền).
- PgBouncer transaction mode: trigger thuần SQL, không phụ thuộc phiên → ổn.
- Cache API trong Redis (`cache:<url>`) có TTL: sau migrate chỉ xóa khóa `cache:*`, **không `FLUSHDB`**
  (Redis còn giữ lượt xem chưa ghi `views:*` và bộ đếm chống spam). Máy local đã lỡ `FLUSHDB` một lần: mất tối đa ~1 phút lượt xem giả lập.
  Trên server: `redis-cli --scan --pattern 'cache:*' | xargs -r redis-cli del`.
- Backfill bằng UPDATE sẽ kéo `updated_at` (danh sách "mới cập nhật" sắp theo cột này) → migration tạm tắt trigger `update_updated_at_column` trong lúc backfill.
- Số thứ tự lộ tổng số tài khoản/truyện (chấp nhận được, đã nói với chủ dự án).

## Việc
- [x] Migration `sql/migrations/017_smart_codes.sql` (idempotent): cột `code_no` (sequence, UNIQUE) + `code` cho users, translation_groups, stories, posts, albums, reports; hàm dựng mã; trigger BEFORE INSERT/UPDATE và trigger cập nhật lại khi đổi vai trò (`user_roles`), đổi nhóm/ngôn ngữ/loại truyện, đổi số nhóm; backfill theo `created_at`
- [x] Chép vào `sql/database.sql`, chạy `sh scripts/migrate.sh`, kiểm tra mã các bản ghi hiện có
- [x] Backend: trả `code` ở chi tiết truyện, chương (`code` ghép), hồ sơ user, nhóm, bài viết, album, danh sách báo cáo
- [x] Backend: `GET /codes/:code` → `{ type, path }` (tra theo lõi, không phân biệt hoa thường) + test cho hàm tách mã
- [x] Frontend: huy hiệu mã (bấm để chép) trên trang truyện, chương, hồ sơ, nhóm, bài viết, album, trang báo cáo; trang `/ma/[code]` chuyển tới đúng trang
- [x] Góp ý của chủ dự án (2026-10-09): người đọc không cần thấy mã → `CodeBadge` chỉ hiện với Admin/Mod (trang truyện: trong hàng Quản lý)
- [x] Trang truyện gọn lại: chip → một dòng thông tin; thống kê → 1 dòng (lượt xem, số chương); bỏ nút + hộp **Đánh giá** và ô điểm;
  số người theo dõi nằm trong nút Theo dõi; 1 nút đọc chính; Đọc từ đầu / Chương mới nhất / Thảo luận / Tải xuống vào menu "⋯"; bỏ chip "Chủ thầu / Quản lý"
- [x] Góp ý lần 2: trang truyện mất thông tin, chữ không đọc được trên ảnh sáng, nút đặt sai → thiết kế lại phần đầu: nhãn trạng thái, bảng thông tin có nền riêng,
  3 ô thống kê, hàng nút chính + hàng nút phụ (bỏ menu "⋯"), lớp tối trên ảnh đậm hơn
- [x] Góp ý lần 3: chủ dự án thích giao diện cũ hơn 2 bản sửa → **lấy lại trang truyện của `main`**, chỉ bỏ phần đánh giá (ô điểm, nút, hộp chấm điểm),
  thống kê còn 3 ô (lượt xem, người theo dõi, chương), bỏ chip "Chủ thầu / Quản lý" trùng hàng Quản lý, mã truyện trong hàng Quản lý (Admin/Mod)
- [x] Góp ý lần 4: tag thể loại xuống dưới banner (đầu khung Tóm tắt, trước nội dung); hàng Quản lý thành thanh riêng dưới banner → banner truyện nào cũng cùng khung.
  8 truyện mẫu dùng ảnh bìa stock Unsplash (không phải ảnh truyện) nên nền banner trông khác: lỗi dữ liệu, chưa sửa
- [x] Chủ dự án xem giao diện và đồng ý (trước khi commit/push)
- [x] Typecheck, test, build; thử tạo user/truyện/bài/album/báo cáo mới, cấp vai trò, đổi nhóm truyện → mã đổi đúng, tra mã cũ vẫn ra
- [x] README (bảng, route `/ma/[code]`, API `/codes/:code`), `Branches/feat-smart-codes.md`
- [x] Commit, push, mở PR (không tự merge)
