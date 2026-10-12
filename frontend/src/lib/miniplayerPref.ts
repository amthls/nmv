'use client';

import { useCallback, useEffect, useState } from 'react';

/** Whether the "continue reading" popup is shown. Saved in this browser; every component using it stays in step. */
const KEY = 'novelhub_miniplayer_enabled';
const EVENT = 'novelhub:miniplayer-enabled';

export function useMiniplayerEnabled(): [boolean, (on: boolean) => void] {
  const [enabled, setState] = useState(true);

  useEffect(() => {
    try { if (window.localStorage.getItem(KEY) === '0') setState(false); } catch {}
    const onChange = (e: Event) => setState(Boolean((e as CustomEvent).detail));
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const set = useCallback((on: boolean) => {
    try { window.localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
    setState(on);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
  }, []);

  return [enabled, set];
}
