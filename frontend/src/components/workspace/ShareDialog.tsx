'use client';

import React, { useState } from 'react';
import { Share2, UserCheck, X } from 'lucide-react';

/**
 * Share a draft (Plan/chapter-workspace.md, stage 4a): the person (someone in the story) gets its card in a direct
 * message, can view it and make their own copy, and with "can edit" edit it in turn. Also: hand the draft over.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const WS_URL = '/api/ws';

export default function ShareDialog({
  draft,
  authFetch,
  onChanged,
  onTransferred,
  onClose,
}: {
  draft: any;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onChanged: () => void;
  onTransferred: () => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [message, setMessage] = useState('');
  const [giveTo, setGiveTo] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const post = async (path: string, body: object) => {
    setBusy(true);
    setNotice(null);
    const res = await authFetch(`${API_BASE_URL}/drafts/${draft.id}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setNotice({ ok: res.ok && json.success, text: json.message || (res.ok ? 'Xong.' : 'Không thực hiện được.') });
    return res.ok && json.success;
  };

  const share = async () => {
    if (await post('share', { username, can_edit: canEdit, message })) {
      setUsername('');
      setMessage('');
      onChanged();
    }
  };
  const unshare = async (userId: string) => {
    await authFetch(`${WS_URL}/drafts/${draft.id}/shares/${userId}`, { method: 'DELETE' });
    onChanged();
  };
  const transfer = async () => {
    if (!window.confirm(`Giao hẳn bản nháp cho @${giveTo}? Bạn sẽ không còn sửa được nó.`)) return;
    if (await post('transfer', { username: giveTo })) onTransferred();
  };

  const input = 'h-9 px-3 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500';
  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-3xl bg-glass border border-white/10 shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
      >
        <div className="flex items-center justify-between">
          <h3 id="share-title" className="text-base font-bold text-white flex items-center gap-2">
            <Share2 className="w-4 h-4 text-brand-400" /> Chia sẻ bản nháp
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Đóng"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-gray-400">
          Người nhận phải đang tham gia truyện (thành viên nhóm hoặc cộng tác viên). Họ nhận thẻ bản nháp trong tin nhắn, xem được và tạo
          bản sao của riêng họ để sửa rồi gửi lại cho bạn. Cho phép sửa: họ sửa thẳng vào nháp này, mỗi lúc một người.
        </p>
        <div className="space-y-2">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên đăng nhập (vd. neko_trans)" className={`${input} w-full`} />
          <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="Lời nhắn (tùy chọn)" className={`${input} w-full`} />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} /> Cho phép sửa thẳng vào nháp này
            </label>
            <button type="button" disabled={busy || !username.trim()} onClick={share} className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-snow text-xs font-bold">
              Gửi qua tin nhắn
            </button>
          </div>
        </div>
        {notice && <p className={`text-xs font-semibold ${notice.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{notice.text}</p>}

        {draft.shares?.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-white/10">
            <div className="text-[11px] font-bold text-gray-400 uppercase">Đang chia sẻ với</div>
            {draft.shares.map((s: any) => (
              <div key={s.user_id} className="flex items-center justify-between text-xs text-gray-200">
                <span>{s.user_name || s.user_id} · <span className="text-gray-400">{s.can_edit ? 'được sửa' : 'chỉ xem'}</span></span>
                <button type="button" onClick={() => unshare(s.user_id)} className="text-gray-500 hover:text-rose-300">Bỏ chia sẻ</button>
              </div>
            ))}
          </div>
        )}

        {draft.status === 'open' && (
          <div className="space-y-2 pt-2 border-t border-white/10">
            <div className="text-[11px] font-bold text-gray-400 uppercase flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Giao hẳn nháp cho người khác</div>
            <div className="flex gap-2">
              <input value={giveTo} onChange={(e) => setGiveTo(e.target.value)} placeholder="Tên đăng nhập người nhận" className={`${input} flex-1`} />
              <button type="button" disabled={busy || !giveTo.trim()} onClick={transfer} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-xs font-bold">
                Giao nháp
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
