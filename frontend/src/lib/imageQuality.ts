'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Reader-chosen image resolution. Uploaded images (`/uploads/...`) are requested resized
 * through `?w=<width>` (see backend/src/services/image.service.ts); other images are untouched.
 */
export type ImageQuality = 'low' | 'medium' | 'high' | 'original';

export const IMAGE_QUALITY_OPTIONS: { id: ImageQuality; label: string; hint: string; width: number | null }[] = [
  { id: 'low', label: 'Tiết kiệm', hint: '480px, ít tốn dữ liệu', width: 480 },
  { id: 'medium', label: 'Cân bằng', hint: '800px', width: 800 },
  { id: 'high', label: 'Cao', hint: '1280px', width: 1280 },
  { id: 'original', label: 'Gốc', hint: 'Không nén', width: null },
];

export const DEFAULT_IMAGE_QUALITY: ImageQuality = 'high';

const STORAGE_KEY = 'novelhub_image_quality';
const EVENT_NAME = 'novelhub:image-quality';

const isQuality = (v: unknown): v is ImageQuality => IMAGE_QUALITY_OPTIONS.some((o) => o.id === v);

/** URL to request for the chosen quality; only local uploads without a query string are rewritten. */
export function imageUrlForQuality(url: string | undefined | null, quality: ImageQuality): string | undefined {
  if (!url) return undefined;
  const width = IMAGE_QUALITY_OPTIONS.find((o) => o.id === quality)?.width;
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
