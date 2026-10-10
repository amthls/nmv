'use client';

import React, { useEffect, useState } from 'react';
import { KeyRound, LogOut, MailCheck, MailWarning, MonitorSmartphone, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Notice, PasswordInput, primaryButton } from '@/components/auth/AccountCard';
import { IDENTITY_URL, apiJson } from '@/lib/apiJson';

type Result = { ok: boolean; message: string } | null;
type Session = { id: string; device: string; ip: string; created_at: string; last_used_at: string; current: boolean };

/** "Chrome trên Windows" from a User-Agent; good enough to tell one's own devices apart. */
function deviceName(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} trên ${os}` : browser;
}

/** Account page tab: change password, email verification, signed-in devices, log out of every device. */
export default function SecurityTab() {
  const { authFetch, logout, user } = useAuth();
  const [sessions, setSessions] = useState<Session[] | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwResult, setPwResult] = useState<Result>(null);
  const [mailResult, setMailResult] = useState<Result>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const call = async (path: string, method = 'POST', body?: unknown) => {
    try {
      const { ok, json } = await apiJson(authFetch, path, { method, json: method === 'GET' ? undefined : body ?? {} }, IDENTITY_URL);
      return { ok, message: json.message || (ok ? 'Xong.' : 'Có lỗi xảy ra.'), data: json.data };
    } catch {
      return { ok: false, message: 'Không kết nối được máy chủ.', data: null };
    }
  };

  const loadSessions = () => call('/sessions', 'GET').then((r) => r.ok && setSessions(r.data));
  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setPwResult({ ok: false, message: 'Mật khẩu xác nhận không khớp.' });
    setPwBusy(true);
    const r = await call('/change-password', 'POST', { current_password: current, new_password: next });
    if (r.ok) {
      setCurrent(''); setNext(''); setConfirm('');
      loadSessions();
    }
    setPwResult(r);
    setPwBusy(false);
  };

  const resend = async () => {
    setMailBusy(true);
    setMailResult(await call('/resend-verification'));
    setMailBusy(false);
  };

  const revoke = async (id: string) => {
    if ((await call(`/sessions/${id}`, 'DELETE')).ok) loadSessions();
  };

  const logoutEverywhere = async () => {
    if (!window.confirm('Đăng xuất khỏi mọi thiết bị, kể cả thiết bị này?')) return;
    setLogoutBusy(true);
    await call('/logout-all');
    logout();
  };

  const card = 'p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4';
  const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={changePassword} className={card}>
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><KeyRound className="w-4 h-4 text-brand-400" /> Đổi mật khẩu</h3>
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
        </div>

        <div className={card}>
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><MonitorSmartphone className="w-4 h-4 text-sky-400" /> Thiết bị đang đăng nhập</h3>
          {!sessions ? (
            <p className="text-xs text-gray-500">Đang tải...</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {sessions.map((s) => (
                <li key={s.id} className="py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 truncate">
                      {deviceName(s.device)}
                      {s.current && <span className="ml-2 text-[11px] text-emerald-400">(thiết bị này)</span>}
                    </p>
                    <p className="text-[11px] text-gray-500">Dùng gần nhất {when(s.last_used_at)} · đăng nhập {when(s.created_at)}{s.ip ? ` · ${s.ip}` : ''}</p>
                  </div>
                  {!s.current && (
                    <button type="button" onClick={() => revoke(s.id)} title="Đăng xuất thiết bị này"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-rose-300 hover:bg-rose-500/10 transition">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-400">Nghi ngờ người khác đang dùng tài khoản của bạn? Đăng xuất khỏi mọi thiết bị rồi đổi mật khẩu.</p>
          <button
            type="button"
            onClick={logoutEverywhere}
            disabled={logoutBusy}
            className="w-full h-11 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-snow font-semibold text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" /> Đăng xuất khỏi mọi thiết bị
          </button>
        </div>
      </div>
    </div>
  );
}
