'use client';

import React, { useState } from 'react';
import Link from '@/components/common/Link';
import { useRouter } from 'next/navigation';
import { Clock } from 'lucide-react';

/**
 * One workspace task (Plan/chapter-workspace.md, stage 4b): a step of a chapter's workflow. Actions follow the caller:
 * take an open step, work on / finish / give back my step, open the proposal at the merge step; keepers reassign or cancel.
 */

const WS_URL = '/api/ws';

export const STEP_LABEL: Record<string, string> = { raw: 'RAW', translate: 'DỊCH', edit: 'BIÊN TẬP', proofread: 'HIỆU ĐÍNH', merge: 'GỘP' };
export const STEP_COLOR: Record<string, string> = {
  raw: 'bg-slate-500/20 text-slate-200', translate: 'bg-sky-500/20 text-sky-200', edit: 'bg-violet-500/20 text-violet-200',
  proofread: 'bg-amber-500/20 text-amber-200', merge: 'bg-emerald-500/20 text-emerald-200',
};

export function dueState(t: any): 'late' | 'soon' | null {
  if (!t.due_at || (t.status !== 'open' && t.status !== 'claimed')) return null;
  const left = new Date(t.due_at).getTime() - Date.now();
  return left < 0 ? 'late' : left < 24 * 3600 * 1000 ? 'soon' : null;
}

export default function TaskCard({
  t, me, keeper, members, storyTitle, authFetch, onChanged,
}: {
  t: any;
  me?: string;
  keeper: boolean;
  members?: { id: string; name: string }[];
  storyTitle?: string;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = t.assignee_id && t.assignee_id === me;
  const active = t.status === 'open' || t.status === 'claimed';
  const due = dueState(t);

  const call = async (method: string, path: string, body?: object) => {
    setBusy(true);
    setError(null);
    const res = await authFetch(`${WS_URL}/tasks/${t.id}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.success) {
      setError(json.message || 'Không thực hiện được.');
      return null;
    }
    onChanged();
    return json.data;
  };
  const start = async () => {
    const data = await call('POST', '/start');
    if (data?.draft_id) router.push(`/dang-chuong?draft=${data.draft_id}`);
  };

  const btn = 'px-2.5 py-1 rounded-lg text-[11px] font-bold disabled:opacity-40 transition';
  return (
    <div className={`p-3 rounded-2xl border text-xs space-y-2 ${due === 'late' ? 'border-rose-500/40 bg-rose-500/5' : due === 'soon' ? 'border-amber-500/40 bg-amber-500/5' : 'border-white/10 bg-white/5'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold ${STEP_COLOR[t.kind] || ''}`}>{STEP_LABEL[t.kind] || t.kind}</span>
            <span className="font-bold text-white truncate">Chương {Number(t.chapter_number)}{t.title ? `: ${t.title}` : t.chapter_id ? '' : ' (mới)'}</span>
          </div>
          {storyTitle && <div className="text-[11px] text-brand-300 truncate mt-0.5">{storyTitle}</div>}
          <div className="text-[11px] text-gray-400 mt-0.5">
            {t.status === 'open' ? (t.kind === 'merge' ? 'Chờ người giữ truyện gộp' : 'Chưa ai nhận')
              : t.status === 'claimed' ? `${t.assignee_name || 'Ai đó'} đang làm`
              : t.status === 'done' ? `Xong${t.assignee_name ? ` · ${t.assignee_name}` : ''}` : 'Đã hủy'}
            {t.steps?.length > 1 && t.kind !== 'merge' ? ` · bước ${t.step + 1}/${t.steps.length}` : ''}
          </div>
        </div>
        {t.due_at && active && (
          <span className={`shrink-0 flex items-center gap-1 text-[10px] font-bold ${due === 'late' ? 'text-rose-300' : due === 'soon' ? 'text-amber-300' : 'text-gray-400'}`}>
            <Clock className="w-3 h-3" /> {due === 'late' ? 'Trễ hạn ' : 'Hạn '}{new Date(t.due_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
        )}
      </div>
      {t.note && <p className="text-[11px] text-gray-300 whitespace-pre-line">“{t.note}”</p>}
      {error && <p className="text-[11px] text-rose-300">{error}</p>}

      {active && (
        <div className="flex flex-wrap items-center gap-1.5">
          {t.status === 'open' && t.kind !== 'merge' && (
            <button disabled={busy} onClick={() => call('POST', '/claim')} className={`${btn} bg-brand-600 hover:bg-brand-500 text-snow`}>Nhận việc</button>
          )}
          {t.kind === 'merge' && t.draft_id && (
            <Link href={`/ws/de-xuat/${t.draft_id}`} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-snow`}>Xem đề xuất</Link>
          )}
          {mine && t.status === 'claimed' && (
            <>
              {t.kind !== 'raw' && <button disabled={busy} onClick={start} className={`${btn} bg-brand-600 hover:bg-brand-500 text-snow`}>Làm trên nháp</button>}
              <button
                disabled={busy}
                onClick={() => window.confirm(t.step + 1 >= (t.steps?.length || 1) ? 'Xong bước cuối: nháp sẽ được gửi đề xuất cho người giữ truyện. Tiếp tục?' : 'Đánh dấu xong bước này? Bước sau sẽ mở cho người kế tiếp.') && call('POST', '/done')}
                className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-snow`}
              >
                Xong bước
              </button>
              <button disabled={busy} onClick={() => call('POST', '/unclaim')} className={`${btn} bg-white/10 hover:bg-white/15 text-gray-200`}>Trả việc</button>
            </>
          )}
          {keeper && t.kind !== 'merge' && members && (
            <select
              disabled={busy}
              value={t.assignee_id || ''}
              onChange={(e) => call('PATCH', '', { assignee_id: e.target.value })}
              className="h-7 px-2 rounded-lg bg-surface-3 border border-white/10 text-[11px] text-white"
              aria-label="Giao cho"
            >
              <option value="">— Để trống (ai đúng vai trò nhận) —</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          {keeper && (
            <button disabled={busy} onClick={() => window.confirm('Hủy việc này?') && call('POST', '/cancel')} className={`${btn} text-gray-400 hover:text-rose-300`}>Hủy</button>
          )}
        </div>
      )}
    </div>
  );
}
