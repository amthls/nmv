'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Hash } from 'lucide-react';
import PageLoader from '@/components/common/PageLoader';
import { explainCode } from '@/components/common/CodeBadge';
import { useAuth } from '@/context/AuthContext';
import { apiJson } from '@/lib/apiJson';

/** /ma/LN-JA-G03-0042 opens the story, /ma/U-AD-26-0007 the profile, and so on. */
export default function CodePage() {
  const code = decodeURIComponent(String(useParams().code || '')).trim().toUpperCase();
  const router = useRouter();
  const { authFetch, isLoading } = useAuth();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (isLoading) return; // private albums and reports need the session
    apiJson(authFetch, `/codes/${encodeURIComponent(code)}`)
      .then(({ ok, json }) => (ok ? router.replace(json.data.path) : setNotFound(true)))
      .catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, isLoading]);

  if (!notFound) return <PageLoader />;
  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center space-y-3">
      <Hash className="w-10 h-10 mx-auto text-brand-400" />
      <h1 className="text-lg font-bold text-white">Không tìm thấy mã <span className="font-mono">{code}</span></h1>
      {explainCode(code) !== code && <p className="text-sm text-gray-400">{explainCode(code)}</p>}
      <p className="text-sm text-gray-400">Mã sai, nội dung đã bị ẩn hoặc bạn không có quyền xem.</p>
      <Link href="/" className="inline-block text-sm font-semibold text-brand-300 hover:text-brand-200">Về trang chủ</Link>
    </div>
  );
}
