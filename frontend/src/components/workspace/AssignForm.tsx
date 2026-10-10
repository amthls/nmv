'use client';

import React, { useState } from 'react';
import { ClipboardList } from 'lucide-react';

/**
 * Start a chapter's job (Plan/chapter-workspace.md, stage 4b). Keepers assign it (to someone, or open to the first
 * step's role) with a deadline; anyone else in the story claims a chapter for themselves.
 */

const WS_URL = '/api/ws';

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
  const [chapter, setChapter] = useState('new');
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const next = chapters.length ? Math.floor(Math.max(...chapters.map((c) => Number(c.chapter_number)))) + 1 : 1;

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const body: any = { story_id: storyId, note };
    if (chapter === 'new') {
      body.chapter_number = Number(number || next);
      body.title = title;
    } else body.chapter_id = chapter;
    if (keeper && assignee) body.assignee_id = assignee;
    if (keeper && due) body.due_at = new Date(due).toISOString();
    const res = await authFetch(`${WS_URL}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.success) return setMessage({ ok: false, text: json.message || 'Không tạo được việc.' });
    setMessage({ ok: true, text: keeper ? (assignee ? 'Đã giao việc.' : 'Đã mở việc cho người đúng vai trò nhận.') : 'Bạn đã nhận chương này.' });
    setNote('');
    setTitle('');
    setNumber('');
    onDone();
  };

  const input = 'h-9 px-3 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500';
  return (
    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
      <div className="text-[11px] font-bold text-gray-300 flex items-center gap-1.5">
        <ClipboardList className="w-3.5 h-3.5 text-brand-400" /> {keeper ? 'Giao việc' : 'Nhận chương'}
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={chapter} onChange={(e) => setChapter(e.target.value)} className={`${input} min-w-[180px] flex-1`} aria-label="Chương">
          <option value="new">Chương mới…</option>
          {chapters.map((c) => <option key={c.id} value={c.id}>Sửa chương {Number(c.chapter_number)}: {c.title}</option>)}
        </select>
        {chapter === 'new' && (
          <>
            <input value={number} onChange={(e) => setNumber(e.target.value)} type="number" min={0} step="0.1" placeholder={`Số chương (${next})`} className={`${input} w-32`} />
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} placeholder="Tiêu đề (tùy chọn)" className={`${input} flex-1 min-w-[140px]`} />
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {keeper && (
          <>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={`${input} min-w-[180px]`} aria-label="Giao cho">
              <option value="">Để trống: ai đúng vai trò nhận</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input value={due} onChange={(e) => setDue(e.target.value)} type="datetime-local" className={input} aria-label="Hạn" />
          </>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Ghi chú (tùy chọn)" className={`${input} flex-1 min-w-[160px]`} />
        <button disabled={busy} onClick={submit} className="h-9 px-4 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-snow text-xs font-bold">
          {keeper ? 'Giao việc' : 'Nhận chương'}
        </button>
      </div>
      {message && <p className={`text-[11px] font-semibold ${message.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</p>}
    </div>
  );
}
