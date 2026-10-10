# feat/identity-mail-extras

- **Mục tiêu:** identity: đổi email, giới hạn mail/ngày, token không nằm lại trên URL, Turnstile tùy chọn
- **Tạo từ:** `origin/main`, ngày 2026-10-10
- **Trạng thái:** xong, chờ CI
- **PR:** (chưa mở)
- **Plan:** `Plan/identity.md` (nhánh 4), `Plan/microservices.md` (mục "Mail tài khoản")

## Thay đổi
- identity: `POST /change-email` (mật khẩu hiện tại; link 24 giờ tới email mới, báo email cũ), `POST /confirm-email-change` (đổi email,
  đã xác thực, hủy mọi link cũ chưa dùng, báo email cũ, nhật ký bảo mật). Migration `002_mail_extras.sql`.
- identity: tối đa 10 mail/ngày mỗi địa chỉ (`enqueueMail`).
- identity + frontend: Turnstile tùy chọn cho đăng ký và quên mật khẩu (`TURNSTILE_SECRET`, `TURNSTILE_SITE_KEY` lúc build); CSP chỉ mở
  `challenges.cloudflare.com` khi bật.
- Frontend: tab Bảo mật có "Đổi email"; `/xac-thuc-email?doi=1` xác nhận email mới; trang có token xóa token khỏi thanh địa chỉ và không gửi Referer.
- Gateway: giới hạn tần suất `account` cho 2 API mới.

## Migration / biến môi trường mới
- identity `002_mail_extras.sql` (tự chạy khi khởi động)
- Tùy chọn: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`

## Đã kiểm tra
- `go test` identity (tích hợp): `TestChangeEmail` (sai mật khẩu, email đã dùng, chỉ đổi sau khi mở link, link dùng một lần, link đặt lại
  mật khẩu cũ bị hủy, báo email cũ), `TestMailDailyLimit`, `TestTurnstile` (server giả của Cloudflare); `tsc` frontend.
- Chạy thật qua gateway: đổi email reader_hana → xác nhận → đổi lại (giới hạn `account` 10/phút của gateway chặn khi gửi quá nhanh: đúng ý).
- Trang `/xac-thuc-email`, `/dat-lai-mat-khau` có `<meta name="referrer" content="no-referrer">`; CSP vẫn `frame-src 'none'` khi Turnstile tắt.
- **Chưa thử trên trình duyệt** (tiện ích Chrome không kết nối): xóa token khỏi thanh địa chỉ, form "Đổi email", widget Turnstile.

## Ghi chú cho người review
- Bật Turnstile: đặt `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET` trong `.env`, build lại `frontend`, khởi động lại `identity`.
