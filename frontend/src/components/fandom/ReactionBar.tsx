'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { REACTIONS, readJson } from '@/lib/fandom';
import { COMMUNITY_URL } from '@/lib/apiJson';

interface ReactionBarProps {
  postId: string;
  myReaction: string | null;
  onChange: (data: { reaction_count: number; reaction_summary: Record<string, number>; my_reaction: string | null }) => void;
  /** wide = the full row of emoji on the post page */
  variant?: 'button' | 'wide';
}

/**
 * Reaction control. The main button toggles your current reaction (👍 by default); the small
 * arrow opens the picker, which also works on touch screens (no hover needed).
 */
export default function ReactionBar({ postId, myReaction, onChange, variant = 'button' }: ReactionBarProps) {
  const { isAuthenticated, authFetch, openAuthModal } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const react = async (type: string) => {
    if (!isAuthenticated) return openAuthModal('login');
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      const json = await readJson(await authFetch(`${COMMUNITY_URL}/posts/${postId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction: type }),
      }));
      onChange(json.data);
    } catch (e) {
      console.error('Failed to react:', e);
    } finally {
      setBusy(false);
    }
  };

  const current = REACTIONS.find((r) => r.type === myReaction);

  if (variant === 'wide') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {REACTIONS.map((r) => (
          <button
            key={r.type}
            onClick={() => react(r.type)}
            disabled={busy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition active:scale-95 ${
              myReaction === r.type ? 'bg-brand-600/25 border-brand-500 text-brand-200' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
            }`}
          >
            <span className="text-sm">{r.emoji}</span>{r.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex items-stretch">
      {open && (
        <div className="absolute bottom-full mb-2 left-0 z-30 flex items-center gap-1 p-1.5 rounded-full bg-surface-3 border border-white/15 shadow-2xl">
          {REACTIONS.map((r) => (
            <button
              key={r.type}
              onClick={() => react(r.type)}
              className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition-transform hover:scale-125 active:scale-95 ${myReaction === r.type ? 'bg-white/15' : 'hover:bg-white/10'}`}
              title={r.name}
            >
              {r.emoji}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => react(myReaction || 'like')}
        disabled={busy}
        className={`flex items-center gap-1.5 pl-3.5 pr-2 py-2 rounded-l-xl text-xs font-semibold transition ${
          current ? 'bg-brand-600/20 text-brand-200' : 'bg-white/5 hover:bg-white/10 text-gray-300'
        }`}
      >
        <span>{current ? current.emoji : '👍'}</span>
        <span>{current ? current.name : 'Thích'}</span>
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Chọn cảm xúc khác"
        className={`px-1.5 rounded-r-xl border-l border-white/10 transition ${current ? 'bg-brand-600/20 text-brand-200' : 'bg-white/5 hover:bg-white/10 text-gray-400'}`}
      >
        <ChevronUp className={`w-3.5 h-3.5 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
    </div>
  );
}
