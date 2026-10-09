# feat/dm-labels-block-pin

- **Mục tiêu:** Tin nhắn: nhãn phân loại cuộc trò chuyện, tìm theo nhãn, chặn người dùng, ghim tin nhắn.
- **Tạo từ:** `origin/main` @ 24cc99a, ngày 2026-10-09
- **Trạng thái:** chờ chủ dự án duyệt giao diện (chưa push)
- **PR:** (điền sau khi mở)
- **Plan:** `Plan/dm-labels-block-pin.md`

## Thay đổi
- **Nhãn** riêng từng người (người kia không thấy): tạo / đổi tên / đổi màu / xóa (8 màu, tối đa 20 nhãn), gắn nhiều nhãn cho một cuộc trò chuyện; hộp thư lọc bằng hàng chip nhãn, mỗi cuộc trò chuyện hiện nhãn của nó.
- **Tìm kiếm** trong hộp thư theo tên người và nội dung tin, trong phạm vi nhãn đang chọn; tô sáng chữ khớp, hiện tin khớp mới nhất.
- **Chặn** hai chiều: không ai gửi được cho ai, tin cũ vẫn đọc được; người bị chặn chỉ thấy câu chung "Không thể gửi tin nhắn cho người này"; người chặn thấy nút "Bỏ chặn" thay ô soạn tin, biểu tượng chặn trong hộp thư.
- **Ghim** tin (cả hai người cùng thấy, tối đa 10/cuộc trò chuyện): rê chuột vào tin → nút ghim; thanh "Đã ghim" ở đầu khung chat, bấm để nhảy tới tin (tô viền), mở danh sách đầy đủ, bỏ ghim.
- Backend: `message.controller.ts` (API mới), route `/messages/labels` khai báo trước `/messages/:username`.
- Frontend: `/tin-nhan`, `components/messages/LabelManager.tsx`, `components/messages/labels.ts`.

## Migration / biến môi trường mới
- `sql/migrations/016_dm_labels_block_pin.sql` (đã chép vào `sql/database.sql`): bảng `dm_labels`, `dm_label_conversations`, `user_blocks`; cột `direct_messages.pinned_at`, `pinned_by`.

## Đã kiểm tra
- Typecheck backend + frontend; migration chạy trên DB đang có.
- API bằng 2 tài khoản test (`sim_reader_003/004`, tin test đã xóa): tạo nhãn, trùng tên (khác hoa thường) và màu sai bị từ chối; gắn nhãn, lọc theo nhãn, tìm trong nhãn trả đúng tin khớp, tìm có ký tự `%` không lỗi; người kia không thấy nhãn; ghim bởi người nhận → người gửi thấy; ghim tin ngoài cuộc trò chuyện bị từ chối; chặn → 2 chiều đều 403 cùng một câu, trạng thái `blocked_by_me`/`can_message` đúng, bỏ chặn gửi lại được; `/messages/labels` không bị hiểu là tên người dùng.

## Ghi chú cho người review
- Xóa nhãn không hỏi lại (chỉ gỡ nhãn, không xóa tin nhắn).
- Chặn chỉ áp dụng cho tin nhắn, chưa ẩn bài viết/bình luận của người bị chặn.
