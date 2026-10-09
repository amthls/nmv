# Kế hoạch: Đưa code lên GitHub + nâng Next.js 14 → 15

> Làm xong mục nào đổi `[ ]` → `[x]`. Phiên mới: đọc file này, làm tiếp mục `[ ]` đầu tiên.
> Bắt đầu: 2026-10-09. Tiếp nối `Plan/scale-phase1.md` (đã xong).

## Bối cảnh
- `fix/notification-checks` chưa từng push, không có commit riêng (trùng `main` @ 285e964); mọi việc (album, gợi ý, fandom, DM, cài đặt thông báo, scale phase 1) đang nằm ở dạng chưa commit.
- Chủ dự án yêu cầu: tạo nhánh mới dựa trên nhánh đó chứa toàn bộ việc hiện tại, commit, push; nâng Next 15.

## Checklist

### A. Commit + push
- [x] Tạo nhánh `feat/scale-phase1` từ `fix/notification-checks` (mang theo working tree)
- [x] Commit 1: toàn bộ việc hiện có (`.env` bị ignore, đã kiểm không có secret)
- [x] Push `-u origin feat/scale-phase1`, xem CI chạy trên GitHub (`gh run list`)

### B. Next.js 14 → 15
- [x] Đọc phiên bản hiện tại (next, react, eslint-config-next) và chỗ dùng API bị đổi ở Next 15:
  - `params` / `searchParams` trong page/layout/generateMetadata **là Promise** (server component); client component dùng `useParams()` thì không ảnh hưởng
  - `cookies()`, `headers()` từ `next/headers` thành async
  - `fetch` mặc định không cache nữa (`no-store`)
  - React 19 (hoặc giữ React 18 — Next 15 App Router yêu cầu React 19)
- [x] `yarn add next@15 react@19 react-dom@19` (+ `@types/react@19`, `@types/react-dom@19`, `eslint-config-next@15`)
- [x] Sửa lỗi typecheck / build
- [x] `next.config.mjs`: kiểm tra option đổi tên (ví dụ `experimental.serverComponentsExternalPackages` → `serverExternalPackages`)
- [x] Rebuild frontend Docker, mở thử các trang chính (trang chủ, truyện, đọc chương, fandom, tin nhắn, tài khoản, admin)
- [x] Trivy quét image frontend: 0 CRITICAL → xóa 2 dòng Next trong `.trivyignore`
- [x] README: cập nhật phiên bản Next/React, bỏ ghi chú CVE Next 14 trong "Lộ trình bảo mật" và "Hạn chế đã biết"
- [x] Commit 2 + push, CI xanh

## Ghi chú
- Sửa frontend xong phải `docker compose up -d --build frontend`.
- Không merge vào `main`, không tạo PR khi chưa được hỏi.

## Kết quả (2026-10-09)
- Nhánh `feat/scale-phase1` đã push. CI lần 1: typecheck xanh, smoke đỏ vì `aquasecurity/trivy-action@0.28.0` không còn tồn tại → đổi sang `@v0.36.0` (tag mới có tiền tố `v`).
- Next 15.5.27 + React 19.2: chỉ 3 lỗi kiểu (React 19 bắt `useRef(undefined)`, `img src` có thêm `Blob` → SmartImage nhận `src?: string`). Gần như mọi trang là client component nên không phải sửa `params`/`cookies()`.
- Đã thử trên Chrome: trang chủ, đọc chương, đăng chương (CKEditor), tin nhắn — không lỗi console. Mọi route trả 200 (route sai 404).
- Trivy (không file ignore): 0 CRITICAL → `.trivyignore` chỉ còn phần chú thích. Còn 13 HIGH (brace-expansion, postcss, picomatch… phần lớn trong npm có sẵn của image Node), CI không chặn HIGH — để sau.
