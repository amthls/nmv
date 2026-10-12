'use client';

import React, { useEffect, useState } from 'react';
import { Hourglass } from 'lucide-react';

const AUTO_RETRY_MAX_S = 5;

/**
 * A 429 from any of our APIs (Plan/load.md A6/B4), mounted once in the root layout:
 *  - shows "Bạn thao tác hơi nhanh, thử lại sau N giây" with a countdown, instead of a bare error;
 *  - a read (GET) that only has to wait a few seconds waits and is sent again once; a write is never resent
 *    (the person decides, so nothing is posted twice).
 */
export default function RateLimitNotice() {
  const [until, setUntil] = useState(0);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const original = window.fetch;
    window.fetch = async function rateLimitAware(this: unknown, ...args: Parameters<typeof fetch>) {
      const res = await original.apply(window, args);
      if (res.status !== 429) return res;
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (new URL(url, window.location.href).origin !== window.location.origin) return res;
      const seconds = Math.max(1, Number(res.headers.get('Retry-After')) || 2);
      const body = await res.clone().json().catch(() => ({}));
      setMessage(body?.message || 'Bạn thao tác hơi nhanh, vui lòng chờ một chút.');
      setNow(Date.now());
      setUntil((u) => Math.max(u, Date.now() + seconds * 1000));
      const method = (args[1]?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method !== 'GET' || seconds > AUTO_RETRY_MAX_S) return res;
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return original.apply(window, args);
    } as typeof fetch;
    return () => {
      window.fetch = original;
    };
  }, []);

  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);

  const left = Math.ceil((until - now) / 1000);
  if (left <= 0) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[160] flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 backdrop-blur text-amber-100 text-xs font-semibold shadow-2xl max-w-[calc(100vw-32px)]">
      <Hourglass className="w-4 h-4 shrink-0 text-amber-300" />
      <span>{message} Thử lại sau <b className="tabular-nums">{left}</b> giây.</span>
    </div>
  );
}
