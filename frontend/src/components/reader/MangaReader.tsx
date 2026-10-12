'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/components/common/Link';
import { ChevronLeft, ImageOff, Loader2, RotateCw, SlidersHorizontal, X } from 'lucide-react';
import { imageUrlForQuality, useImageQuality } from '@/lib/imageQuality';

/*
 * Manga reader modelled on MangaDex's: four page layouts (single, double, long strip, wide strip),
 * four ways to fit a page (both / width / height / original), optional "grow small pages",
 * left-to-right or right-to-left. Pages are always centred and the long strip has no gaps by default.
 * Settings are remembered per browser.
 */

export interface MangaPage {
  page_number: number;
  image_url: string;
  width?: number | null;
  height?: number | null;
}

type Mode = 'single' | 'double' | 'strip' | 'wide';
type Fit = 'both' | 'width' | 'height' | 'none';
export interface MangaReaderSettings {
  mode: Mode;
  fit: Fit;
  grow: boolean;
  rtl: boolean;
  stripWidth: number; // px, long strip column
  gap: number; // px between pages in the strips
}

const STORAGE_KEY = 'novelhub_manga_reader';
const DEFAULTS: MangaReaderSettings = { mode: 'strip', fit: 'width', grow: false, rtl: false, stripWidth: 800, gap: 0 };
const HEADER_PX = 56; // sticky reader header
const FIT_H = `calc(100vh - ${HEADER_PX}px)`;

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'strip', label: 'Cuộn dọc', hint: 'Các trang nối liền, cột vừa phải' },
  { id: 'wide', label: 'Cuộn dọc tràn', hint: 'Như cuộn dọc nhưng rộng hết màn hình (webtoon)' },
  { id: 'single', label: 'Từng trang', hint: 'Mỗi lần một trang, bấm/chạm hai bên để lật' },
  { id: 'double', label: 'Hai trang', hint: 'Hai trang cạnh nhau như sách in' },
];
const FITS: { id: Fit; label: string }[] = [
  { id: 'both', label: 'Vừa màn hình' },
  { id: 'width', label: 'Vừa chiều ngang' },
  { id: 'height', label: 'Vừa chiều dọc' },
  { id: 'none', label: 'Cỡ gốc' },
];
const WIDTHS = [640, 800, 960, 1200];
const GAPS = [0, 8, 24];

function loadSettings(): MangaReaderSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {}
  return DEFAULTS;
}

/** A page wider than tall is a two-page spread: in double mode it is shown on its own. */
const isSpread = (p: MangaPage) => Boolean(p.width && p.height && p.width > p.height);

/** Double page: the cover and every spread stand alone, the rest are paired. */
function pairPages(pages: MangaPage[]): number[][] {
  const views: number[][] = [];
  let i = 0;
  while (i < pages.length) {
    if (i === 0 || isSpread(pages[i]) || i + 1 >= pages.length || isSpread(pages[i + 1])) {
      views.push([i]);
      i += 1;
    } else {
      views.push([i, i + 1]);
      i += 2;
    }
  }
  return views;
}

/** Size rules for one page image (MangaDex's limit-width / limit-height / grow-pages). */
function imageStyle(s: MangaReaderSettings, paged: boolean, pair: boolean): React.CSSProperties {
  const limitW = s.fit === 'both' || s.fit === 'width';
  const limitH = s.fit === 'both' || s.fit === 'height';
  const style: React.CSSProperties = { display: 'block', objectFit: 'contain', height: 'auto', width: 'auto' };
  if (limitW) style.maxWidth = pair ? '50%' : '100%';
  else style.maxWidth = 'none';
  if (limitH) style.maxHeight = FIT_H;
  if (s.grow) {
    if (limitW && !limitH) style.width = pair ? '50%' : '100%';
    else if (limitH && !limitW) style.height = FIT_H;
    else if (limitW && limitH) {
      if (paged) style.height = FIT_H;
      else style.width = '100%';
    }
  }
  return style;
}

interface MangaReaderProps {
  pages: MangaPage[];
  /** next / previous chapter, offered when the reader runs past either end in paged modes */
  nextHref?: string | null;
  prevHref?: string | null;
  /** local previews (blob: URLs) skip the adaptive-quality image URLs */
  local?: boolean;
}

export default function MangaReader({ pages, nextHref, prevHref, local = false }: MangaReaderProps) {
  const [s, setS] = useState<MangaReaderSettings>(DEFAULTS);
  const [panel, setPanel] = useState(false);
  const [view, setView] = useState(0); // index into `views` in paged modes
  const rootRef = useRef<HTMLDivElement>(null);
  const [quality] = useImageQuality();

  useEffect(() => setS(loadSettings()), []);
  const update = (patch: Partial<MangaReaderSettings>) =>
    setS((prev) => {
      const next = { ...prev, ...patch };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
      return next;
    });

  const paged = s.mode === 'single' || s.mode === 'double';
  const views = useMemo(
    () => (s.mode === 'double' ? pairPages(pages) : pages.map((_, i) => [i])),
    [pages, s.mode],
  );
  const atEnd = paged && view >= views.length; // "end of chapter" screen after the last page

  // Keep the position when switching between single and double page
  const firstPageShown = views[Math.min(view, views.length - 1)]?.[0] ?? 0;
  const firstPageRef = useRef(firstPageShown);
  firstPageRef.current = firstPageShown;
  useEffect(() => {
    const idx = views.findIndex((v) => v.includes(firstPageRef.current));
    setView(idx >= 0 ? idx : 0);
  }, [views]);
  useEffect(() => setView(0), [pages]);

  const go = useCallback(
    (delta: number) => {
      setView((v) => Math.max(0, Math.min(views.length, v + delta)));
      rootRef.current?.scrollIntoView({ block: 'start' });
    },
    [views.length],
  );
  // RTL: the left side moves forward
  const goLeft = useCallback(() => go(s.rtl ? 1 : -1), [go, s.rtl]);
  const goRight = useCallback(() => go(s.rtl ? -1 : 1), [go, s.rtl]);

  // Arrow keys turn pages in paged modes; the page's own chapter shortcuts then stand down
  useEffect(() => {
    if (!paged) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); goLeft(); }
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); goRight(); }
      else if (e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); }
      else if (e.key === 'PageUp') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [paged, goLeft, goRight, go]);

  // Preload the next two views
  useEffect(() => {
    if (!paged) return;
    views.slice(view + 1, view + 3).flat().forEach((i) => {
      const img = new window.Image();
      img.src = (local ? pages[i].image_url : imageUrlForQuality(pages[i].image_url, quality)) || pages[i].image_url;
    });
  }, [paged, view, views, pages, local, quality]);

  const renderPage = (i: number, pair: boolean, eager: boolean) => {
    const p = pages[i];
    return <PageImage key={`${p.page_number}-${i}`} page={p} local={local} eager={eager} style={imageStyle(s, paged, pair)} />;
  };

  if (pages.length === 0) return null;

  return (
    <div ref={rootRef} className="relative scroll-mt-14">
      {/* Display settings */}
      {/* zero-height sticky rows: the controls float over the pages without pushing them down */}
      <div className="sticky top-14 z-30 h-0 flex justify-end pointer-events-none">
        <div className="pointer-events-auto m-2 flex items-center gap-1.5">
          {paged && !atEnd && (
            <span className="px-2.5 py-1.5 rounded-lg bg-black/60 text-snow text-xs font-semibold tabular-nums">
              {views[view].map((i) => i + 1).join('–')} / {pages.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => setPanel((v) => !v)}
            className="px-2.5 py-1.5 rounded-lg bg-black/60 hover:bg-black/75 text-snow text-xs font-semibold flex items-center gap-1.5"
            aria-expanded={panel}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> Kiểu đọc
          </button>
        </div>
      </div>
      {panel && (
        <div className="sticky top-[6.25rem] z-30 h-0 flex justify-end pointer-events-none">
          <div className="pointer-events-auto mx-2 w-[min(92vw,360px)] rounded-xl glass-strong p-4 space-y-4 text-xs text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">Kiểu đọc truyện tranh</span>
              <button type="button" onClick={() => setPanel(false)} aria-label="Đóng" className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <Group label="Bố cục trang">
              {MODES.map((m) => (
                <Chip key={m.id} on={s.mode === m.id} title={m.hint} onClick={() => update({ mode: m.id })}>{m.label}</Chip>
              ))}
            </Group>
            <Group label="Cỡ ảnh">
              {FITS.map((f) => (
                <Chip key={f.id} on={s.fit === f.id} onClick={() => update({ fit: f.id })}>{f.label}</Chip>
              ))}
            </Group>
            <Group label="Tùy chọn">
              <Chip on={s.grow} title="Phóng các trang nhỏ cho đầy khung" onClick={() => update({ grow: !s.grow })}>Phóng trang nhỏ</Chip>
              {paged && <Chip on={s.rtl} title="Truyện Nhật đọc từ phải sang trái" onClick={() => update({ rtl: !s.rtl })}>Đọc phải → trái</Chip>}
            </Group>
            {s.mode === 'strip' && (
              <Group label="Độ rộng cột">
                {WIDTHS.map((w) => <Chip key={w} on={s.stripWidth === w} onClick={() => update({ stripWidth: w })}>{w}px</Chip>)}
              </Group>
            )}
            {!paged && (
              <Group label="Khoảng cách giữa trang">
                {GAPS.map((g) => <Chip key={g} on={s.gap === g} onClick={() => update({ gap: g })}>{g === 0 ? 'Liền' : `${g}px`}</Chip>)}
              </Group>
            )}
            <p className="text-[11px] text-gray-400">
              {paged ? 'Bấm/chạm nửa trái hoặc phải của trang, hoặc dùng phím ← → để lật.' : 'Cuộn để đọc. Ảnh luôn căn giữa.'}
            </p>
          </div>
        </div>
      )}

      {/* Pages */}
      {!paged ? (
        <div
          className={`mx-auto flex flex-col items-center ${s.fit === 'none' ? 'overflow-x-auto' : ''}`}
          style={{ maxWidth: s.mode === 'wide' ? '100%' : s.stripWidth, rowGap: s.gap }}
        >
          {pages.map((_, i) => renderPage(i, false, i < 3))}
        </div>
      ) : atEnd ? (
        <div className="flex flex-col items-center justify-center gap-4 text-center" style={{ minHeight: FIT_H }}>
          <p className="text-lg font-bold">Hết chương</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => go(-1)} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold">Xem lại trang cuối</button>
            {nextHref && (
              <Link href={nextHref} className="px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold">Chương tiếp →</Link>
            )}
          </div>
        </div>
      ) : (
        <div className="relative select-none" style={{ minHeight: s.fit === 'both' || s.fit === 'height' ? FIT_H : undefined }}>
          <div
            className={`flex items-center justify-center ${s.fit === 'none' ? 'overflow-x-auto' : ''} ${s.rtl ? 'flex-row-reverse' : ''}`}
            style={{ minHeight: s.fit === 'both' || s.fit === 'height' ? FIT_H : undefined }}
          >
            {views[view].map((i) => renderPage(i, views[view].length === 2, true))}
          </div>
          {/* tap zones */}
          <button type="button" aria-label={s.rtl ? 'Trang sau' : 'Trang trước'} onClick={goLeft} className="absolute inset-y-0 left-0 w-1/2 cursor-w-resize focus:outline-none" />
          <button type="button" aria-label={s.rtl ? 'Trang trước' : 'Trang sau'} onClick={goRight} className="absolute inset-y-0 right-0 w-1/2 cursor-e-resize focus:outline-none" />
          {view === 0 && prevHref && (
            <Link href={prevHref} className="absolute top-2 left-2 z-10 px-3 py-1.5 rounded-lg bg-black/60 text-snow text-xs font-semibold flex items-center gap-1">
              <ChevronLeft className="w-3.5 h-3.5" /> Chương trước
            </Link>
          )}
        </div>
      )}

      {/* Progress: one segment per view, click to jump (MangaDex's "normal progress") */}
      {paged && (
        <div className={`mt-3 flex gap-0.5 px-2 ${s.rtl ? 'flex-row-reverse' : ''}`}>
          {views.map((v, idx) => (
            <button
              key={idx}
              type="button"
              aria-label={`Tới trang ${v[0] + 1}`}
              onClick={() => setView(idx)}
              className={`h-1.5 flex-1 rounded-full transition ${idx <= view ? 'bg-brand-500' : 'bg-white/15 hover:bg-white/30'}`}
            />
          ))}
          {nextHref && (
            <button type="button" title="Hết chương" aria-label="Hết chương" onClick={() => setView(views.length)} className="h-1.5 w-6 rounded-full bg-white/10 hover:bg-white/30" />
          )}
        </div>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
        on ? 'bg-brand-600 border-brand-500 text-snow' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}

/** One page: shows a spinner while it loads, and an error with a retry button on that page when it fails. */
function PageImage({ page, local, eager, style }: { page: MangaPage; local: boolean; eager: boolean; style: React.CSSProperties }) {
  const [quality] = useImageQuality();
  const wanted = (local ? page.image_url : imageUrlForQuality(page.image_url, quality)) || page.image_url;
  const [src, setSrc] = useState(wanted);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setSrc(wanted);
    setState('loading');
  }, [wanted, attempt]);

  const known = Boolean(page.width && page.height);
  const ratio = known ? `${page.width} / ${page.height}` : '3 / 4';
  // a page of known size waits in a box of its real height (thin strip slices too), so nothing jumps when it arrives
  return (
    <div className="relative" style={state === 'ok' ? { display: 'contents' } : { width: '100%', aspectRatio: ratio, minHeight: known ? undefined : 240 }}>
      <img
        key={attempt}
        src={src}
        alt={`Trang ${page.page_number}`}
        width={page.width || undefined}
        height={page.height || undefined}
        loading={eager ? 'eager' : 'lazy'}
        draggable={false}
        className="select-none"
        style={state === 'ok' ? style : { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0 }}
        onLoad={() => setState('ok')}
        onError={() => {
          // a failed resized copy falls back to the original file once, then the page is marked as failed
          if (src !== page.image_url) setSrc(page.image_url);
          else setState('error');
        }}
      />
      {state === 'loading' && (
        <div className="absolute inset-0 grid place-items-center rounded bg-white/5 text-xs text-gray-400" role="status">
          <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải trang {page.page_number}...</span>
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 grid place-items-center rounded border border-rose-500/30 bg-rose-500/10 p-3 text-center" role="alert">
          <div className="space-y-2">
            <ImageOff className="mx-auto w-6 h-6 text-rose-300" />
            <p className="text-xs font-semibold text-rose-200">Trang {page.page_number} không tải được</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15">
              <RotateCw className="w-3.5 h-3.5" /> Thử lại
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
