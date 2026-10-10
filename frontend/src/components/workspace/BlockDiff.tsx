'use client';

import React from 'react';

/**
 * Paragraph-level diff from the workspace (ops over block hashes) rendered for people: unchanged, removed, added,
 * or changed (a removed + an added paragraph shown as one, with a word diff). Used by chapter history and proposals.
 */

export type Op = { op: 'same' | 'del' | 'ins'; hash: string };
export type Block = { type: string; text?: string; image_url?: string; note?: string };
export type DiffRow = { kind: 'same' | 'del' | 'ins' | 'mod'; a?: Block; b?: Block; aHash?: string; bHash?: string };

export const blockText = (b?: Block) => (b ? b.text || (b.image_url ? `[Ảnh] ${b.image_url.split('/').pop()}` : b.type === 'separator' ? '———' : '') : '');

/** Word-level diff of two paragraphs (LCS over words; paragraphs are short). */
export function wordDiff(a: string, b: string): { t: string; k: 'same' | 'del' | 'ins' }[] {
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
export function diffRows(ops: Op[], blocks: Record<string, Block>): DiffRow[] {
  const out: DiffRow[] = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const next = ops[i + 1];
    if (o.op === 'del' && next?.op === 'ins') {
      out.push({ kind: 'mod', a: blocks[o.hash], b: blocks[next.hash], aHash: o.hash, bHash: next.hash });
      i++;
    } else {
      out.push({
        kind: o.op,
        a: o.op !== 'ins' ? blocks[o.hash] : undefined, aHash: o.op !== 'ins' ? o.hash : undefined,
        b: o.op !== 'del' ? blocks[o.hash] : undefined, bHash: o.op !== 'del' ? o.hash : undefined,
      });
    }
  }
  return out;
}

/** One diff row; `children` goes under it (comments on that paragraph, a comment button...). */
export function DiffRowView({ r, children }: { r: DiffRow; children?: React.ReactNode }) {
  let body: React.ReactNode;
  if (r.kind === 'same') body = <p className="text-gray-400 px-3 py-1">{blockText(r.a)}</p>;
  else if (r.kind === 'del') body = <p className="px-3 py-1 rounded-lg bg-rose-500/10 text-rose-200 line-through decoration-rose-400/50">{blockText(r.a)}</p>;
  else if (r.kind === 'ins') body = <p className="px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-200">{blockText(r.b)}</p>;
  else {
    body = (
      <p className="px-3 py-1 rounded-lg bg-amber-500/5 border-l-2 border-amber-400/50 text-gray-200">
        {wordDiff(blockText(r.a), blockText(r.b)).map((w, k) =>
          w.k === 'same' ? <span key={k}>{w.t}</span>
            : w.k === 'del' ? <del key={k} className="bg-rose-500/20 text-rose-200">{w.t}</del>
            : <ins key={k} className="bg-emerald-500/20 text-emerald-200 no-underline">{w.t}</ins>
        )}
      </p>
    );
  }
  return <div>{body}{children}</div>;
}

/** Rows to show: unchanged paragraphs far from any change fold into one "N unchanged" gap (keeps `context` around changes). */
export function foldRows(rows: DiffRow[], context = 1): (DiffRow | { kind: 'gap'; count: number })[] {
  const near = rows.map((_, i) => rows.slice(Math.max(0, i - context), i + context + 1).some((r) => r.kind !== 'same'));
  const out: (DiffRow | { kind: 'gap'; count: number })[] = [];
  rows.forEach((r, i) => {
    if (r.kind !== 'same' || near[i]) return out.push(r);
    const last = out[out.length - 1];
    if (last?.kind === 'gap') last.count++;
    else out.push({ kind: 'gap', count: 1 });
  });
  return out;
}

export function GapRow({ count }: { count: number }) {
  return <p className="px-3 py-0.5 text-[11px] text-gray-500 italic">… {count} đoạn không đổi</p>;
}
