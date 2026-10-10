'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MailCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';
import { AccountCard, Notice, postAuth, primaryButton } from '@/components/auth/AccountCard';

function VerifyEmail() {
  const token = useSearchParams().get('token') || '';
  const { refreshProfile } = useAuth();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const sent = useRef(false); // the token is single-use: do not post it twice (React strict mode)

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    postAuth('/verify-email', { token }).then((r) => {
      setResult(r);
      if (r.ok) refreshProfile?.();
    });
  }, [token, refreshProfile]);

  return (
    <AccountCard title="Xác thực email" icon={<MailCheck className="w-5 h-5" />}>
      {!token && <Notice ok={false}>Liên kết thiếu mã. Hãy mở đúng liên kết trong email.</Notice>}
      {token && !result && <p className="text-sm text-gray-400">Đang xác thực...</p>}
      {result && <Notice ok={result.ok}>{result.message}</Notice>}
      {result && !result.ok && (
        <p className="text-xs text-gray-400">Bạn có thể gửi lại email xác thực trong <Link href="/tai-khoan" className="text-brand-400">Tài khoản → Bảo mật</Link>.</p>
      )}
      {result?.ok && <Link href="/" className={primaryButton}>Về trang chủ</Link>}
    </AccountCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <VerifyEmail />
    </Suspense>
  );
}
