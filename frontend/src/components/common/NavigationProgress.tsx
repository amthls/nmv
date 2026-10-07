'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import BookLoader from './BookLoader';

const BAR_DELAY_MS = 250; // do not show anything for fast loads
const TOAST_DELAY_MS = 1500; // "loading data" pill only when a request is really slow
const VERY_SLOW_MS = 10000;

/**
 * Global loading feedback, mounted once in the root layout:
 *  - a thin animated bar at the top while a page navigation or an API request is pending;
 *  - a small "loading data" pill when something is still pending after 1.5s.
 * API requests are detected by wrapping window.fetch for `/api/v1` calls.
 */
export default function NavigationProgress() {
  const pathname = usePathname();
  const [pending, setPending] = useState(0); // in-flight API requests
  const [navigating, setNavigating] = useState(false);
  const [showBar, setShowBar] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [verySlow, setVerySlow] = useState(false);
  const navTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const busy = pending > 0 || navigating;

  // Count in-flight API requests
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = function patchedFetch(this: unknown, ...args: Parameters<typeof fetch>) {
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url || '';
      const tracked = url.includes('/api/v1') && !url.includes('/history') && !url.includes('/notifications');
      if (!tracked) return originalFetch.apply(window, args);
      setPending((n) => n + 1);
      return originalFetch.apply(window, args).finally(() => setPending((n) => Math.max(0, n - 1)));
    } as typeof fetch;
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // A click on an internal link starts a navigation; the pathname change (or a timeout) ends it
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setNavigating(true);
      if (navTimeout.current) clearTimeout(navTimeout.current);
      navTimeout.current = setTimeout(() => setNavigating(false), 15000); // safety net
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      if (navTimeout.current) clearTimeout(navTimeout.current);
    };
  }, []);

  useEffect(() => {
    setNavigating(false);
  }, [pathname]);

  // Delayed visibility, so quick loads never flash anything
  useEffect(() => {
    if (!busy) {
      setShowBar(false);
      setShowToast(false);
      setVerySlow(false);
      return;
    }
    const timers = [
      setTimeout(() => setShowBar(true), BAR_DELAY_MS),
      setTimeout(() => setShowToast(true), TOAST_DELAY_MS),
      setTimeout(() => setVerySlow(true), VERY_SLOW_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [busy]);

  return (
    <>
      <div className={`nh-progress ${showBar ? 'nh-progress--on' : ''}`} role="progressbar" aria-hidden={!showBar} />
      {showToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-[150] flex items-center gap-3 pl-3 pr-4 py-2.5 rounded-2xl bg-glass backdrop-blur border border-white/10 shadow-2xl nh-loader-fade"
        >
          <BookLoader size="sm" label="" />
          <span className="text-xs font-semibold text-gray-200">
            {verySlow ? 'Mạng đang chậm, vui lòng đợi thêm...' : 'Đang tải dữ liệu...'}
          </span>
        </div>
      )}
    </>
  );
}
