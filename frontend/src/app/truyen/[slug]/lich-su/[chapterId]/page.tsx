'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, GitCompare, History, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/**
 * Version history of one chapter (workspace service, /api/ws): every save, rewind, deletion and restore is a version.
 * Story members see it; story keepers (owner, group leader/mod) can bring an old version back (also undeletes).
 * Addressed by chapter id so a deleted chapter (no reader page any more) can still be found and restored.
 */

const WS_URL = '/api/ws';

type Rev = {
  version: number; source: string; deleted: boolean; based_on: number | null; author_name: string | null;
  created_at: string; title: string; chapter_number: number; block_count: number;
};
type Op = { op: 'same' | 'del' | 'ins'; hash: string };
type Block = { type: string; text?: string; image_url?: string; note?: string };

const SOURCE_LABEL: Record<string, string> = {
  import: 'Bản gốc', create: 'Đăng chương', edit: 'Sửa', rewind: 'Khôi phục bản cũ', delete: 'Xóa chương', restore: 'Khôi phục chương',
};

const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
const blockText = (b?: Block) => (b ? b.text || (b.image_url ? `[Ảnh] ${b.image_url.split('/').pop()}` : b.type === 'separator' ? '———' : '') : '');

/** Word-level diff of two paragraphs (LCS over words; paragraphs are short). */
function wordDiff(a: string, b: string): { t: string; k: 'same' | 'del' | 'ins' }[] {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { t: string; k: 'same' | 'del' | 'ins' }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ t: x[i], k: 'same' }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: x[i++], k: 'del' });
    else out.push({ t: y[j++], k: 'ins' });
  }
  while (i < n) out.push({ t: x[i++], k: 'del' });
  while (j < m) out.push({ t: y[j++], k: 'ins' });
  return out;
}

/** Turn block ops into rows: unchanged, removed, added, or changed (a removed + an added block side by side). */
function rows(ops: Op[], blocks: Record<string, Block>) {
  const out: { kind: 'same' | 'del' | 'ins' | 'mod'; a?: Block; b?: Block }[] = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const next = ops[i + 1];
    if (o.op === 'del' && next?.op === 'ins') {
      out.push({ kind: 'mod', a: blocks[o.hash], b: blocks[next.hash] });
      i++;
    } else out.push({ kind: o.op, a: o.op !== 'ins' ? blocks[o.hash] : undefined, b: o.op !== 'del' ? blocks[o.hash] : undefined });
  }
  return out;
}

export default function ChapterHistoryPage() {
  const params = useParams();
  const search = useSearchParams();
  const storySlug = params?.slug as string;
  const chapterId = params?.chapterId as string;
  const { authFetch, isAuthenticated, isLoading: authLoading, openAuthModal } = useAuth();

  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(search?.get('deleted') ? 'Đã xóa chương. Bạn có thể khôi phục một phiên bản bên dưới.' : null);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [cmp, setCmp] = useState<{ ops: Op[]; blocks: Record<string, Block> } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await authFetch(`${WS_URL}/chapters/${chapterId}/revisions`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.message || 'Không tải được lịch sử chương.');
    setRevs(json.data);
    const live = (json.data as Rev[]).filter((r) => !r.deleted);
    if (live.length >= 2) { setTo(live[0].version); setFrom(live[1].version); }
  }, [authFetch, chapterId]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) load();
  }, [authLoading, isAuthenticated, load]);

  useEffect(() => {
    if (!from || !to || from === to) return setCmp(null);
    authFetch(`${WS_URL}/chapters/${chapterId}/compare?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((j) => j.success && setCmp({ ops: j.data.ops, blocks: j.data.blocks }))
      .catch(() => {});
  }, [from, to, authFetch, chapterId]);

  const rewind = async (v: number, restore: boolean) => {
    if (!confirm(restore ? `Khôi phục chương về phiên bản ${v}?` : `Đưa bản chính thức về nội dung của phiên bản ${v}? (Tạo phiên bản mới, không mất phiên bản nào.)`)) return;
    setBusy(true);
    const res = await authFetch(`${WS_URL}/chapters/${chapterId}/rewind`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_version: v }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice(json.message || 'Không khôi phục được.');
    setNotice(`Đã tạo phiên bản ${json.data.version} từ phiên bản ${v}.`);
    load();
  };

  if (authLoading) return null;
  if (!isAuthenticated) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <p className="text-gray-300">Đăng nhập để xem lịch sử chương.</p>
        <button onClick={() => openAuthModal('login')} className="px-5 py-2 rounded-xl bg-brand-600 text-snow text-sm font-semibold">Đăng nhập</button>
      </div>
    );
  }

  const head = revs?.[0];
  const isDeleted = Boolean(head?.deleted);
  const diffRows = cmp ? rows(cmp.ops, cmp.blocks) : [];
  const changed = diffRows.filter((r) => r.kind !== 'same').length;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <Link href={`/truyen/${storySlug}`} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300" title="Về trang truyện">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><History className="w-5 h-5 text-brand-400" /> Lịch sử chương</h1>
          {head && <p className="text-xs text-gray-400 truncate">Chương {head.chapter_number}: {head.title}{isDeleted && <span className="ml-2 text-rose-300">(đã xóa)</span>}</p>}
        </div>
      </div>

      {error && <p className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">{error}</p>}
      {notice && <p className="p-4 rounded-2xl bg-white/5 border border-white/10 text-sm text-gray-200">{notice}</p>}
      {!revs && !error && <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}

      {revs && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
          <ol className="space-y-2">
            {revs.map((r, idx) => (
              <li key={r.version} className={`p-3 rounded-2xl border ${r.deleted ? 'bg-rose-500/5 border-rose-500/20' : 'bg-white/5 border-white/10'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white flex items-center gap-1.5">
                    {r.deleted && <Trash2 className="w-3.5 h-3.5 text-rose-300" />}
                    Phiên bản {r.version}
                    {idx === 0 && <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">hiện tại</span>}
                  </span>
                  <span className="text-[11px] text-gray-500">{when(r.created_at)}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {SOURCE_LABEL[r.source] || r.source}{r.source === 'rewind' || r.source === 'restore' ? ` (từ bản ${r.based_on})` : ''}
                  {r.author_name ? ` · ${r.author_name}` : ''}{!r.deleted ? ` · ${r.block_count} đoạn` : ''}
                </p>
                {!r.deleted && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <button onClick={() => setFrom(r.version)} className={`text-[11px] px-2 py-1 rounded-lg border ${from === r.version ? 'border-amber-400/60 text-amber-300' : 'border-white/10 text-gray-400 hover:text-white'}`}>So từ</button>
                    <button onClick={() => setTo(r.version)} className={`text-[11px] px-2 py-1 rounded-lg border ${to === r.version ? 'border-sky-400/60 text-sky-300' : 'border-white/10 text-gray-400 hover:text-white'}`}>So đến</button>
                    {(idx > 0 || isDeleted) && (
                      <button disabled={busy} onClick={() => rewind(r.version, isDeleted)} className="text-[11px] px-2 py-1 rounded-lg border border-white/10 text-gray-400 hover:text-white flex items-center gap-1 disabled:opacity-50">
                        <RotateCcw className="w-3 h-3" /> {isDeleted ? 'Khôi phục chương' : 'Dùng bản này'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>

          <section className="p-4 sm:p-5 rounded-3xl bg-white/5 border border-white/10 space-y-3 min-w-0">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-brand-400" />
              {from && to ? `So sánh bản ${from} → bản ${to}` : 'Chọn hai phiên bản để so sánh'}
              {cmp && <span className="text-xs font-normal text-gray-400">· {changed === 0 ? 'nội dung giống nhau' : `${changed} chỗ khác`}</span>}
            </h2>
            {cmp && (
              <div className="space-y-1.5 text-sm leading-relaxed">
                {diffRows.map((r, i) => {
                  if (r.kind === 'same') return <p key={i} className="text-gray-400 px-3 py-1">{blockText(r.a)}</p>;
                  if (r.kind === 'del') return <p key={i} className="px-3 py-1 rounded-lg bg-rose-500/10 text-rose-200 line-through decoration-rose-400/50">{blockText(r.a)}</p>;
                  if (r.kind === 'ins') return <p key={i} className="px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-200">{blockText(r.b)}</p>;
                  return (
                    <p key={i} className="px-3 py-1 rounded-lg bg-amber-500/5 border-l-2 border-amber-400/50 text-gray-200">
                      {wordDiff(blockText(r.a), blockText(r.b)).map((w, k) =>
                        w.k === 'same' ? <span key={k}>{w.t}</span>
                          : w.k === 'del' ? <del key={k} className="bg-rose-500/20 text-rose-200">{w.t}</del>
                          : <ins key={k} className="bg-emerald-500/20 text-emerald-200 no-underline">{w.t}</ins>
                      )}
                    </p>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
