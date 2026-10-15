'use client';

import { useCallback, useEffect, useState } from 'react';

export type ChibiMood = 'happy' | 'wink' | 'sleepy' | 'surprised' | 'sad' | 'smug';
export type ChibiPose = 'hi' | 'peek' | 'sit' | 'read' | 'sign' | 'cheer';
export type ChibiSticker = 'hi' | 'sleepy' | 'smug' | 'music';
export type ChibiArt = 'casual' | 'cheers' | 'keytar' | 'duo' | 'happy' | 'school';
export const CHIBI_ARTS: { id: ChibiArt; label: string }[] = [
  { id: 'casual', label: 'Thường phục' },
  { id: 'cheers', label: 'Cụng ly' },
  { id: 'keytar', label: 'Keytar' },
  { id: 'duo', label: 'Trên đầu bạn' },
  { id: 'happy', label: 'Cười tươi' },
  { id: 'school', label: 'Đồng phục' },
];
export type ChibiBadge = 'wink' | 'map' | 'heart' | 'wave';
export const CHIBI_BADGES: { id: ChibiBadge; label: string }[] = [
  { id: 'wave', label: 'Huy hiệu vẫy' },
  { id: 'wink', label: 'Huy hiệu nháy mắt' },
  { id: 'heart', label: 'Huy hiệu tim' },
  { id: 'map', label: 'Huy hiệu bản đồ' },
];

export const CHIBI_STICKERS: { id: ChibiSticker; label: string }[] = [
  { id: 'hi', label: 'Vẫy tay' },
  { id: 'smug', label: 'Tự hào' },
  { id: 'music', label: 'Nghe nhạc' },
  { id: 'sleepy', label: 'Buồn ngủ' },
];

const KEY = 'novelhub-ae-outfit'; // giữ tên khoá theo phiếu: 'random' hoặc tên sticker
const OFF_KEY = 'novelhub-ae-chibi';
const EVENT = 'novelhub-ae-chibi-change';

export type StickerPref = ChibiSticker | ChibiBadge | ChibiArt | 'random';

function read(): { sticker: StickerPref; enabled: boolean } {
  let sticker: StickerPref = 'random';
  let enabled = true;
  try {
    const o = localStorage.getItem(KEY);
    if (o && (CHIBI_STICKERS.some((x) => x.id === o) || CHIBI_BADGES.some((x) => x.id === o) || CHIBI_ARTS.some((x) => x.id === o))) sticker = o as StickerPref;
    enabled = localStorage.getItem(OFF_KEY) !== 'off';
  } catch {}
  return { sticker, enabled };
}

/** Xoay vòng ngẫu nhiên (ổn định theo seed + ngày) giữa sticker, huy hiệu và fan art khi người dùng để 'ngẫu nhiên'. */
export function pickAny(seed: string): { kind: 'sticker'; id: ChibiSticker } | { kind: 'art'; id: ChibiArt } {
  const all = [...CHIBI_STICKERS.map((x) => ({ kind: 'sticker' as const, id: x.id })), ...CHIBI_ARTS.map((x) => ({ kind: 'art' as const, id: x.id }))];
  const s = seed + new Date().toDateString();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return all[h % all.length] as { kind: 'sticker'; id: ChibiSticker } | { kind: 'art'; id: ChibiArt };
}

/** Sticker ổn định theo seed (vd slug truyện) khi người dùng để ngẫu nhiên. */
export function pickSticker(pref: StickerPref, seed = ''): ChibiSticker {
  if (pref !== 'random' && CHIBI_STICKERS.some((x) => x.id === pref)) return pref as ChibiSticker;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CHIBI_STICKERS[h % CHIBI_STICKERS.length].id;
}

/** Tuỳ chọn trợ lý chibi (lưu localStorage, đồng bộ giữa các component). */
export function useChibiPrefs() {
  const [state, setState] = useState<{ sticker: StickerPref; enabled: boolean }>({ sticker: 'random', enabled: true });
  useEffect(() => {
    setState(read());
    const sync = () => setState(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const setSticker = useCallback((o: StickerPref) => {
    try {
      localStorage.setItem(KEY, o);
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  }, []);
  const setEnabled = useCallback((on: boolean) => {
    try {
      if (on) localStorage.removeItem(OFF_KEY);
      else localStorage.setItem(OFF_KEY, 'off');
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { ...state, setSticker, setEnabled };
}
