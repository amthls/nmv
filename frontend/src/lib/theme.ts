'use client';

import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

export type Theme = 'light' | 'dark';

import { THEME_STORAGE_KEY as STORAGE_KEY, SKIN_STORAGE_KEY } from './themeScript';
const EVENT = 'novelhub-theme-change';


function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(readTheme());
    const sync = () => setTheme(readTheme());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  /** Switch theme; when an origin point is given, the new theme grows out of it as a circle. */
  const toggle = useCallback((origin?: { x: number; y: number }) => {
    const next: Theme = readTheme() === 'dark' ? 'light' : 'dark';
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!doc.startViewTransition || reduced || !origin) {
      applyTheme(next);
      setTheme(next);
      return;
    }

    const radius = Math.hypot(
      Math.max(origin.x, window.innerWidth - origin.x),
      Math.max(origin.y, window.innerHeight - origin.y),
    );
    const transition = doc.startViewTransition(() => {
      flushSync(() => {
        applyTheme(next);
        setTheme(next);
      });
    });
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
        { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
  }, []);

  return { theme, toggle };
}

/** Skin = bộ màu và hình nền trang trí, độc lập với sáng/tối. */
export type Skin = 'default' | 'aemeath';
const SKIN_EVENT = 'novelhub-skin-change';

function readSkin(): Skin {
  if (typeof document === 'undefined') return 'default';
  return document.documentElement.classList.contains('skin-aemeath') ? 'aemeath' : 'default';
}

function applySkin(skin: Skin) {
  document.documentElement.classList.toggle('skin-aemeath', skin === 'aemeath');
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, skin);
  } catch {}
  window.dispatchEvent(new CustomEvent(SKIN_EVENT, { detail: skin }));
}

export function useSkin() {
  const [skin, setSkinState] = useState<Skin>('default');

  useEffect(() => {
    setSkinState(readSkin());
    const sync = () => setSkinState(readSkin());
    window.addEventListener(SKIN_EVENT, sync);
    return () => window.removeEventListener(SKIN_EVENT, sync);
  }, []);

  /** Đổi skin; có điểm gốc thì lan vòng tròn (View Transition) kèm lóe sáng hồng-cyan. */
  const setSkin = useCallback((next: Skin, origin?: { x: number; y: number }) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || reduced || !origin) {
      applySkin(next);
      setSkinState(next);
      return;
    }
    const radius = Math.hypot(
      Math.max(origin.x, window.innerWidth - origin.x),
      Math.max(origin.y, window.innerHeight - origin.y),
    );
    const transition = doc.startViewTransition(() => {
      flushSync(() => {
        applySkin(next);
        setSkinState(next);
      });
    });
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
        { duration: 750, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
      );
      const flash = document.createElement('div');
      flash.className = 'sk-flash';
      flash.style.setProperty('--fx', `${origin.x}px`);
      flash.style.setProperty('--fy', `${origin.y}px`);
      document.body.appendChild(flash);
      flash.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0 }], { duration: 800, easing: 'ease-out' }).finished
        .finally(() => flash.remove());
    });
  }, []);

  return { skin, setSkin };
}
