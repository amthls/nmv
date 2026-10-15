'use client';

import { useEffect, useRef, useState } from 'react';
import { glQuality } from './three/quality';
import type { HeroSceneOptions } from './three/heroScene';

/**
 * Canvas pha lê quay quanh cho banner / 404. `fallback` hiện khi không có WebGL2, reduced-motion hoặc lỗi
 * (ví dụ khối pha lê CSS tĩnh). Máy yếu vẫn chạy nhưng ít pha lê, không khử răng cưa.
 */
export default function GlHero({
  className = 'sk-gl-hero',
  fallback = null,
  ...opts
}: { className?: string; fallback?: React.ReactNode } & Omit<HeroSceneOptions, 'quality'>) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const q = glQuality();
    if (q === 'off') {
      setFailed(true);
      return;
    }
    let disposed = false;
    let dispose: (() => void) | undefined;
    import('./three/heroScene')
      .then(({ createHeroScene }) => {
        if (disposed) return;
        dispose = createHeroScene(canvas, host, { quality: q, ...opts });
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return <>{fallback}</>;
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
