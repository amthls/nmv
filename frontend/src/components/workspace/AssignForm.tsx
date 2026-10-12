'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { CircleHelp, ClipboardList } from 'lucide-react';

/**
 * Start a chapter's job (Plan/chapter-workspace.md, stage 4b), as three numbered questions: which chapter, who does it
 * (keepers: one person, or open to whoever has the first step's role) and a note, then a sentence saying what will happen.
 * Anyone else in the story claims a chapter for themselves.
 */

const WS_URL = '/api/ws';
export const TASK_GUIDE_HREF = '/huong-dan/lam-chuong';

// outside the form: a component declared inside would remount its inputs (and drop focus) on every keystroke
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-snow">{n}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-sm font-bold text-white">{title}</div>
        {children}
      </div>
    </div>
  );
}

export default function AssignForm({
  storyId, chapters, members, keeper, authFetch, onDone,
}: {
  storyId: string;
  chapters: { id: string; chapter_number: number; title: string }[];
  members: { id: string; name: string }[];
  keeper: boolean;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<'new' | 'edit'>('new');
  const [chapter, setChapter] = useState('');
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [who, setWho] = useState<'open' | 'person'>('open');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const next = chapters.length ? Math.floor(Math.max(...chapters.map((c) => Number(c.chapter_number)))) + 1 : 1;

  const picked = chapters.find((c) => c.id === chapter);
  const person = members.find((m) => m.id === assignee);
  const chapterText = kind === 'new' ? `chương mới số ${number || next}${title ? ` “${title}”` : ''}` : picked ? `sửa chương ${Number(picked.chapter_number)}` : '';
  const ready = (kind === 'new' || !!picked) && (!keeper || who === 'open' || !!person);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const body: any = { story_id: storyId, note };
    if (kind === 'new') {
      body.chapter_number = Number(number || next);
      body.title = title;
    } else body.chapter_id = chapter;
    if (keeper && who === 'person' && assignee) body.assignee_id = assignee;
    if (keeper && due) body.due_at = new Date(due).toISOString();
    const res = await authFetch(`${WS_URL}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.success) return setMessage({ ok: false, text: json.message || 'Không tạo được việc.' });
    setMessage({ ok: true, text: keeper ? (body.assignee_id ? `Đã giao cho ${person?.name}. Họ nhận được thông báo.` : 'Đã mở việc: ai đúng vai trò sẽ thấy ở workspace nhóm và bấm Nhận việc.') : 'Bạn đã nhận chương này: xem ở "Việc của tôi".' });
    setNote('');
    setTitle('');
    setNumber('');
    onDone();
  };

  const input = 'h-10 px-3 rounded-xl bg-black/30 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500';
  const choice = (on: boolean) => `flex-1 min-w-[150px] rounded-xl border px-3 py-2.5 text-left transition ${on ? 'border-brand-400 bg-brand-500/15' : 'border-white/10 bg-white/5 hover:border-white/30'}`;

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-white/5 border border-white/10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-white flex items-center gap-1.5">
          <ClipboardList className="w-4 h-4 text-brand-400" /> {keeper ? 'Giao việc cho một chương' : 'Nhận một chương để làm'}
        </div>
        <Link href={`${TASK_GUIDE_HREF}#giao-viec`} className="text-xs font-semibold text-brand-300 hover:text-brand-200 flex items-center gap-1">
          <CircleHelp className="w-4 h-4" /> Chưa rõ cách dùng? Xem hướng dẫn có ảnh
        </Link>
      </div>

      <Step n={1} title="Chương nào?">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setKind('new')} className={choice(kind === 'new')}>
            <div className="text-xs font-bold text-white">Chương mới</div>
            <div className="text-[11px] text-gray-400">Chương chưa có, làm từ đầu</div>
          </button>
          <button type="button" onClick={() => setKind('edit')} disabled={!chapters.length} className={`${choice(kind === 'edit')} disabled:opacity-40`}>
            <div className="text-xs font-bold text-white">Sửa chương đã đăng</div>
            <div className="text-[11px] text-gray-400">Biên tập, hiệu đính, dịch lại</div>
          </button>
        </div>
        {kind === 'new' ? (
          <div className="flex flex-wrap gap-2">
            <input value={number} onChange={(e) => setNumber(e.target.value)} type="number" min={0} step="0.1" placeholder={`Số chương (gợi ý ${next})`} aria-label="Số chương" className={`${input} w-44`} />
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} placeholder="Tiêu đề (có thể để trống)" aria-label="Tiêu đề" className={`${input} flex-1 min-w-[160px]`} />
          </div>
        ) : (
          <select value={chapter} onChange={(e) => setChapter(e.target.value)} className={`${input} w-full`} aria-label="Chương">
            <option value="">— Chọn chương —</option>
            {chapters.map((c) => <option key={c.id} value={c.id}>Chương {Number(c.chapter_number)}: {c.title}</option>)}
          </select>
        )}
      </Step>

      {keeper && (
        <Step n={2} title="Ai làm?">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setWho('open')} className={choice(who === 'open')}>
              <div className="text-xs font-bold text-white">Để nhóm tự nhận</div>
              <div className="text-[11px] text-gray-400">Ai đúng vai trò bước đầu bấm “Nhận việc”</div>
            </button>
            <button type="button" onClick={() => setWho('person')} className={choice(who === 'person')}>
              <div className="text-xs font-bold text-white">Giao cho một người</div>
              <div className="text-[11px] text-gray-400">Người đó nhận thông báo ngay</div>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {who === 'person' && (
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={`${input} min-w-[200px] flex-1`} aria-label="Giao cho">
                <option value="">— Chọn người —</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 text-xs text-gray-400">
              Hạn (không bắt buộc)
              <input value={due} onChange={(e) => setDue(e.target.value)} type="datetime-local" className={input} aria-label="Hạn" />
            </label>
          </div>
        </Step>
      )}

      <Step n={keeper ? 3 : 2} title="Dặn dò thêm (không bắt buộc)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Ví dụ: giữ nguyên tên riêng như bản cũ" className={`${input} w-full`} />
      </Step>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
        <p className="text-xs text-gray-300">
          {ready
            ? <>Sẽ {keeper ? 'giao' : 'nhận'} <b className="text-white">{chapterText}</b>{keeper ? <> cho <b className="text-white">{who === 'person' ? person?.name : 'ai đúng vai trò nhận trước'}</b></> : ''}{due ? `, hạn ${new Date(due).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}` : ''}.</>
            : 'Chọn đủ các mục ở trên.'}
        </p>
        <button disabled={busy || !ready} onClick={submit} className="h-10 px-5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-snow text-sm font-bold">
          {busy ? 'Đang gửi...' : keeper ? 'Giao việc' : 'Nhận chương'}
        </button>
      </div>
      {message && <p className={`text-xs font-semibold ${message.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</p>}
    </div>
  );
}
