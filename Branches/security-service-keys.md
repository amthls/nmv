# security/service-keys

- **Mục tiêu:** Khóa riêng từng service: chữ ký X-User-* theo từng service nhận, khóa gọi nội bộ theo service nhận
- **Tạo từ:** `origin/main` @ 855c92b, ngày 2026-10-10
- **Trạng thái:** xong, chờ CI
- **PR:** (chưa mở)
- **Plan:** `Plan/microservices.md` (giai đoạn A, khóa ký nội bộ)

## Thay đổi
- Trước: một khóa `AUTH_HEADER_KEY` ở identity, backend, workspace ký cả header người dùng lẫn lời gọi nội bộ → lộ ở một service
  (ví dụ workspace) là giả được Admin với backend.
- Sau: identity ký `X-User-Sig` (backend, `USER_SIG_KEY_BACKEND`) và `X-User-Sig-Ws` (workspace, `USER_SIG_KEY_WORKSPACE`); gateway chuyển
  `X-User-Sig-Ws` tới `/api/ws/` thành `X-User-Sig`. Lời gọi nội bộ ký bằng khóa của **service nhận** (`INTERNAL_KEY_BACKEND|IDENTITY|WORKSPACE`).
- `launch.py` tự thêm 5 khóa vào `.env` cũ; `.env.example`, CI, compose, README, CLAUDE.md.

## Migration / biến môi trường mới
- Mới: `USER_SIG_KEY_BACKEND`, `USER_SIG_KEY_WORKSPACE`, `INTERNAL_KEY_BACKEND`, `INTERNAL_KEY_IDENTITY`, `INTERNAL_KEY_WORKSPACE`
- Bỏ: `AUTH_HEADER_KEY` (có thể xóa khỏi `.env`)

## Đã kiểm tra
- Test Go identity (chữ ký backend/workspace khác nhau, chữ ký backend không qua được ở workspace), workspace (3 khóa khác nhau trong test), test node backend.
- Chạy thật sau khi thêm khóa: `scripts/workspace-smoke.py` qua gateway: tất cả OK (đăng nhập, workspace ↔ backend, sự kiện, việc, hẹn giờ).

## Ghi chú cho người review
- Máy đang chạy: `python launch.py` (hoặc tự thêm 5 khóa) trước `docker compose up`, vì compose báo thiếu biến.
