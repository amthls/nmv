'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Reader-chosen image resolution. Uploaded images (`/uploads/...`) are requested resized
 * through `?w=<width>` (see catalog/src/services/image.service.ts); other images are untouched.
 *
 * "auto" picks a width from this device: how wide the reading column is on screen times the
 * pixel density, stepped down on slow or data-saver connections.
 */
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'full' | 'original';

/** Widths the backend can produce (IMAGE_WIDTHS in image.service.ts). */
const SERVER_WIDTHS = [480, 800, 1280, 1920];

export const IMAGE_QUALITY_OPTIONS: { id: ImageQuality; label: string; hint: string; width: number | null }[] = [
  { id: 'auto', label: 'Tự động', hint: 'Theo màn hình và mạng của máy bạn', width: null },
  { id: 'low', label: 'Tiết kiệm', hint: '480px, ít tốn dữ liệu nhất', width: 480 },
  { id: 'medium', label: 'Cân bằng', hint: '800px, hợp với điện thoại', width: 800 },
  { id: 'high', label: 'Cao', hint: '1280px, hợp với laptop', width: 1280 },
  { id: 'full', label: 'Rất cao', hint: '1920px, màn hình lớn / 2K', width: 1920 },
  { id: 'original', label: 'Gốc', hint: 'Ảnh gốc, không nén', width: null },
];

export const DEFAULT_IMAGE_QUALITY: ImageQuality = 'original';

const STORAGE_KEY = 'novelhub_image_quality';
const EVENT_NAME = 'novelhub:image-quality';

/** Widest the manga reader column gets (max-w-3xl). */
const READER_COLUMN_PX = 768;

const isQuality = (v: unknown): v is ImageQuality => IMAGE_QUALITY_OPTIONS.some((o) => o.id === v);

export interface AutoQualityInfo {
  width: number;
  screenWidth: number;
  pixelRatio: number;
  slowNetwork: boolean;
  saveData: boolean;
}

/** The width "auto" resolves to on this device right now. */
export function detectAutoQuality(): AutoQualityInfo {
  if (typeof window === 'undefined') {
    return { width: 1280, screenWidth: 0, pixelRatio: 1, slowNetwork: false, saveData: false };
  }
  const screenWidth = Math.round(window.innerWidth || window.screen?.width || 1280);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const conn = (navigator as any).connection || {};
  const saveData = Boolean(conn.saveData);
  const slowNetwork = ['slow-2g', '2g', '3g'].includes(conn.effectiveType) || (typeof conn.downlink === 'number' && conn.downlink > 0 && conn.downlink < 1.5);

  const needed = Math.min(screenWidth, READER_COLUMN_PX) * pixelRatio;
  let index = SERVER_WIDTHS.findIndex((w) => w >= needed * 0.9);
  if (index === -1) index = SERVER_WIDTHS.length - 1;
  if (saveData) index = 0;
  else if (slowNetwork) index = Math.max(0, index - 1);
  return { width: SERVER_WIDTHS[index], screenWidth, pixelRatio, slowNetwork, saveData };
}

function widthFor(quality: ImageQuality): number | null {
  if (quality === 'auto') return detectAutoQuality().width;
  return IMAGE_QUALITY_OPTIONS.find((o) => o.id === quality)?.width ?? null;
}

/** URL to request for the chosen quality; only local uploads without a query string are rewritten. */
export function imageUrlForQuality(url: string | undefined | null, quality: ImageQuality): string | undefined {
  if (!url) return undefined;
  const width = widthFor(quality);
  if (!width || !url.startsWith('/uploads/') || url.includes('?')) return url;
  return `${url}?w=${width}`;
}

/** Rewrite every local `<img src="/uploads/...">` inside sanitized HTML. */
export function rewriteHtmlImages(html: string, quality: ImageQuality): string {
  if (!html || quality === 'original') return html;
  return html.replace(/(<img\b[^>]*?\bsrc=")(\/uploads\/[^"?]+)(")/gi, (_m, pre, src, post) => {
    return `${pre}${imageUrlForQuality(src, quality)}${post}`;
  });
}

/** Current quality (saved in this browser) plus a setter that updates every mounted component. */
export function useImageQuality(): [ImageQuality, (q: ImageQuality) => void] {
  const [quality, setQualityState] = useState<ImageQuality>(DEFAULT_IMAGE_QUALITY);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isQuality(saved)) setQualityState(saved);
    } catch {}
    const onChange = (e: Event) => {
      const next = (e as CustomEvent).detail;
      if (isQuality(next)) setQualityState(next);
    };
    window.addEventListener(EVENT_NAME, onChange);
    return () => window.removeEventListener(EVENT_NAME, onChange);
  }, []);

  const setQuality = useCallback((next: ImageQuality) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    setQualityState(next);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  }, []);

  return [quality, setQuality];
}
