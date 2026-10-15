'use client';

import { useEffect, useRef } from 'react';
import { glQuality } from './three/quality';

/** Canvas nền WebGL của skin Aemeath (một canvas toàn site). Chỉ máy đủ mạnh mới chạy; còn lại giữ nền ảnh tĩnh. */
export default function GlBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const q = glQuality();
    const burst = (window as unknown as { __nhSkinBurst?: { x: number; y: number; t: number } }).__nhSkinBurst;
    // Máy yếu/mobile/reduced-motion: không tải three, giữ nền ảnh tĩnh (đổi skin vẫn có vòng tròn + lóe sáng CSS)
    if (q !== 'high') return;
    let disposed = false;
    let dispose: (() => void) | undefined;
    import('./three/bgScene')
      .then(({ createBgScene }) => {
        if (disposed) return;
        const scene = createBgScene(canvas);
        dispose = scene.dispose;
        if (burst && performance.now() - burst.t < 6000) {
          scene.burst(burst.x, burst.y);
          delete (window as unknown as { __nhSkinBurst?: unknown }).__nhSkinBurst;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      dispose?.();
    };
  }, []);

  return <canvas ref={ref} className="sk-gl-bg" aria-hidden="true" />;
}
