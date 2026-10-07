'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { X, Dices, Volume2, VolumeX, BookOpen, RotateCcw, Eye, Star } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { Story, formatCount, formatRating } from '@/components/explore/StoryCardGrid';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

/*
 * CS2-style "case opening": a long strip of story covers scrolls under a fixed centre marker,
 * decelerates and stops on the winner. Rarity is the story's popularity rank (views), and the
 * drop odds per rarity are the real CS2 case odds, so the gold tier really is rare.
 */

type Tier = { key: string; label: string; color: string; odds: number; share: number };

// share = cumulative fraction of the pool (by view rank, most viewed first) up to this tier
const TIERS: Tier[] = [
  { key: 'gold', label: '★ Cực hiếm', color: '#e4ae39', odds: 0.0026, share: 0.03 },
  { key: 'covert', label: 'Huyền thoại', color: '#eb4b4b', odds: 0.0064, share: 0.1 },
  { key: 'classified', label: 'Sử thi', color: '#d32ce6', odds: 0.032, share: 0.25 },
  { key: 'restricted', label: 'Hiếm', color: '#8847ff', odds: 0.1598, share: 0.5 },
  { key: 'milspec', label: 'Phổ thông', color: '#4b69ff', odds: 0.7992, share: 1 },
];

type Item = { story: Story; tier: Tier };

const ITEM_W = 150; // px, card width + gap
const REEL_LEN = 70;
const WIN_INDEX = 60;
const SPIN_MS = 7000;

function assignTiers(stories: Story[]): Item[] {
  const sorted = [...stories].sort((a, b) => Number(b.total_views || 0) - Number(a.total_views || 0));
  const n = sorted.length;
  let start = 0;
  const out: Item[] = [];
  for (const tier of TIERS) {
    // Every non-empty tier gets at least one story when the pool is big enough
    const end = tier.share >= 1 ? n : Math.min(n, Math.max(start + (n >= TIERS.length ? 1 : 0), Math.round(n * tier.share)));
    for (let i = start; i < end; i++) out.push({ story: sorted[i], tier });
    start = Math.max(start, end);
  }
  return out;
}

function rollTier(items: Item[]): Tier {
  const present = TIERS.filter((t) => items.some((it) => it.tier.key === t.key));
  const total = present.reduce((s, t) => s + t.odds, 0);
  let r = Math.random() * total;
  for (const t of present) {
    r -= t.odds;
    if (r <= 0) return t;
  }
  return present[present.length - 1];
}

function rollItem(items: Item[]): Item {
  const tier = rollTier(items);
  const pool = items.filter((it) => it.tier.key === tier.key);
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildReel(items: Item[], winner?: Item): Item[] {
  const reel = Array.from({ length: REEL_LEN }, () => rollItem(items));
  if (winner) reel[WIN_INDEX] = winner;
  return reel;
}

// Short synthesized "tick" like the CS2 reel, no audio files needed
function useTick() {
  const ctxRef = useRef<AudioContext | null>(null);
  const ensure = () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (AC) ctxRef.current = new AC();
    }
    if (ctxRef.current?.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  };
  const tone = (freq: number, dur: number, vol: number, type: OscillatorType = 'square') => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  };
  return {
    ensure,
    tick: () => tone(1800 + Math.random() * 300, 0.03, 0.05),
    reveal: (rare: boolean) => {
      tone(rare ? 660 : 520, 0.25, 0.08, 'triangle');
      setTimeout(() => tone(rare ? 990 : 780, 0.4, 0.08, 'triangle'), 120);
      if (rare) setTimeout(() => tone(1320, 0.6, 0.07, 'triangle'), 260);
    },
  };
}

export default function StoryCaseOpening({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [type, setType] = useState<'all' | 'novel' | 'manga'>('all');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [reel, setReel] = useState<Item[]>([]);
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'done'>('idle');
  const [winner, setWinner] = useState<Item | null>(null);
  const [muted, setMuted] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const sound = useTick();

  // Load the pool whenever the modal opens or the type filter changes
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setPhase('idle');
    setWinner(null);
    const typeParam = type === 'all' ? '' : `&type=${type}`;
    fetch(`${API_BASE_URL}/stories/explore?sort=views&limit=100${typeParam}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        const stories: Story[] = json?.success ? json.data || [] : [];
        const tiered = assignTiers(stories);
        setItems(tiered);
        setReel(tiered.length ? buildReel(tiered) : []);
      })
      .catch(() => !cancelled && setItems([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isOpen, type]);

  // Reset strip position when a fresh idle reel is shown
  useEffect(() => {
    if (phase !== 'idle' || !stripRef.current) return;
    stripRef.current.style.transition = 'none';
    stripRef.current.style.transform = 'translateX(0px)';
  }, [reel, phase]);

  const stopLoops = () => {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      stopLoops();
    };
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (phase === 'spinning') return;
    stopLoops();
    setPhase('idle');
    setWinner(null);
    onClose();
  }, [phase, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && handleClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

  const spin = () => {
    if (!items.length || phase === 'spinning') return;
    sound.ensure();
    const win = rollItem(items);
    const newReel = buildReel(items, win);
    setReel(newReel);
    setWinner(null);
    setPhase('spinning');

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduceMotion ? 1200 : SPIN_MS;

    // Wait one frame so the new reel is in the DOM at position 0, then launch it
    requestAnimationFrame(() => {
      const strip = stripRef.current;
      const viewport = viewportRef.current;
      if (!strip || !viewport) return;
      strip.style.transition = 'none';
      strip.style.transform = 'translateX(0px)';
      void strip.offsetWidth; // flush so the transition starts from 0

      // Land somewhere inside the winning card (not always dead centre), like CS2
      const jitter = ITEM_W * (0.12 + Math.random() * 0.76);
      const target = WIN_INDEX * ITEM_W + jitter - viewport.clientWidth / 2;
      strip.style.transition = `transform ${duration}ms cubic-bezier(0.08, 0.6, 0.12, 1)`;
      strip.style.transform = `translateX(${-target}px)`;

      // Tick each time a card boundary passes the centre marker
      let lastIdx = -1;
      const loop = () => {
        const m = new DOMMatrixReadOnly(getComputedStyle(strip).transform);
        const idx = Math.floor((-m.m41 + viewport.clientWidth / 2) / ITEM_W);
        if (idx !== lastIdx) {
          if (lastIdx !== -1 && !mutedRef.current) sound.tick();
          lastIdx = idx;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);

      timerRef.current = setTimeout(() => {
        cancelAnimationFrame(rafRef.current);
        setWinner(win);
        setPhase('done');
        if (!mutedRef.current) sound.reveal(['gold', 'covert', 'classified'].includes(win.tier.key));
      }, duration + 150);
    });
  };

  // "Case contents" preview: best of each tier first
  const contents = useMemo(() => items.slice(0, 18), [items]);

  if (!isOpen) return null;

  return (
    <div className="dark fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={handleClose} />

      <div className="relative w-full max-w-5xl max-h-full overflow-y-auto rounded-2xl border border-white/10 bg-[#121417] shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-snow shadow-lg shadow-orange-500/30">
              <Dices className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold tracking-tight uppercase">Hòm Truyện Bí Ẩn</h2>
              <p className="text-xs text-gray-400 truncate">Mở hòm để nhận một bộ truyện ngẫu nhiên. Truyện càng hot càng hiếm!</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
              title={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={phase === 'spinning'}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition disabled:opacity-30"
              title="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-2 px-4 sm:px-6 pt-4">
          {(['all', 'novel', 'manga'] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={phase === 'spinning'}
              onClick={() => setType(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider border transition disabled:opacity-40 ${
                type === t ? 'bg-white/15 border-white/30 text-white' : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
              }`}
            >
              {t === 'all' ? 'Tất cả' : t === 'novel' ? 'Novel' : 'Manga'}
            </button>
          ))}
        </div>

        {/* Reel */}
        <div className="px-4 sm:px-6 pt-4">
          <div
            ref={viewportRef}
            className="case-reel relative h-[230px] overflow-hidden rounded-lg border border-white/10 bg-[#0b0c0e]"
          >
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Đang nạp hòm...</div>
            ) : reel.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Chưa có truyện nào để quay.</div>
            ) : (
              <div ref={stripRef} className="absolute top-0 left-0 h-full flex will-change-transform">
                {reel.map((it, i) => (
                  <div key={i} className="shrink-0 h-full py-4 px-[5px]" style={{ width: ITEM_W }}>
                    <div
                      className={`case-item relative h-full rounded-md overflow-hidden bg-[#1a1d22] ${
                        phase === 'done' && i === WIN_INDEX ? 'case-item--win' : ''
                      }`}
                      style={{ '--tier': it.tier.color } as React.CSSProperties}
                    >
                      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 40%, ${it.tier.color}40, transparent 70%)` }} />
                      <SmartImage
                        src={it.story.cover_image_url}
                        alt=""
                        draggable={false}
                        className="relative w-full h-[150px] object-cover"
                      />
                      <div className="relative px-2 pt-1.5">
                        <p className="text-[11px] font-semibold leading-tight line-clamp-2 text-gray-100">{it.story.title}</p>
                      </div>
                      <div className="absolute bottom-0 inset-x-0 h-1" style={{ background: it.tier.color }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Centre marker */}
            <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-amber-400 shadow-[0_0_12px_2px_rgba(251,191,36,0.7)] z-10" />
            <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-x-[9px] border-x-transparent border-t-[12px] border-t-amber-400 z-10" />
            <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0 border-x-[9px] border-x-transparent border-b-[12px] border-b-amber-400 z-10" />
            {/* Edge fades */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-[#0b0c0e] to-transparent z-[5]" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-[#0b0c0e] to-transparent z-[5]" />
          </div>
        </div>

        {/* Action / result */}
        <div className="px-4 sm:px-6 py-5">
          {phase === 'done' && winner ? (
            <div
              className="case-reveal relative flex flex-col sm:flex-row gap-5 items-center sm:items-stretch p-4 rounded-xl border overflow-hidden"
              style={{ borderColor: winner.tier.color, '--tier': winner.tier.color } as React.CSSProperties}
            >
              <div className="case-reveal__rays absolute inset-0 pointer-events-none" />
              <div className="relative w-32 shrink-0 aspect-[2/3] rounded-md overflow-hidden" style={{ boxShadow: `0 0 40px -6px ${winner.tier.color}` }}>
                <SmartImage src={winner.story.cover_image_url} alt={winner.story.title} className="w-full h-full object-cover" />
              </div>
              <div className="relative flex-1 min-w-0 text-center sm:text-left flex flex-col">
                <span className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: winner.tier.color }}>
                  {winner.tier.label}
                </span>
                <h3 className="mt-1 text-xl font-extrabold leading-snug line-clamp-2">{winner.story.title}</h3>
                <p className="text-xs text-gray-400 mt-1">{winner.story.author_name || 'Chưa rõ tác giả'}</p>
                <div className="mt-2 flex items-center justify-center sm:justify-start gap-3 text-xs text-gray-300">
                  <span className="flex items-center gap-1 text-amber-400 font-semibold"><Star className="w-3.5 h-3.5 fill-current" />{formatRating(winner.story.rating_avg)}</span>
                  <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{formatCount(winner.story.total_views)}</span>
                  <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />{winner.story.total_chapters || 0} chương</span>
                </div>
                {winner.story.synopsis && (
                  <p className="mt-2 text-xs text-gray-400 line-clamp-2">{winner.story.synopsis.replace(/<[^>]+>/g, '')}</p>
                )}
                <div className="mt-auto pt-3 flex flex-wrap justify-center sm:justify-start gap-2">
                  <Link
                    href={`/truyen/${winner.story.slug}`}
                    onClick={handleClose}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-snow text-sm font-bold transition"
                  >
                    Đọc ngay
                  </Link>
                  <button
                    type="button"
                    onClick={spin}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-sm font-bold transition"
                  >
                    <RotateCcw className="w-4 h-4" /> Mở hòm khác
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={spin}
                disabled={loading || !items.length || phase === 'spinning'}
                className="min-w-[220px] px-8 py-3 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 text-snow font-black uppercase tracking-widest shadow-lg shadow-emerald-900/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {phase === 'spinning' ? 'Đang mở...' : 'Mở hòm'}
              </button>
            </div>
          )}
        </div>

        {/* Case contents */}
        {contents.length > 0 && (
          <div className="px-4 sm:px-6 pb-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">Vật phẩm trong hòm ({items.length})</h4>
              <div className="hidden sm:flex items-center gap-3 text-[10px] text-gray-400">
                {TIERS.map((t) => (
                  <span key={t.key} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm" style={{ background: t.color }} />
                    {t.label} {(t.odds * 100).toFixed(2).replace(/\.?0+$/, '')}%
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {contents.map((it) => (
                <div key={it.story.id} className="relative rounded-md overflow-hidden bg-[#1a1d22]" title={it.story.title}>
                  <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 40%, ${it.tier.color}33, transparent 70%)` }} />
                  <SmartImage src={it.story.cover_image_url} alt="" className="relative w-full aspect-[3/4] object-cover" />
                  <p className="relative px-1.5 py-1 text-[10px] font-medium line-clamp-1 text-gray-200">{it.story.title}</p>
                  <div className="absolute bottom-0 inset-x-0 h-[3px]" style={{ background: it.tier.color }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
