'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';
import { AccountCard, Notice, PasswordInput, postAuth, primaryButton } from '@/components/auth/AccountCard';

function ResetPasswordForm() {
  const token = useSearchParams().get('token') || '';
  const { openAuthModal } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setResult({ ok: false, message: 'Mật khẩu xác nhận không khớp.' });
    setBusy(true);
    setResult(await postAuth('/auth/reset-password', { token, new_password: password }));
    setBusy(false);
  };

  return (
    <AccountCard title="Đặt mật khẩu mới" icon={<Lock className="w-5 h-5" />}>
      {!token && <Notice ok={false}>Liên kết thiếu mã. Hãy mở đúng liên kết trong email.</Notice>}
      {result && <Notice ok={result.ok}>{result.message}</Notice>}
      {result?.ok ? (
        <button type="button" onClick={() => openAuthModal('login')} className={primaryButton}>Đăng nhập</button>
      ) : token && (
        <form onSubmit={submit} className="space-y-4">
          <PasswordInput label="Mật khẩu mới (ít nhất 6 ký tự)" value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordInput label="Nhập lại mật khẩu mới" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? 'Đang lưu...' : 'Lưu mật khẩu mới'}
          </button>
        </form>
      )}
    </AccountCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
