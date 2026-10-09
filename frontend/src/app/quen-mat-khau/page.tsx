'use client';

import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { AccountCard, Notice, postAuth, primaryButton } from '@/components/auth/AccountCard';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(await postAuth('/auth/forgot-password', { email }));
    setBusy(false);
  };

  return (
    <AccountCard title="Quên mật khẩu" icon={<Mail className="w-5 h-5" />}>
      <p className="text-sm text-gray-400">Nhập email của tài khoản. Chúng tôi sẽ gửi liên kết để bạn đặt mật khẩu mới.</p>
      {result && <Notice ok={result.ok}>{result.message}</Notice>}
      {!result?.ok && (
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-300 mb-1.5">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              placeholder="ban@example.com"
              className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition"
            />
          </label>
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? 'Đang gửi...' : 'Gửi liên kết'}
          </button>
        </form>
      )}
    </AccountCard>
  );
}
