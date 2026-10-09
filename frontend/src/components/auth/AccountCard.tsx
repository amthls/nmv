'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

/** POST JSON to the auth API; returns { ok, message } and never throws. */
export async function postAuth(path: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.success !== false, message: data.message || (res.ok ? 'Xong.' : 'Có lỗi xảy ra.') };
  } catch {
    return { ok: false, message: 'Không kết nối được máy chủ.' };
  }
}

/** Centered card used by the forgot / reset password and email verification pages. */
export function AccountCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto px-4 py-16 sm:py-24">
      <div className="rounded-2xl bg-white/5 border border-white/10 p-6 sm:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-600/20 text-brand-300 flex items-center justify-center">{icon}</div>
          <h1 className="text-lg font-bold text-white">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Notice({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`p-3 rounded-xl text-sm flex items-start gap-2 border ${
      ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
    }`}>
      {ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

export function PasswordInput({ label, value, onChange, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-300 mb-1.5">{label}</span>
      <span className="relative block">
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          className="w-full h-11 pl-10 pr-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition"
        />
        <KeyRound className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
      </span>
    </label>
  );
}

export const primaryButton =
  'w-full h-11 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm flex items-center justify-center gap-2 transition disabled:opacity-50';
