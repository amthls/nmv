#!/bin/sh
# Start a new piece of work: a fresh branch from the latest origin/main plus its Branches/<name>.md file.
#   sh scripts/new-branch.sh feat/forgot-password "Cho người dùng đặt lại mật khẩu qua email"
# Uncommitted changes are carried over to the new branch (git refuses if they conflict with main).
set -e

name="$1"
goal="${2:-(điền mục tiêu)}"

if ! echo "$name" | grep -Eq '^(feat|fix|security|chore|docs|refactor)/[a-z0-9][a-z0-9-]*$'; then
  echo "Cách dùng: sh scripts/new-branch.sh <loại>/<tên-ngắn> \"Mục tiêu\"" >&2
  echo "  <loại>: feat | fix | security | chore | docs | refactor" >&2
  echo "  <tên-ngắn>: chữ thường không dấu, số, dấu -   (ví dụ feat/forgot-password)" >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

if git show-ref --quiet "refs/heads/$name" || git ls-remote --exit-code --heads origin "$name" >/dev/null 2>&1; then
  echo "Nhánh '$name' đã tồn tại (ở máy hoặc trên GitHub). Chọn tên khác." >&2
  exit 1
fi

git fetch --quiet origin main
# --no-track: a plain `git push` must never go to main
git switch --no-track -c "$name" origin/main

file="Branches/$(echo "$name" | tr '/' '-').md"
mkdir -p Branches
cat > "$file" <<EOF
# $name

- **Mục tiêu:** $goal
- **Tạo từ:** \`origin/main\` @ $(git rev-parse --short origin/main), ngày $(date +%Y-%m-%d)
- **Trạng thái:** đang làm
- **PR:** (chưa mở)
- **Plan:** (Plan/<tên>.md nếu có)

## Thay đổi
-

## Migration / biến môi trường mới
- Không có

## Đã kiểm tra
-

## Ghi chú cho người review
-
EOF

echo ""
echo "Đã tạo nhánh $name từ origin/main ($(git rev-parse --short origin/main))."
echo "Điền thông tin nhánh vào $file và commit cùng code."
