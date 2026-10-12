# feat/ws-personal-vs-group

- **Mục tiêu:** Tách rõ workspace của tôi và workspace nhóm
- **Tạo từ:** `origin/main` @ 10addf7, ngày 2026-10-12
- **Trạng thái:** xong
- **PR:** (điền sau khi mở)
- **Plan:** Plan/ui-overhaul.md (B6)

## Thay đổi
- `/ws` → "Workspace của tôi": tab theo chủ truyện (Truyện của tôi = tự đăng, không nhóm; Nhóm X = truyện có nhóm; Tôi cộng tác),
  tab nhóm có dải xanh lá "Mở workspace nhóm", tab của tôi / cộng tác có một câu giải thích.
- `/ws/nhom/[slug]`: đầu trang của nhóm (ảnh bìa hoặc bìa truyện làm nền, ảnh đại diện hoặc chữ cái, nhãn "Workspace nhóm",
  avatar thành viên, màu xanh lá), mục "Truyện của nhóm" (số việc đang mở, số chờ duyệt, nút Giao việc & duyệt / Chương & phiên bản).

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
- `tsc --noEmit` frontend.
- Trình duyệt: neko_trans (/ws chỉ có tab Nhóm Neko Translation + dải sang workspace nhóm; /ws/nhom/neko-translation), admin (/ws tab Truyện của tôi).
