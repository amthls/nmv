#!/bin/sh
# "Back" goes through frontend/src/lib/nav.ts only (Plan/navigation.md): no raw history back, no history.length guess,
# no hard-coded breadcrumb. Run before merging a frontend change: sh scripts/check-nav.sh
cd "$(dirname "$0")/../frontend/src" || exit 1
hits=$(grep -rnE 'router\.back\(|window\.history\.(back|go)\(|window\.history\.length|Trang chủ</Link>' --include='*.ts' --include='*.tsx' . \
  | grep -vE '^\./(lib/nav\.ts|components/common/BackLink\.tsx):')
if [ -n "$hits" ]; then
  echo "Dùng BackLink / BackButton / goBack (lib/nav.ts) thay vì:"
  echo "$hits"
  exit 1
fi
echo "check-nav: ok"
