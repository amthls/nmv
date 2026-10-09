# Kế hoạch: Sửa các mục từ ponytail-review (#38, #43, #45)

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Ghi ngày: 2026-10-09. Nhánh: `fix/review-followups` (từ `origin/main` @ 5e25348). **Chưa làm, để sau.**
> Dùng skill **ponytail** khi sửa (thay đổi nhỏ nhất đủ giải quyết). Tải giả định: 2–20 nghìn người online (README).

## Nên sửa

### 1. Chặn spam mail qua "Quên mật khẩu"
- **Ở đâu:** `backend/src/controllers/auth.controller.ts`, hàm `forgotPassword`.
- **Lỗi:** `mailLimiter` chỉ đếm theo IP → đổi IP liên tục là gửi hàng trăm mail tới cùng một email, đốt hạn mức SMTP.
- **Cách sửa:** trước `createAccountToken(user.id, 'reset_password')`, bỏ qua nếu đã có token `reset_password` của user tạo trong 2 phút gần nhất:
  `SELECT EXISTS (SELECT 1 FROM auth_tokens WHERE user_id = $1 AND purpose = 'reset_password' AND created_at > NOW() - INTERVAL '2 minutes')`.
  Câu trả lời cho người dùng **giữ nguyên** (không lộ email nào có tài khoản).
- [ ] Sửa
- [ ] Thử: gửi 2 lần liền cho cùng email → log backend chỉ có 1 link; sau 2 phút gửi lại được

### 2. Phiên bị thu hồi báo sai "Tài khoản không tồn tại"
- **Ở đâu:** `backend/src/middlewares/auth.middleware.ts` (~dòng 89, `requireAuth`).
- **Lỗi:** token bị thu hồi (đổi mật khẩu / "Đăng xuất mọi thiết bị") dùng chung nhánh với "không tìm thấy user" → thiết bị khác thấy "Tài khoản không tồn tại trên hệ thống."
- **Cách sửa:** tách `if (isTokenRevoked(...))` riêng, trả 401 "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại."
- [ ] Sửa
- [ ] Thử: đổi mật khẩu → gọi `/auth/me` bằng token cũ → 401 với câu mới

### 3. Test cho các chốt bảo mật
- **Ở đâu:** `isTokenRevoked` (`auth.middleware.ts`), `consumeAccountToken` (`auth.controller.ts`), `blockStatus` / gửi tin khi bị chặn (`message.controller.ts`).
- **Lỗi:** chưa có test; sửa nhầm (vd `<` thành `<=`) thì CI vẫn xanh.
- **Cách sửa:** file `backend/src/middlewares/auth.middleware.test.ts` chạy bằng `npx tsx --test` (dự án đã dùng `tsx`), bắt đầu với `isTokenRevoked` (hàm thuần): token cấp trước mốc → bị từ chối, cùng giây → chấp nhận, `tokens_valid_after` null → chấp nhận, thiếu `iat` → từ chối. Thêm script `"test"` vào `backend/package.json` và một bước `yarn test` trong job `typecheck` của `.github/workflows/ci.yml`.
- [ ] Viết test + script + bước CI
- [ ] Chạy thử: đổi `<` thành `<=` trong `isTokenRevoked` → test đỏ; đổi lại → xanh

### 4. Gộp 3 hàm gọi API giống nhau ở frontend
- **Ở đâu:** `frontend/src/app/tin-nhan/page.tsx` (`api`, ~dòng 81), `frontend/src/components/account/SecurityTab.tsx` (`post`, ~dòng 32), `frontend/src/components/auth/AccountCard.tsx` (`postAuth`, ~dòng 9).
- **Lỗi:** 3 bản sao cùng việc (gửi JSON, đọc kết quả, trả `{ok, message/json}`), phải sửa cùng nhau.
- **Cách sửa:** một hàm trong `frontend/src/lib/` (vd `apiJson(fetchFn, path, { method, json })` trả `{ ok, json }`), 3 chỗ gọi nó; `postAuth` dùng `fetch` thường (trang chưa đăng nhập), 2 chỗ kia truyền `authFetch`. Ước bớt ~25 dòng.
- [ ] Sửa
- [ ] Thử: `/tin-nhan` (gửi, nhãn, ghim, chặn), tab Bảo mật (đổi mật khẩu), `/quen-mat-khau`, `/dat-lai-mat-khau`, `/xac-thuc-email`

## Nên có

### 5. Bỏ trường `colors` không ai dùng
- **Ở đâu:** `backend/src/controllers/message.controller.ts` (`getLabels`, ~dòng 212).
- **Cách sửa:** bỏ `colors: LABEL_COLORS` khỏi kết quả; thêm chú thích cạnh `LABEL_COLORS`: "phải khớp `LABEL_STYLES` trong `frontend/src/components/messages/labels.ts`". Cập nhật README (mục API nhãn) nếu có nhắc `colors`.
- [ ] Sửa

### 6. Tìm tin nhắn nhanh hơn cho người có nhiều tin
- **Ở đâu:** `message.controller.ts`, `getConversations`, phần `LEFT JOIN LATERAL`.
- **Lỗi:** với mỗi cuộc trò chuyện lại quét toàn bộ tin của user (20.000 tin × 100 cuộc trò chuyện ≈ 2 triệu dòng mỗi lần tìm).
- **Cách sửa:** CTE `matches AS (SELECT DISTINCT ON (partner_id) partner_id, message FROM mine WHERE $3::text IS NOT NULL AND message ILIKE $3 ORDER BY partner_id, created_at DESC)`, rồi `LEFT JOIN matches mt ON mt.partner_id = l.partner_id` thay cho LATERAL; điều kiện WHERE giữ nguyên (`mt.message IS NOT NULL OR tên khớp`).
- [ ] Sửa
- [ ] Thử: kết quả tìm giống trước (theo tên, theo nội dung, trong nhãn, có ký tự `%`); `EXPLAIN ANALYZE` trước/sau với user nhiều tin

## Hoàn tất
- [ ] Typecheck 2 bên, build, thử từng mục ở trên
- [ ] README nếu API đổi (mục 5)
- [ ] File `Branches/fix-review-followups.md` cập nhật thay đổi + đã kiểm tra
- [ ] Commit, push, mở PR (không tự merge)

## Chưa kiểm tra được trong lần review
- Giao diện điện thoại xem trực quan (cửa sổ trình duyệt phóng to).
- Gửi mail thật qua SMTP (chưa cấu hình `SMTP_URL`).
