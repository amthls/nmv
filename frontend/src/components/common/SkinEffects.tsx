'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import AemeathLayer from '@/components/skin/aemeath/AemeathLayer';

/**
 * Đánh dấu trang đọc chương (<html data-reader>) để skin tắt hình trang trí khi đọc,
 * và gắn lớp trang trí của skin (tải lazy, chỉ khi skin bật).
 */
export default function SkinEffects() {
  const pathname = usePathname() || '';

  useEffect(() => {
    const reading = /^\/truyen\/[^/]+\/(?!lich-su(?:\/|$))[^/]+\/?$/.test(pathname);
    document.documentElement.toggleAttribute('data-reader', reading);
  }, [pathname]);

  return <AemeathLayer />;
}
