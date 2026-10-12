'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

const STEPS = [
  ['1. Tạo truyện', 'Đăng truyện độc lập hoặc dưới tên nhóm dịch của bạn.', '/dang-truyen'],
  ['2. Mở workspace', 'Vào Workspace, chọn truyện của nhóm rồi chọn danh mục (tập) để làm chương.', '/ws'],
  ['3. Viết hoặc dịch', 'Soạn chương trong trình soạn thảo. Bản nháp tự lưu, chỉ mình bạn thấy.', '/dang-chuong'],
  ['4. Gửi đề xuất', 'Làm xong thì gửi đề xuất để người giữ truyện hoặc trưởng nhóm xem.', '/ws'],
  ['5. Duyệt và đăng', 'Được gộp là chương lên trang, mỗi lần sửa là một phiên bản mới.', '/nhom-dich'],
] as const;

export default function WorkflowGuide() {
  return (
    <details className="group rounded-2xl border border-white/10 bg-white/[0.03]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-white">
        Hướng dẫn quy trình làm chương
        <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" />
      </summary>
      <ol className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map(([title, text, href]) => (
          <li key={title}>
            <Link href={href} className="block h-full rounded-xl border border-white/10 bg-white/5 p-3 transition hover:bg-white/10">
              <div className="text-sm font-bold text-brand-400">{title}</div>
              <p className="mt-1 text-xs text-gray-400">{text}</p>
            </Link>
          </li>
        ))}
      </ol>
    </details>
  );
}
