'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { STEP_COLOR, STEP_LABEL } from './TaskCard';

const STEP_ROLE: Record<string, string> = {
  raw: 'Cung cấp RAW', translate: 'Dịch giả', edit: 'Biên tập', proofread: 'Hiệu đính', merge: 'Người giữ truyện',
};

/**
 * A group's chapter workflow drawn as steps with arrows (its steps, then GỘP). With `counts` each step shows how many
 * tasks wait there; with `onPick` a step is a filter button (the active one highlighted, clicking it again clears).
 */
export default function WorkflowSteps({
  workflow, counts, active, onPick,
}: { workflow?: string[]; counts?: Record<string, number>; active?: string; onPick?: (step: string) => void }) {
  const steps = [...(workflow?.length ? workflow : ['translate']), 'merge'];
  return (
    <ol className="flex flex-wrap items-stretch gap-1.5" aria-label="Quy trình làm chương">
      {steps.map((k, i) => {
        const body = (
          <>
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-extrabold ${STEP_COLOR[k] || 'bg-white/10 text-white'}`}>{STEP_LABEL[k] || k}</span>
            <span className="text-[10px] text-gray-400">{STEP_ROLE[k] || ''}</span>
            {counts && <span className="text-sm font-extrabold text-white">{counts[k] || 0} <span className="text-[10px] font-normal text-gray-400">việc</span></span>}
          </>
        );
        const box = `flex min-w-[88px] flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left ${active === k ? 'border-brand-400 bg-brand-500/15' : 'border-white/10 bg-white/5'}`;
        return (
          <li key={k} className="flex items-center gap-1.5">
            {onPick ? (
              <button type="button" onClick={() => onPick(active === k ? '' : k)} aria-pressed={active === k} className={`${box} hover:border-brand-400/60`}>{body}</button>
            ) : (
              <div className={box}>{body}</div>
            )}
            {i < steps.length - 1 && <ChevronRight className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
