'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import GlBackground from './GlBackground';

/**
 * Lớp trang trí của skin Aemeath (chỉ được tải khi skin bật, xem AemeathLayer):
 * - canvas WebGL nền (Three.js, một canvas toàn site, xem GlBackground);
 * - sprite hologram đứng yên (.sk-holo), mờ bớt khi cuộn hoặc khi con trỏ lại gần;
 * - viên sáng trượt ở thanh nav;
 * - nghiêng 3D thẻ truyện (.tile) theo chuột (chỉ thiết bị có hover, tắt khi reduced-motion).
 * Không có hiệu ứng theo chuột cho ảnh nền hay sprite.
 */
export default function Decor() {
  const pathname = usePathname() || '';
  const holo = useRef<HTMLDivElement>(null);

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

  // Sprite mờ bớt khi cuộn xuống hoặc con trỏ lại gần vùng sprite
  useEffect(() => {
    const el = holo.current;
    if (!el) return;
    let scrolled = false;
    let near = false;
    const apply = () => el.classList.toggle('is-dim', scrolled || near);
    const onScroll = () => {
      scrolled = window.scrollY > 240;
      apply();
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      near = e.clientX > r.left - 60 && e.clientY > r.top - 40;
      apply();
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  // Nghiêng 3D thẻ truyện theo chuột
  useEffect(() => {
    const root = document.documentElement;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let last: PointerEvent | null = null;
    let tile: HTMLElement | null = null;

    const resetTile = () => {
      if (!tile) return;
      tile.style.removeProperty('--rx');
      tile.style.removeProperty('--ry');
      tile = null;
    };
    const frame = () => {
      raf = 0;
      const e = last;
      if (!e) return;
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
    };
  }, []);

  return (
    <>
      <GlBackground />
      <div ref={holo} className="sk-holo" aria-hidden="true">
        <div className="sk-holo__body">
          <div className="sk-holo__base" />
          <div className="sk-holo__img" />
          <div className="sk-holo__scan" />
        </div>
      </div>
    </>
  );
}
