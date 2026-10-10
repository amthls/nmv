'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, GitCompare, GitMerge, MessageSquare, Pencil, Undo2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';
import { Block, DiffRowView, GapRow, Op, diffRows, foldRows } from '@/components/workspace/BlockDiff';
import { draftLabel } from '@/components/workspace/DraftRow';

/**
 * A proposal (Plan/chapter-workspace.md, stage 3): what the latest round changes against the official version it
 * was based on, what changed since the round before, comments per paragraph. Keepers merge or return it; its
 * author withdraws it or opens the draft again after a return.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const WS_URL = '/api/ws';

const DECISION: Record<string, string> = { pending: 'Chờ duyệt', returned: 'Trả lại', merged: 'Đã gộp', withdrawn: 'Đã rút' };
const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

export default function ProposalPage() {
  const id = useParams()?.id as string;
  const router = useRouter();
  const { isAuthenticated, isLoading, openAuthModal, authFetch } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'changes' | 'since'>('changes');
  const [commentOn, setCommentOn] = useState<string | null>(null); // block hash, or '' for the whole proposal
  const [comment, setComment] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [publishAt, setPublishAt] = useState(''); // stage 4c: merge at a chosen time

  const load = useCallback(async () => {
    const res = await authFetch(`${WS_URL}/drafts/${id}/review`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return setError(json.message || 'Không tải được đề xuất.');
    setData(json.data);
  }, [authFetch, id]);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  const act = async (path: string, body: object, done: string) => {
    setBusy(true);
    setNotice(null);
    const res = await authFetch(`${API_BASE_URL}/drafts/${id}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.success) {
      setNotice(json.message || 'Không thực hiện được.');
      return false;
    }
    setNotice(json.message || done);
    setDecisionNote('');
    load();
    return true;
  };

  const sendComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    const res = await authFetch(`${WS_URL}/drafts/${id}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: comment, block_hash: commentOn || null }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice(json.message || 'Không gửi được góp ý.');
    setComment('');
    setCommentOn(null);
    load();
  };

  if (isLoading) return <PageLoader label="Đang mở đề xuất..." />;
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <button onClick={() => openAuthModal('login')} className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm">
          Đăng nhập để xem đề xuất
        </button>
      </div>
    );
  }
  if (error) return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-rose-300">{error}</div>;
  if (!data) return <PageLoader label="Đang mở đề xuất..." />;

  const d = data.draft;
  const blocks: Record<string, Block> = data.blocks || {};
  const ops: Op[] = (tab === 'since' ? data.since_previous : data.changes) || [];
  const rows = diffRows(ops, blocks);
  const comments: any[] = data.comments || [];
  const commentsOn = (hash?: string) => comments.filter((c) => c.block_hash === (hash ?? null));
  const pending = d.status === 'submitted';
  const last = data.rounds[data.rounds.length - 1];
  const changed = rows.filter((r) => r.kind !== 'same').length;
  // comments on paragraphs no longer shown (rewritten since, or the other tab): listed with the paragraph quoted
  const shown = new Set(rows.filter((r) => r.kind !== 'same').map((r) => r.bHash || r.aHash));
  const earlier = comments.filter((c) => c.block_hash && !shown.has(c.block_hash));

  const commentBox = (hash: string) => (
    <div className="ml-3 mt-1 mb-2 flex gap-2">
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        rows={2}
        autoFocus
        placeholder="Góp ý cho đoạn này..."
        className="flex-1 px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
      />
      <div className="flex flex-col gap-1">
        <button disabled={busy || !comment.trim()} onClick={sendComment} className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-snow text-[11px] font-bold">Gửi</button>
        <button onClick={() => { setCommentOn(null); setComment(''); }} className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 text-[11px]">Hủy</button>
      </div>
    </div>
  );
  const commentList = (list: any[]) => list.map((c) => (
    <div key={c.id} className="ml-3 mt-1 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-100">
      <span className="font-bold text-sky-300">{c.author_name || 'Ẩn danh'}</span>
      <span className="text-[10px] text-gray-400"> · vòng {c.round} · {when(c.created_at)}</span>
      <p className="whitespace-pre-line mt-0.5">{c.body}</p>
    </div>
  ));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-5 pb-24">
      <Link href="/ws" className="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition">
        <ArrowLeft className="w-4 h-4" /> Workspace của tôi
      </Link>

      <div className="rounded-3xl p-6 glass-panel border border-white/10 bg-glass shadow-xl space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-extrabold text-white flex items-center gap-2">
              <GitMerge className="w-5 h-5 text-brand-400" /> Đề xuất: {draftLabel({ meta: data.meta })}
            </h1>
            <p className="text-xs text-gray-400 mt-1">
              {d.owner_name || 'Người viết'} · vòng {data.round} · {d.chapter_id ? `sửa từ phiên bản ${last.base_version}` : 'chương mới'}
              {' · '}<span className={pending ? 'text-amber-300' : d.status === 'published' ? 'text-emerald-300' : 'text-gray-300'}>
                {pending ? 'Chờ duyệt' : d.status === 'published' ? 'Đã gộp' : DECISION[last.decision] || d.status}
              </span>
            </p>
          </div>
          {data.is_owner && d.status === 'open' && (
            <Link href={`/dang-chuong?draft=${d.id}`} className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5" /> Mở nháp để sửa
            </Link>
          )}
        </div>
        {last.note && <p className="text-sm text-gray-200 px-3 py-2 rounded-xl bg-white/5 border border-white/10 whitespace-pre-line">“{last.note}”</p>}
        {last.decision === 'returned' && (
          <p className="text-xs text-amber-200 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30">
            {last.decided_name || 'Người giữ truyện'} đã trả lại{last.decision_note ? `: “${last.decision_note}”` : '.'} Xem góp ý bên dưới.
          </p>
        )}
        {notice && <p className="text-xs text-gray-200 px-3 py-2 rounded-xl bg-white/5 border border-white/10">{notice}</p>}
        {d.status === 'scheduled' && (
          <div className="text-xs text-violet-100 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/30 flex flex-wrap items-center justify-between gap-2">
            <span>Sẽ gộp vào bản chính lúc {new Date(d.publish_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}{d.scheduled_name ? ` (hẹn bởi ${d.scheduled_name})` : ''}.</span>
            {data.can_merge && (
              <button
                disabled={busy}
                onClick={async () => {
                  const res = await authFetch(`${WS_URL}/drafts/${id}/schedule`, { method: 'DELETE' });
                  const json = await res.json().catch(() => ({}));
                  setNotice(res.ok ? 'Đã hủy hẹn giờ.' : json.message || 'Không hủy được.');
                  load();
                }}
                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 font-bold"
              >
                Hủy hẹn
              </button>
            )}
          </div>
        )}
        {d.schedule_error && d.status === 'submitted' && (
          <p className="text-xs text-rose-200 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30">Lần hẹn gộp trước không thực hiện được: {d.schedule_error}</p>
        )}
        {data.story_removed && <p className="text-xs text-rose-300">Truyện đang bị gỡ: chưa gộp được cho tới khi được khôi phục.</p>}
        {pending && data.merge_conflicts > 0 && (
          <p className="text-xs text-rose-200 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30">
            Bản chính thức đã đổi và có {data.merge_conflicts} chỗ sửa trùng: hãy trả lại để người viết bấm “Cập nhật theo bản chính”.
          </p>
        )}

        {pending && (data.can_merge || data.is_owner) && (
          <div className="flex flex-wrap items-end gap-2 pt-1">
            {data.can_merge && (
              <>
                <input
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  maxLength={2000}
                  placeholder="Lời nhắn khi trả lại (tùy chọn)"
                  className="flex-1 min-w-[200px] h-9 px-3 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                />
                <button disabled={busy} onClick={() => act('return', { note: decisionNote }, 'Đã trả lại.')} className="h-9 px-4 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5">
                  <Undo2 className="w-3.5 h-3.5" /> Trả lại
                </button>
                <input
                  type="datetime-local"
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                  title="Hẹn giờ đăng (để trống = gộp ngay)"
                  aria-label="Hẹn giờ đăng"
                  className="h-9 px-3 rounded-xl bg-black/30 border border-white/10 text-xs text-white"
                />
                <button
                  disabled={busy || data.merge_conflicts > 0 || data.story_removed}
                  onClick={() => act('publish', publishAt ? { publish_at: new Date(publishAt).toISOString() } : {}, 'Đã gộp.').then((done) => done && setPublishAt(''))}
                  className="h-9 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-snow text-xs font-bold flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" /> {publishAt ? 'Hẹn giờ gộp' : 'Gộp vào bản chính'}
                </button>
              </>
            )}
            {data.is_owner && (
              <button disabled={busy} onClick={() => act('withdraw', {}, 'Đã rút.').then((done) => done && router.push(`/dang-chuong?draft=${d.id}`))} className="h-9 px-4 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5">
                <Undo2 className="w-3.5 h-3.5" /> Rút lại để sửa
              </button>
            )}
          </div>
        )}
      </div>

      <section className="p-4 sm:p-5 rounded-3xl bg-white/5 border border-white/10 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10 text-xs font-bold w-fit">
            <button onClick={() => setTab('changes')} className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${tab === 'changes' ? 'bg-brand-600 text-snow' : 'text-gray-400 hover:text-white'}`}>
              <GitCompare className="w-3.5 h-3.5" /> {d.chapter_id ? 'So với bản chính' : 'Nội dung chương mới'}
            </button>
            {data.round > 1 && (
              <button onClick={() => setTab('since')} className={`px-3 py-1.5 rounded-lg ${tab === 'since' ? 'bg-brand-600 text-snow' : 'text-gray-400 hover:text-white'}`}>
                Thay đổi từ lần gửi trước
              </button>
            )}
          </div>
          <span className="text-xs text-gray-400">{changed === 0 ? 'không có đoạn nào khác' : `${changed} chỗ khác`} · bấm đoạn đã đổi để góp ý</span>
        </div>

        <div className="space-y-1.5 text-sm leading-relaxed">
          {foldRows(rows).map((r, i) => {
            if (r.kind === 'gap') return <GapRow key={i} count={r.count} />;
            const hash = r.bHash || r.aHash || '';
            const list = r.kind === 'same' ? [] : commentsOn(hash);
            return (
              <DiffRowView key={i} r={r}>
                {r.kind !== 'same' && commentOn !== hash && (
                  <button onClick={() => { setCommentOn(hash); setComment(''); }} className="ml-3 text-[10px] text-gray-500 hover:text-sky-300 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> Góp ý{list.length > 0 ? ` (${list.length})` : ''}
                  </button>
                )}
                {commentList(list)}
                {commentOn === hash && commentBox(hash)}
              </DiffRowView>
            );
          })}
        </div>
      </section>

      <section className="p-4 sm:p-5 rounded-3xl bg-white/5 border border-white/10 space-y-2">
        <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider">Góp ý chung</h2>
        {commentList(commentsOn(undefined))}
        {earlier.map((c) => (
          <div key={c.id}>
            <p className="ml-3 mt-2 text-[11px] text-gray-500 italic line-clamp-2">Về đoạn: “{blocks[c.block_hash]?.text || '…'}”</p>
            {commentList([c])}
          </div>
        ))}
        {commentOn === '' ? commentBox('') : (
          <button onClick={() => { setCommentOn(''); setComment(''); }} className="text-xs text-gray-400 hover:text-sky-300 flex items-center gap-1">
            <MessageSquare className="w-3.5 h-3.5" /> Viết góp ý chung
          </button>
        )}
        <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider pt-3">Các lần gửi</h2>
        <ol className="space-y-1 text-xs text-gray-300">
          {data.rounds.map((r: any) => (
            <li key={r.round}>
              Vòng {r.round} · {when(r.submitted_at)} · <b>{DECISION[r.decision]}</b>
              {r.decided_name ? ` bởi ${r.decided_name}` : ''}{r.merged_version ? ` (phiên bản ${r.merged_version})` : ''}
              {r.decision_note ? ` · “${r.decision_note}”` : ''}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
