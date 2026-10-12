'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2, LogIn, Megaphone, Settings2, Trash2 } from 'lucide-react';
import PageLoader from '@/components/common/PageLoader';
import SearchInput from '@/components/common/SearchInput';
import NotificationItem, { Notification, NOTIFICATION_URL } from '@/components/notifications/NotificationItem';
import { useAuth } from '@/context/AuthContext';
import { useRealtime } from '@/lib/realtime';
import { useDebounced } from '@/lib/useDebounced';
import { apiJson, MESSAGING_URL } from '@/lib/apiJson';

const FILTERS = [
  { id: '', label: 'Tất cả' },
  { id: 'read', label: 'Đọc truyện' },
  { id: 'interaction', label: 'Tương tác' },
  { id: 'group', label: 'Nhóm dịch' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'moderation', label: 'Kiểm duyệt' },
  { id: 'system', label: 'Hệ thống' },
];

/** Can't be switched off (decided in services/messaging/notify.go): shown next to the switch. */
const ALWAYS = {
  group: 'Kết quả xin vào nhóm luôn được gửi',
  workspace: 'Đề xuất được gộp/trả lại luôn được gửi',
  moderation: 'Nội dung của bạn bị gỡ/khôi phục luôn được gửi',
  system: 'Thông báo toàn site và cảnh báo luôn được gửi',
} as Record<string, string>;

type Setting = { category: string; label: string; web: boolean };
type Broadcast = { id: string; title: string; message: string | null; link: string | null; created_at: string; read_count: number };

export default function NotificationsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading, openAuthModal, authFetch, hasRole } = useAuth();
  const api = (path: string, init?: RequestInit & { json?: unknown }) => apiJson(authFetch, path, init, MESSAGING_URL);

  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [query, typing] = useDebounced(search.trim());
  const latest = useRef(0); // only the newest request may fill the list
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [draft, setDraft] = useState({ title: '', message: '', link: '' });
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const isAdmin = hasRole('admin');

  const load = useCallback(async (append = false, before?: string) => {
    const mine = ++latest.current;
    setLoading(true);
    const q = new URLSearchParams({ limit: '30' });
    if (query) q.set('q', query);
    if (category) q.set('category', category);
    if (unreadOnly) q.set('unread', '1');
    if (before) q.set('before', before);
    const { ok, json } = await api(`/notifications?${q}`).catch(() => ({ ok: false, json: {} as any }));
    if (mine !== latest.current) return;
    if (ok) {
      const list: Notification[] = json.data.notifications;
      setItems((prev) => (append ? [...prev, ...list] : list));
      setUnreadCount(json.data.unread_count);
      setHasMore(list.length === 30);
    }
    setLoading(false);
  }, [category, unreadOnly, query, authFetch]);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  useEffect(() => {
    if (!isAuthenticated) return;
    authFetch(`${NOTIFICATION_URL}/seen`, { method: 'POST' }).catch(() => {}); // this page counts as opening the bell
    api('/notifications/settings').then(({ ok, json }) => ok && setSettings(json.data)).catch(() => {});
    if (isAdmin) api('/admin/broadcasts').then(({ ok, json }) => ok && setBroadcasts(json.data)).catch(() => {});
  }, [isAuthenticated, isAdmin]);

  useRealtime('notification', () => load());

  const open = (n: Notification) => {
    if (!n.is_read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      api(`/notifications/${n.id}/read`, { method: 'PUT' }).catch(() => {});
    }
    if (n.link) router.push(n.link);
  };

  const remove = async (n: Notification) => {
    const { ok } = await api(`/notifications/${n.id}`, { method: 'DELETE' });
    if (ok) setItems((prev) => prev.filter((x) => x.id !== n.id));
  };

  const readAll = async () => {
    const { ok } = await api(`/notifications/read-all${category ? `?category=${category}` : ''}`, { method: 'PUT' });
    if (ok) load();
  };

  const toggle = async (s: Setting) => {
    setSettings((prev) => prev.map((x) => (x.category === s.category ? { ...x, web: !s.web } : x)));
    const { ok, json } = await api('/notifications/settings', { method: 'PUT', json: { [s.category]: { web: !s.web } } });
    if (ok) setSettings(json.data);
    else setNotice({ ok: false, text: json.message || 'Không lưu được cài đặt.' });
  };

  const sendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    const { ok, json } = await api('/admin/broadcasts', { method: 'POST', json: draft });
    setNotice({ ok, text: json.message || (ok ? 'Đã gửi.' : 'Không gửi được.') });
    if (!ok) return;
    setDraft({ title: '', message: '', link: '' });
    api('/admin/broadcasts').then(({ ok, json }) => ok && setBroadcasts(json.data));
    load();
  };

  const deleteBroadcast = async (b: Broadcast) => {
    if (!confirm(`Xóa thông báo toàn site "${b.title}"?`)) return;
    const { ok } = await api(`/admin/broadcasts/${b.id}`, { method: 'DELETE' });
    if (ok) {
      setBroadcasts((prev) => prev.filter((x) => x.id !== b.id));
      load();
    }
  };

  if (isAuthLoading) return <PageLoader label="Đang tải thông báo..." />;

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
        <Bell className="w-10 h-10 mx-auto text-brand-400" />
        <p className="text-sm text-gray-300">Đăng nhập để xem thông báo của bạn.</p>
        <button
          onClick={() => openAuthModal('login')}
          className="px-5 h-10 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-bold text-xs inline-flex items-center gap-1.5 transition"
        >
          <LogIn className="w-4 h-4" /> Đăng nhập
        </button>
      </div>
    );
  }

  const chip = (active: boolean) =>
    `shrink-0 px-3 h-8 rounded-full border text-xs font-semibold transition ${
      active ? 'bg-white text-ink border-white' : 'bg-white/[0.04] text-gray-300 border-white/10 hover:bg-white/[0.08]'
    }`;
  const input = 'w-full px-3 h-9 rounded-lg bg-white/[0.04] border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
            <Bell className="w-6 h-6 text-rose-400" /> Thông báo
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            {unreadCount > 0 ? `${unreadCount} thông báo chưa đọc.` : 'Bạn đã đọc hết thông báo.'} Đã đọc giữ 30 ngày, chưa đọc 60 ngày.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={readAll}
            className="shrink-0 px-3.5 h-9 rounded-xl bg-white/[0.06] border border-white/10 hover:bg-white/10 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition"
          >
            <CheckCheck className="w-4 h-4" /> Đánh dấu đã đọc{category ? ' (mục này)' : ' tất cả'}
          </button>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className={`mb-4 px-4 py-2.5 rounded-xl text-sm border ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-rose-500/10 border-rose-500/30 text-rose-200'}`}
        >
          {notice.text}
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
        <section>
          <SearchInput className="mb-3" value={search} onChange={setSearch} loading={typing || loading} placeholder="Tìm trong thông báo..." />
          <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setCategory(f.id)} className={chip(category === f.id)} aria-pressed={category === f.id}>
                {f.label}
              </button>
            ))}
            <span className="w-px bg-white/10 mx-1 shrink-0" />
            <button type="button" onClick={() => setUnreadOnly((v) => !v)} className={chip(unreadOnly)} aria-pressed={unreadOnly}>
              Chưa đọc
            </button>
          </div>

          <div className={`rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden divide-y divide-white/5 min-h-40 transition-opacity ${loading || typing ? 'opacity-60' : ''}`}>
            {items.length === 0 && !loading && (
              <div className="p-12 text-center">
                <Bell className="w-8 h-8 mx-auto text-gray-600 mb-3" />
                <p className="text-sm font-semibold text-white">Không có thông báo nào</p>
                <p className="text-xs text-gray-400 mt-1">{query ? 'Không có thông báo nào khớp từ khóa.' : 'Thử chọn mục khác, hoặc bỏ lọc "Chưa đọc".'}</p>
              </div>
            )}
            {items.map((n) => (
              <div key={n.id} className="group relative">
                <NotificationItem n={n} onOpen={open} />
                {n.type !== 'broadcast' && (
                  <button
                    type="button"
                    onClick={() => remove(n)}
                    className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-500 hover:text-rose-300 hover:bg-white/5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                    title="Xóa thông báo"
                    aria-label="Xóa thông báo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {loading && items.length === 0 && (
              <div className="p-6 flex justify-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}
          </div>
          {hasMore && !loading && (
            <button
              type="button"
              onClick={() => load(true, items[items.length - 1]?.updated_at)}
              className="mt-4 w-full h-10 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-sm font-semibold text-gray-200 transition"
            >
              Xem thêm
            </button>
          )}
        </section>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4" id="cai-dat">
            <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
              <Settings2 className="w-4 h-4 text-brand-400" /> Nhận thông báo
            </h2>
            <p className="text-xs text-gray-400 mb-3">Tắt một mục thì không nhận thông báo mới của mục đó. Tắt riêng một bài viết Fandom: bấm biểu tượng chuông trên bài.</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold pb-2">Mục</th>
                  <th className="font-semibold pb-2 w-14">Web</th>
                  <th className="font-semibold pb-2 w-14" title="Sắp có">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {settings.map((s) => (
                  <tr key={s.category}>
                    <td className="py-2.5 pr-2">
                      <span className="text-gray-200">{s.label}</span>
                      {ALWAYS[s.category] && <span className="block text-[10px] text-gray-500 leading-snug">{ALWAYS[s.category]}</span>}
                    </td>
                    <td className="py-2.5 text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={s.web}
                        aria-label={`Thông báo web: ${s.label}`}
                        onClick={() => toggle(s)}
                        className={`relative w-9 h-5 rounded-full transition ${s.web ? 'bg-brand-500' : 'bg-white/15'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${s.web ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                    </td>
                    <td className="py-2.5 text-center text-[10px] text-gray-600">sắp có</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isAdmin && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
              <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
                <Megaphone className="w-4 h-4 text-amber-300" /> Thông báo toàn site
              </h2>
              <p className="text-xs text-gray-400 mb-3">Mọi người thấy trong chuông 30 ngày (Admin).</p>
              <form onSubmit={sendBroadcast} className="space-y-2">
                <input className={input} placeholder="Tiêu đề" maxLength={200} required value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Tiêu đề" />
                <textarea className={`${input} h-20 py-2 resize-none`} placeholder="Nội dung (không bắt buộc)" maxLength={1000} value={draft.message}
                  onChange={(e) => setDraft({ ...draft, message: e.target.value })} aria-label="Nội dung" />
                <input className={input} placeholder="Liên kết trong trang, vd /fandom/bai-viet (không bắt buộc)" value={draft.link}
                  onChange={(e) => setDraft({ ...draft, link: e.target.value })} aria-label="Liên kết" />
                <button type="submit" className="w-full h-9 rounded-lg bg-amber-500 hover:bg-amber-400 text-ink text-sm font-bold transition">
                  Gửi cho mọi người
                </button>
              </form>
              {broadcasts.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {broadcasts.map((b) => (
                    <li key={b.id} className="flex items-start gap-2 text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-200 font-semibold truncate">{b.title}</p>
                        <p className="text-gray-500">
                          {new Date(b.created_at).toLocaleDateString('vi-VN')} · {b.read_count} người đã đọc
                        </p>
                      </div>
                      <button type="button" onClick={() => deleteBroadcast(b)} className="p-1 text-gray-500 hover:text-rose-300" aria-label={`Xóa ${b.title}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
