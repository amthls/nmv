export type GlQuality = 'off' | 'low' | 'high';

let cached: GlQuality | null = null;

/**
 * Chất lượng cảnh 3D theo máy:
 * - off: reduced-motion hoặc không có WebGL2 (dùng ảnh/CSS tĩnh);
 * - low: màn nhỏ (mobile) hoặc ít nhân CPU/RAM (ít pha lê, không khử răng cưa, dpr 1);
 * - high: còn lại.
 */
export function glQuality(): GlQuality {
  if (cached) return cached;
  if (typeof window === 'undefined') return 'off';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return (cached = 'off');
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return (cached = 'off');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return (cached = 'off');
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
  const small = window.matchMedia('(max-width: 767px)').matches || window.matchMedia('(pointer: coarse)').matches;
  return (cached = weak || small ? 'low' : 'high');
}

export const MAX_DPR = 1.5;
