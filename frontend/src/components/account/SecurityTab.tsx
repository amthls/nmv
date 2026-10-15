'use client';

import React, { useState } from 'react';
import { KeyRound, LogOut, MailCheck, MailWarning } from 'lucide-react';import { SkinIcon } from '@/components/skin/aemeath/icons';

import { useAuth } from '@/context/AuthContext';
import { Notice, PasswordInput, primaryButton } from '@/components/auth/AccountCard';
import { IDENTITY_URL, apiJson } from '@/lib/apiJson';

type Result = { ok: boolean; message: string } | null;
/** Account page tab: change password, email verification, log out of every device. */
export default function SecurityTab() {
  const { authFetch, logout, user } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwResult, setPwResult] = useState<Result>(null);
  const [mailResult, setMailResult] = useState<Result>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailResult, setEmailResult] = useState<Result>(null);

  const call = async (path: string, method = 'POST', body?: unknown) => {
    try {
      const { ok, json } = await apiJson(authFetch, path, { method, json: method === 'GET' ? undefined : body ?? {} }, IDENTITY_URL);
      return { ok, message: json.message || (ok ? 'Xong.' : 'Có lỗi xảy ra.'), data: json.data };
    } catch {
      return { ok: false, message: 'Không kết nối được máy chủ.', data: null };
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setPwResult({ ok: false, message: 'Mật khẩu xác nhận không khớp.' });
    setPwBusy(true);
    const r = await call('/change-password', 'POST', { current_password: current, new_password: next });
    if (r.ok) { setCurrent(''); setNext(''); setConfirm(''); }
    setPwResult(r);
    setPwBusy(false);
  };

  const resend = async () => {
    setMailBusy(true);
    setMailResult(await call('/resend-verification'));
    setMailBusy(false);
  };

  const changeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailBusy(true);
    const r = await call('/change-email', 'POST', { new_email: newEmail, password: emailPassword });
    if (r.ok) { setNewEmail(''); setEmailPassword(''); }
    setEmailResult(r);
    setEmailBusy(false);
  };

  const logoutEverywhere = async () => {
    if (!window.confirm('Đăng xuất khỏi mọi thiết bị, kể cả thiết bị này?')) return;
    setLogoutBusy(true);
    await call('/logout-all');
    logout();
  };

  const card = 'p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4';

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={changePassword} className={card}>
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><SkinIcon lucide={KeyRound} ae="key" className="w-4 h-4 text-brand-400" /> Đổi mật khẩu</h3>
        {pwResult && <Notice ok={pwResult.ok}>{pwResult.message}</Notice>}
        <PasswordInput label="Mật khẩu hiện tại" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordInput label="Mật khẩu mới (ít nhất 8 ký tự)" value={next} onChange={setNext} autoComplete="new-password" />
        <PasswordInput label="Nhập lại mật khẩu mới" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <p className="text-xs text-gray-500">Đổi mật khẩu sẽ đăng xuất các thiết bị khác. Không dùng mật khẩu quá phổ biến hoặc chứa tên đăng nhập.</p>
        <button type="submit" disabled={pwBusy} className={primaryButton}>{pwBusy ? 'Đang lưu...' : 'Đổi mật khẩu'}</button>
      </form>

      <div className="space-y-6">
        <div className={card}>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            {user?.email_verified ? <MailCheck className="w-4 h-4 text-emerald-400" /> : <MailWarning className="w-4 h-4 text-amber-400" />}
            Email
          </h3>
          <p className="text-sm text-gray-300 break-all">{user?.email || '...'}</p>
          {user && (user.email_verified
            ? <p className="text-xs text-emerald-400">Đã xác thực</p>
            : <>
                <p className="text-xs text-amber-300">Chưa xác thực. Email đã xác thực giúp bạn lấy lại tài khoản khi quên mật khẩu.</p>
                {mailResult && <Notice ok={mailResult.ok}>{mailResult.message}</Notice>}
                <button type="button" onClick={resend} disabled={mailBusy} className={primaryButton}>
                  {mailBusy ? 'Đang gửi...' : 'Gửi email xác thực'}
                </button>
              </>)}
          <form onSubmit={changeEmail} className="space-y-3 pt-3 border-t border-white/5">
            <p className="text-xs font-semibold text-gray-300">Đổi email</p>
            {emailResult && <Notice ok={emailResult.ok}>{emailResult.message}</Notice>}
            <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email mới"
              autoComplete="email" maxLength={255}
              className="w-full h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500" />
            <PasswordInput label="Mật khẩu hiện tại" value={emailPassword} onChange={setEmailPassword} autoComplete="current-password" />
            <p className="text-xs text-gray-500">Chúng tôi gửi liên kết xác nhận tới email mới; email chỉ đổi khi bạn mở liên kết đó. Email cũ cũng được báo.</p>
            <button type="submit" disabled={emailBusy} className={primaryButton}>{emailBusy ? 'Đang gửi...' : 'Gửi liên kết xác nhận'}</button>
          </form>
        </div>

        <div className={card}>
          <p className="text-xs text-gray-400">Nghi ngờ người khác đang dùng tài khoản của bạn? Đăng xuất khỏi mọi thiết bị rồi đổi mật khẩu.</p>
          <button
            type="button"
            onClick={logoutEverywhere}
            disabled={logoutBusy}
            className="w-full h-11 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-snow font-semibold text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <SkinIcon lucide={LogOut} ae="logOut" className="w-4 h-4" /> Đăng xuất khỏi mọi thiết bị
          </button>
        </div>
      </div>
    </div>
  );
}
