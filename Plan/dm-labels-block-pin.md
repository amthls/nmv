# Kế hoạch: Tin nhắn — nhãn, tìm theo nhãn, chặn, ghim

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Bắt đầu: 2026-10-09. Nhánh: `feat/dm-labels-block-pin` (từ `origin/main` @ 24cc99a).
> Giao diện: **chờ chủ dự án duyệt trên localhost rồi mới push** (xem nhánh xem thử `local/preview` bên dưới).

## Thiết kế
- **Nhãn** là của riêng từng người: tôi tạo nhãn "Nhóm dịch", "Bạn bè"… rồi gắn vào cuộc trò chuyện (một cuộc trò chuyện có thể có nhiều nhãn). Người kia không thấy nhãn của tôi.
  Cuộc trò chuyện = cặp (tôi, người kia), nên bảng gắn nhãn lưu `(label_id, partner_id)`.
- **Tìm kiếm**: ô tìm trong hộp thư tìm theo tên người và nội dung tin nhắn, **trong phạm vi nhãn đang chọn**; kết quả hiện đoạn tin khớp.
- **Chặn**: A chặn B → không ai gửi được cho ai (giống Reddit/Messenger), cuộc trò chuyện cũ vẫn đọc được. Người bị chặn chỉ thấy "Không thể gửi tin nhắn cho người này" (không lộ là bị chặn).
- **Ghim**: ghim một tin trong cuộc trò chuyện, **cả hai người đều thấy** (như Messenger); tối đa 10 tin ghim mỗi cuộc trò chuyện; thanh "Tin đã ghim" ở đầu khung chat.

## Checklist
### Backend
- [x] Migration `016_dm_labels_block_pin.sql` (+ chép vào `database.sql`): `dm_labels(id, user_id, name, color, created_at, unique(user_id, lower(name)))`, `dm_label_conversations(label_id, partner_id)`, `user_blocks(blocker_id, blocked_id)`, `direct_messages.pinned_at/pinned_by`
- [x] `GET /messages?label=&q=`: lọc theo nhãn, tìm theo tên/nội dung, mỗi cuộc trò chuyện kèm `label_ids`, `blocked`
- [x] Nhãn: `GET/POST /messages/labels`, `PATCH/DELETE /messages/labels/:id` (tối đa 20 nhãn, tên ≤ 30 ký tự, màu trong danh sách cho phép)
- [x] `PUT /messages/:username/labels` (`label_ids`) gắn/bỏ nhãn
- [x] `POST/DELETE /messages/:username/block`; gửi tin bị chặn → 403 câu chung; thread trả `blocked_by_me`, `can_message`
- [x] `POST/DELETE /messages/:username/pins/:messageId`; thread trả `pinned` (cả tin cũ hơn 100 tin gần nhất); realtime `dm` cho cả hai
- [x] Route khai báo trước `/messages/:username` để `labels` không bị hiểu là tên người dùng

### Frontend (`/tin-nhan`)
- [x] Hộp thư: ô tìm kiếm, hàng chip nhãn (Tất cả + từng nhãn có màu + nút quản lý), chấm màu nhãn trên từng cuộc trò chuyện, đoạn tin khớp khi tìm
- [x] Hộp quản lý nhãn: tạo, đổi tên/màu, xóa
- [x] Đầu khung chat: nút gắn nhãn (danh sách tick), nút chặn/bỏ chặn (xác nhận), thanh "Tin đã ghim" mở rộng được
- [x] Rê chuột vào tin → nút ghim/bỏ ghim; tin đã ghim có biểu tượng ghim
- [x] Bị chặn / đã chặn: thay ô soạn tin bằng thông báo

### Hoàn tất
- [ ] Typecheck 2 bên, migrate, build, thử bằng 2 tài khoản test (nhãn, tìm, chặn 2 chiều, ghim, realtime)
- [x] README (bảng, API, trang `/tin-nhan`, hạn chế đã biết)
- [ ] Nhánh xem thử `local/preview` (chỉ ở máy) = `main` + `fix/navbar-compact` + nhánh này → build cho chủ dự án xem
- [ ] Chờ duyệt → commit, push, mở PR

## Ghi chú
- Express 4: handler mới bọc `wrap()` hoặc try/catch.
- `tailwind`: tránh `indigo/purple/violet` (bị đổi thành màu brand) khi chọn màu nhãn.
