'use client';

import React, { useEffect, useRef } from 'react';

// Cloudflare Turnstile (bot check) on sign-up and forgot-password. Off unless the site key is set at build time
// (NEXT_PUBLIC_TURNSTILE_SITE_KEY, with TURNSTILE_SECRET on the identity service).
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void };
  }
}

let scriptLoading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  scriptLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptLoading = null; reject(new Error('turnstile script')); };
    document.head.appendChild(s);
  });
  return scriptLoading;
}

/** The widget; reports a token (or '' when it expires). A token works once: remount (change `key`) after a submit. */
export default function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let id: string | undefined;
    let gone = false;
    loadScript().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        language: 'vi',
        callback: (t: string) => cb.current(t),
        'expired-callback': () => cb.current(''),
        'error-callback': () => cb.current(''),
      });
    }).catch(() => {});
    return () => {
      gone = true;
      if (id) window.turnstile?.remove(id);
      cb.current('');
    };
  }, []);

  return TURNSTILE_SITE_KEY ? <div ref={box} className="min-h-[65px]" /> : null;
}
