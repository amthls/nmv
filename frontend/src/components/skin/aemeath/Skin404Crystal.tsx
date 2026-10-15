'use client';

import { useSkin } from '@/lib/theme';
import GlHero from './GlHero';

/** Pha lê 3D lơ lửng xoay cạnh sprite ở trang 404/trống; chỉ khi skin Aemeath bật. */
export default function Skin404Crystal() {
  const { skin } = useSkin();
  if (skin !== 'aemeath') return null;
  return (
    <div className="relative w-56 h-24 -mt-2" aria-hidden="true">
      <GlHero radius={1.5} count={3} />
    </div>
  );
}
