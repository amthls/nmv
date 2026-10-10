'use client';

import React, { useEffect, useState } from 'react';
import { GitMerge, X } from 'lucide-react';

/**
 * "Cập nhật theo bản chính" (Plan/chapter-workspace.md, stage 2): the workspace merges the official changes into the
 * draft paragraph by paragraph (like git pull); where both changed the same place, the user picks a side here.
 * Also taking in a helper's copy (stage 4a, `offer`): there every change of the helper is a choice.
 */

const WS_URL = '/api/ws';

type Choice = 'ours' | 'theirs' | 'both';
interface BlockConflict { id: string; base: string[]; ours: string[]; theirs: string[] }
interface MetaConflict { id: string; base: unknown; ours: unknown; theirs: unknown }
interface Plan {
  from: number;
  to: number;
  chunks: { ok?: string[]; conflict?: BlockConflict }[];
  meta_conflicts: MetaConflict[];
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Tiêu đề',
  chapter_number: 'Số chương',
  volume_id: 'Tập',
  intro_note: 'Lời nhắn đầu chương',
  outro_note: 'Lời nhắn cuối chương',
};

function blockText(raw: any): string {
  if (!raw) return '';
  if (raw.text) return raw.text;
  if (raw.image_url) return '[Ảnh minh họa]';
  return raw.type === 'separator' ? '* * *' : '';
}

function fieldText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(trống)';
  return String(v).replace(/<[^>]+>/g, ' ').trim() || '(trống)';
}

function Side({ label, lines, active, onPick, tone }: { label: string; lines: string[]; active: boolean; onPick: () => void; tone: string }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`text-left p-3 rounded-xl border text-xs space-y-1.5 transition ${active ? `${tone} ring-2 ring-offset-0` : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
    >
      <div className="text-[10px] font-bold uppercase text-gray-400">{label}</div>
      {lines.length === 0 ? (
        <div className="text-gray-500 italic">(đã xóa đoạn này)</div>
      ) : (
        lines.map((l, i) => <p key={i} className="text-gray-200 whitespace-pre-line line-clamp-6">{l}</p>)
      )}
    </button>
  );
}

export default function PullDialog({
  draftId,
  draftVersion,
  authFetch,
  onDone,
  onClose,
  offer,
}: {
  draftId: string;
  draftVersion: number;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onDone: (draft: any) => void;
  onClose: () => void;
  offer?: { id: string; name: string; onDecline: () => void }; // a helper's copy instead of the official line
}) {
  const url = offer ? `${WS_URL}/drafts/${draftId}/offers/${offer.id}` : `${WS_URL}/drafts/${draftId}/pull`;
  const theirsLabel = offer ? `Bản của ${offer.name}` : 'Bản chính';
  const [plan, setPlan] = useState<Plan | null>(null);
  const [blocks, setBlocks] = useState<Record<string, any>>({});
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    authFetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.message || 'Không tải được phần cập nhật.');
        setPlan(json.data.plan);
        setBlocks(json.data.blocks || {});
      })
      .catch((e) => setError(e.message));
  }, [authFetch, url]);

  const conflicts = (plan?.chunks || []).flatMap((c) => (c.conflict ? [c.conflict] : []));
  const total = conflicts.length + (plan?.meta_conflicts.length || 0);
  const chosen = Object.keys(choices).length;
  const lines = (hashes: string[]) => hashes.map((h) => blockText(blocks[h])).filter(Boolean);

  const apply = async () => {
    if (!plan) return;
    setApplying(true);
    setError(null);
    try {
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_version: draftVersion, to_version: plan.to, choices }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Cập nhật thất bại.');
      onDone(json.data);
    } catch (e: any) {
      setError(e.message);
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl bg-glass border border-white/10 shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pull-title"
      >
        <div className="flex items-center justify-between">
          <h3 id="pull-title" className="text-base font-bold text-white flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-amber-400" />
            {offer ? `Nhận bản sửa của ${offer.name}` : `Cập nhật theo bản chính${plan ? ` (v${plan.from} → v${plan.to})` : ''}`}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!plan && !error && <p className="text-xs text-gray-400">Đang so sánh bản nháp với bản chính...</p>}

        {plan && total === 0 && (
          <p className="text-xs text-gray-300">
            {offer
              ? `${offer.name} không đổi đoạn nào so với lúc chép.`
              : 'Không có chỗ nào bị sửa trùng: các đoạn bản chính đã đổi sẽ được đưa vào nháp, phần bạn đã sửa được giữ nguyên.'}
          </p>
        )}

        {plan && total > 0 && (
          <div className="text-xs text-gray-300 flex flex-wrap items-center justify-between gap-2">
            {offer ? (
              <span>{offer.name} đã sửa <b className="text-amber-300">{total}</b> chỗ. Chọn từng chỗ, hoặc nhận cả bản. Phần bạn tự sửa sau khi họ chép được giữ nguyên.</span>
            ) : (
              <span>Phần không trùng đã được gộp tự động. Có <b className="text-amber-300">{total}</b> chỗ cả bạn và bản chính cùng sửa: bấm vào bản muốn giữ.</span>
            )}
            {offer && (
              <button
                type="button"
                onClick={() => setChoices(Object.fromEntries([...conflicts.map((c) => [c.id, 'theirs']), ...(plan.meta_conflicts || []).map((c) => [c.id, 'theirs'])]))}
                className="px-3 py-1 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-snow font-bold"
              >
                Nhận cả bản
              </button>
            )}
          </div>
        )}

        {plan?.meta_conflicts.map((c) => (
          <div key={c.id} className="space-y-2">
            <div className="text-[11px] font-bold text-gray-300">{FIELD_LABELS[c.id] || c.id}</div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Side label="Bản của tôi" lines={[fieldText(c.ours)]} active={choices[c.id] === 'ours'} tone="border-brand-500 bg-brand-500/10 ring-brand-500/40" onPick={() => setChoices({ ...choices, [c.id]: 'ours' })} />
              <Side label={theirsLabel} lines={[fieldText(c.theirs)]} active={choices[c.id] === 'theirs'} tone="border-emerald-500 bg-emerald-500/10 ring-emerald-500/40" onPick={() => setChoices({ ...choices, [c.id]: 'theirs' })} />
            </div>
          </div>
        ))}

        {conflicts.map((c, i) => (
          <div key={c.id} className="space-y-2">
            <div className="text-[11px] font-bold text-gray-300">Đoạn sửa trùng #{i + 1}</div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Side label="Bản của tôi" lines={lines(c.ours)} active={choices[c.id] === 'ours'} tone="border-brand-500 bg-brand-500/10 ring-brand-500/40" onPick={() => setChoices({ ...choices, [c.id]: 'ours' })} />
              <Side label={theirsLabel} lines={lines(c.theirs)} active={choices[c.id] === 'theirs'} tone="border-emerald-500 bg-emerald-500/10 ring-emerald-500/40" onPick={() => setChoices({ ...choices, [c.id]: 'theirs' })} />
            </div>
            <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer w-fit">
              <input type="radio" checked={choices[c.id] === 'both'} onChange={() => setChoices({ ...choices, [c.id]: 'both' })} />
              Giữ cả hai (bản của tôi trước, {theirsLabel.toLowerCase()} sau)
            </label>
          </div>
        ))}

        {error && <p className="text-xs text-rose-300 font-semibold">{error}</p>}

        <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
          {offer && (
            <button type="button" onClick={offer.onDecline} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-rose-500/20 text-xs font-bold text-gray-300 mr-auto">
              Không nhận
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold text-gray-300">
            Để sau
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!plan || applying || chosen < total}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-ink text-xs font-bold"
          >
            {applying ? 'Đang cập nhật...' : total > chosen ? `Còn ${total - chosen} chỗ chưa chọn` : offer ? 'Nhận vào nháp' : 'Cập nhật nháp'}
          </button>
        </div>
      </div>
    </div>
  );
}
