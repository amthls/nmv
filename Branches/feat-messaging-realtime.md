# feat/messaging-realtime

- **Mục tiêu:** Giai đoạn E1: service messaging (Go) giữ WebSocket thường thay Socket.IO
- **Tạo từ:** `origin/main` @ 5c1735b, ngày 2026-10-10
- **Trạng thái:** xong, chờ CI
- **PR:** https://github.com/amthls/nmv/pull/68
- **Plan:** `Plan/messaging.md` (E1), `Plan/microservices.md` (giai đoạn E)

## Thay đổi
- `services/messaging` (Go, container `messaging`, không DB): `GET /ws` (gateway `/api/msg/ws`), chỉ người đăng nhập (`USER_SIG_KEY_MESSAGING`);
  hub theo người dùng (mỗi tab một kết nối, tối đa 10/tài khoản), ping 30 s / cắt sau 45 s, nhận `rt:events` từ Redis, `_disconnect`;
  lệnh `messaging loadtest`.
- Backend: `emitToUsers`/`disconnectUser` = `PUBLISH rt:events`; bỏ Socket.IO (`socket.io`, redis adapter/emitter).
- Frontend: `lib/realtime.ts` WebSocket thường (nối lại chờ ngẫu nhiên tăng dần, làm mới phiên khi bị từ chối, đóng khi tab ẩn 5 phút,
  nối lại xong các trang tự tải lại); bỏ `socket.io-client`.
- Gateway: `/api/msg/ws` (giới hạn kết nối mới 1/s/IP), bỏ `/socket.io/`, `worker_connections 16384`, `worker_rlimit_nofile`; compose `nofile 65536`.
- identity ký `X-User-Sig-Msg`; CI job Go + Trivy, deploy build/pull messaging.

## Migration / biến môi trường mới
- Mới: `USER_SIG_KEY_MESSAGING` (launch.py tự thêm)

## Đã kiểm tra
- `go test` messaging (chữ ký, hub qua lớp log: khách 401, đẩy tới mọi tab, cùng tab thay kết nối cũ, `_disconnect`), identity; `tsc` backend/frontend.
- Qua gateway (`rt_e2e.mjs` với WebSocket của Node): khách bị từ chối; 2 tab của hana + 1 của yuki; hana gửi tin → cả 3 nhận `dm`; mở lại cùng tab → kết nối cũ đóng mã 4000.
- Thử tải 2.000 kết nối: nối trong 0,3 s, đẩy p95 20 ms, ~37 KB/kết nối.
- **Chưa thử trên trình duyệt** (tiện ích Chrome không kết nối).

## Ghi chú cho người review
-
