'use client';

import dynamic from 'next/dynamic';
import { useSkin } from '@/lib/theme';

const Hero = dynamic(() => import('./Hero'), { ssr: false });

/** Chỉ hiện (và chỉ tải mã) khi skin Aemeath bật. */
export default function SkinHero() {
  const { skin } = useSkin();
  if (skin !== 'aemeath') return null;
  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pt-6">
      <Hero />
    </div>
  );
}
