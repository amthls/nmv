'use client';

import React, { useEffect, useState } from 'react';
import { KeyRound, LogOut, MailCheck, MailWarning } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { API_BASE_URL, Notice, PasswordInput, primaryButton } from '@/components/auth/AccountCard';

type Result = { ok: boolean; message: string } | null;

/** Account page tab: change password, email verification status, log out of every device. */
export default function SecurityTab() {
  const { authFetch, setSessionToken, logout } = useAuth();
  const [me, setMe] = useState<{ email: string; email_verified: boolean } | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwResult, setPwResult] = useState<Result>(null);
  const [mailResult, setMailResult] = useState<Result>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    authFetch(`${API_BASE_URL}/auth/me`)
      .then((r) => r.json())
      .then((j) => j.success && setMe({ email: j.data.email, email_verified: !!j.data.email_verified }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = async (path: string, body?: unknown) => {
    try {
      const res = await authFetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok && json.success !== false, message: json.message || 'Có lỗi xảy ra.', data: json.data };
    } catch {
      return { ok: false, message: 'Không kết nối được máy chủ.', data: null };
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setPwResult({ ok: false, message: 'Mật khẩu xác nhận không khớp.' });
    setPwBusy(true);
    const r = await post('/auth/change-password', { current_password: current, new_password: next });
    if (r.ok && r.data?.token) setSessionToken(r.data.token); // old tokens were revoked, keep this device signed in
    if (r.ok) { setCurrent(''); setNext(''); setConfirm(''); }
    setPwResult(r);
    setPwBusy(false);
  };

  const resend = async () => {
    setMailBusy(true);
    setMailResult(await post('/auth/resend-verification'));
    setMailBusy(false);
  };

  const logoutEverywhere = async () => {
    if (!window.confirm('Đăng xuất khỏi mọi thiết bị, kể cả thiết bị này?')) return;
    setLogoutBusy(true);
    await post('/auth/logout-all');
    logout();
  };

  const card = 'p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4';

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={changePassword} className={card}>
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><KeyRound className="w-4 h-4 text-brand-400" /> Đổi mật khẩu</h3>
        {pwResult && <Notice ok={pwResult.ok}>{pwResult.message}</Notice>}
        <PasswordInput label="Mật khẩu hiện tại" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordInput label="Mật khẩu mới (ít nhất 6 ký tự)" value={next} onChange={setNext} autoComplete="new-password" />
        <PasswordInput label="Nhập lại mật khẩu mới" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <p className="text-xs text-gray-500">Đổi mật khẩu sẽ đăng xuất các thiết bị khác.</p>
        <button type="submit" disabled={pwBusy} className={primaryButton}>{pwBusy ? 'Đang lưu...' : 'Đổi mật khẩu'}</button>
      </form>

      <div className="space-y-6">
        <div className={card}>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            {me?.email_verified ? <MailCheck className="w-4 h-4 text-emerald-400" /> : <MailWarning className="w-4 h-4 text-amber-400" />}
            Email
          </h3>
          <p className="text-sm text-gray-300 break-all">{me?.email || '...'}</p>
          {me && (me.email_verified
            ? <p className="text-xs text-emerald-400">Đã xác thực</p>
            : <>
                <p className="text-xs text-amber-300">Chưa xác thực. Email đã xác thực giúp bạn lấy lại tài khoản khi quên mật khẩu.</p>
                {mailResult && <Notice ok={mailResult.ok}>{mailResult.message}</Notice>}
                <button type="button" onClick={resend} disabled={mailBusy} className={primaryButton}>
                  {mailBusy ? 'Đang gửi...' : 'Gửi email xác thực'}
                </button>
              </>)}
        </div>

        <div className={card}>
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><LogOut className="w-4 h-4 text-rose-400" /> Phiên đăng nhập</h3>
          <p className="text-xs text-gray-400">Nghi ngờ người khác đang dùng tài khoản của bạn? Đăng xuất khỏi mọi thiết bị rồi đổi mật khẩu.</p>
          <button
            type="button"
            onClick={logoutEverywhere}
            disabled={logoutBusy}
            className="w-full h-11 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-snow font-semibold text-sm transition disabled:opacity-50"
          >
            Đăng xuất khỏi mọi thiết bị
          </button>
        </div>
      </div>
    </div>
  );
}
