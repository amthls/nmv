'use client';

import dynamic from 'next/dynamic';
import { useSkin } from '@/lib/theme';

const Decor = dynamic(() => import('./Decor'), { ssr: false });

/** Gắn lớp trang trí của skin Aemeath; skin mặc định không tải gì thêm. */
export default function AemeathLayer() {
  const { skin } = useSkin();
  return skin === 'aemeath' ? <Decor /> : null;
}
