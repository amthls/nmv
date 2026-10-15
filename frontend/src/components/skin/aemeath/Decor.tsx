'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Lớp trang trí của skin Aemeath (chỉ được tải khi skin bật, xem AemeathLayer):
 * pha lê 3D, parallax sprite, nghiêng 3D card theo chuột, vệt sao theo con trỏ, viên sáng trượt ở thanh nav.
 * Mọi hiệu ứng theo chuột chỉ chạy trên thiết bị có hover và tắt khi prefers-reduced-motion.
 */
export default function Decor() {
  const pathname = usePathname() || '';

  // Viên sáng trượt theo mục nav đang chọn
  useEffect(() => {
    const nav = document.querySelector('header nav') as HTMLElement | null;
    if (!nav) return;
    let glow = nav.querySelector('.sk-nav-glow') as HTMLElement | null;
    if (!glow) {
      glow = document.createElement('span');
      glow.className = 'sk-nav-glow';
      glow.setAttribute('aria-hidden', 'true');
      nav.prepend(glow);
    }
    const place = () => {
      const a = nav.querySelector('a[aria-current="page"]') as HTMLElement | null;
      if (!glow) return;
      if (!a) {
        glow.style.opacity = '0';
        return;
      }
      glow.style.opacity = '1';
      glow.style.width = `${a.offsetWidth}px`;
      glow.style.transform = `translateX(${a.offsetLeft}px)`;
    };
    const t = window.setTimeout(place, 30);
    window.addEventListener('resize', place);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', place);
    };
  }, [pathname]);
  useEffect(
    () => () => {
      document.querySelector('header nav .sk-nav-glow')?.remove();
    },
    [],
  );

  // Hiệu ứng theo chuột
  useEffect(() => {
    const root = document.documentElement;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let last: PointerEvent | null = null;
    let tile: HTMLElement | null = null;
    let lastTrail = 0;

    const resetTile = () => {
      if (!tile) return;
      tile.style.removeProperty('--rx');
      tile.style.removeProperty('--ry');
      tile = null;
    };
    const sparkle = (x: number, y: number) => {
      const el = document.createElement('span');
      el.className = 'sk-trail';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      document.body.appendChild(el);
      const dx = (Math.random() - 0.5) * 24;
      el.animate(
        [
          { opacity: 0.9, transform: 'translate(0,0) scale(1) rotate(0deg)' },
          { opacity: 0, transform: `translate(${dx}px, 22px) scale(0.2) rotate(120deg)` },
        ],
        { duration: 650, easing: 'ease-out' },
      ).finished.finally(() => el.remove());
    };
    const frame = () => {
      raf = 0;
      const e = last;
      if (!e) return;
      root.style.setProperty('--px', String((e.clientX / window.innerWidth - 0.5) * 2));
      root.style.setProperty('--py', String((e.clientY / window.innerHeight - 0.5) * 2));
      const t = (e.target as Element | null)?.closest?.('.tile') as HTMLElement | null;
      if (t !== tile) resetTile();
      if (t) {
        tile = t;
        const r = t.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        t.style.setProperty('--ry', `${((x - 0.5) * 12).toFixed(2)}deg`);
        t.style.setProperty('--rx', `${((0.5 - y) * 12).toFixed(2)}deg`);
        t.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        t.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      }
      const now = performance.now();
      if (now - lastTrail > 70) {
        lastTrail = now;
        sparkle(e.clientX, e.clientY);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      last = e;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const sync = () => {
      const on = fine.matches && !reduced.matches;
      root.classList.toggle('sk-tilt', on);
      window.removeEventListener('pointermove', onMove);
      if (on) window.addEventListener('pointermove', onMove, { passive: true });
    };
    sync();
    fine.addEventListener('change', sync);
    reduced.addEventListener('change', sync);
    return () => {
      fine.removeEventListener('change', sync);
      reduced.removeEventListener('change', sync);
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
      root.classList.remove('sk-tilt');
      root.style.removeProperty('--px');
      root.style.removeProperty('--py');
    };
  }, []);

  return (
    <div className="sk-crystals" aria-hidden="true">
      {[0, 1, 2].map((n) => (
        <div key={n} className="sk-crystal">
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}
