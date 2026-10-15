'use client';

import dynamic from 'next/dynamic';
import { useSkin } from '@/lib/theme';

const Decor = dynamic(() => import('./Decor'), { ssr: false });
const ChibiLayer = dynamic(() => import('./ChibiLayer'), { ssr: false });

/** Gắn lớp trang trí + chibi của skin Aemeath; skin mặc định không tải gì thêm. */
export default function AemeathLayer() {
  const { skin } = useSkin();
  return skin === 'aemeath' ? (
    <>
      <Decor />
      <ChibiLayer />
    </>
  ) : null;
}
