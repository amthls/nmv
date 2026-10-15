'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { SkinIcon } from '@/components/skin/aemeath/icons';
import { useSkin, type Skin } from '@/lib/theme';

const SKINS: { id: Skin; name: string; thumb: string | null }[] = [
  { id: 'default', name: 'Mặc định', thumb: null },
  { id: 'aemeath', name: 'Aemeath', thumb: '/backgrounds/aemeath/sprite.webp' },
];

/** Lưới chọn skin (dùng trong popover ở header và trang tài khoản). */
export function SkinChoices({ compact = false }: { compact?: boolean }) {
  const { skin, setSkin } = useSkin();
  return (
    <div className={`grid grid-cols-2 gap-2 ${compact ? '' : 'sm:max-w-sm gap-3'}`}>
      {SKINS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setSkin(s.id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
          }}
          aria-pressed={skin === s.id}
          className={`p-2 rounded-xl border flex flex-col items-center gap-1.5 transition ${
            skin === s.id ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-white/10 hover:border-white/20'
          }`}
        >
          <div
            className="w-full h-16 rounded-lg border border-white/10 overflow-hidden flex items-end justify-center"
            style={{
              background: s.thumb
                ? 'linear-gradient(135deg, #0b0f24, #5b2a6e 55%, #f472b6)'
                : 'linear-gradient(135deg, #141414, #1672d6)',
            }}
          >
            {s.thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.thumb} alt="" loading="lazy" className="h-full w-auto object-cover object-top" />
            )}
          </div>
          <span className="text-xs text-gray-300 font-medium">{s.name}</span>
        </button>
      ))}
    </div>
  );
}

export default function SkinPicker({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Chọn skin giao diện"
        aria-expanded={open}
        title="Skin giao diện"
        className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.04] border border-white/[0.08] hover:bg-brand-500/20 hover:border-brand-400/50 text-gray-300 hover:text-white transition"
      >
        <SkinIcon lucide={Palette} ae="sparkles" className="w-[18px] h-[18px]" />
      </button>
      {open && (
        <div className="glass-menu absolute right-0 top-full mt-2 w-60 rounded-2xl p-3 z-50">
          <p className="text-[11px] font-semibold text-gray-400 mb-2">Skin giao diện</p>
          <SkinChoices compact />
        </div>
      )}
    </div>
  );
}
