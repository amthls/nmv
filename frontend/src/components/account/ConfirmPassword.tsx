'use client';

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck } from 'lucide-react';
import { PasswordInput, primaryButton } from '@/components/auth/AccountCard';

/**
 * Dangerous account actions (roles, ban, delete) ask for the actor's own password again, so a stolen session
 * alone is not enough. `ask(title, detail)` resolves with the typed password, or null when cancelled.
 * Rendered in a portal: a fixed dialog inside a backdrop-filter box would be trapped in that box.
 */
export function useConfirmPassword() {
  const [open, setOpen] = useState<{ title: string; detail?: string } | null>(null);
  const [password, setPassword] = useState('');
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const ask = (title: string, detail?: string) =>
    new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setPassword('');
      setOpen({ title, detail });
    });

  const finish = (value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(null);
    setPassword('');
  };

  const dialog = open && typeof document !== 'undefined'
    ? createPortal(
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => finish(null)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); if (password) finish(password); }}
            className="w-full max-w-sm rounded-3xl bg-glass border border-white/10 p-6 space-y-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-password-title"
          >
            <h3 id="confirm-password-title" className="text-sm font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400" /> {open.title}
            </h3>
            {open.detail && <p className="text-xs text-gray-400 whitespace-pre-line">{open.detail}</p>}
            <PasswordInput label="Nhập mật khẩu của bạn để xác nhận" value={password} onChange={setPassword} autoComplete="current-password" />
            <div className="flex gap-2">
              <button type="button" onClick={() => finish(null)} className="flex-1 h-11 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-semibold transition">
                Hủy
              </button>
              <button type="submit" disabled={!password} className={`flex-1 ${primaryButton}`}>Xác nhận</button>
            </div>
          </form>
        </div>,
        document.body
      )
    : null;

  return { ask, dialog };
}
