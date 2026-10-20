'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { useReadingSession, ReadingSession } from '@/context/ReadingSessionContext';
import MiniplayerReaderView from './MiniplayerReaderView';
import { useMiniplayerEnabled } from '@/lib/miniplayerPref';

interface Size {
  width: number;
  height: number;
}

interface Preset {
  name: string;
  label: string;
  size: Size;
}

// Snap targets for the resize handle, Windows-Snap-Assist style: dragging near one
// of these previews a dashed outline at its exact bounds, and releasing snaps to it
// instead of leaving the box at an arbitrary dragged size.
const PRESETS: Preset[] = [
  { name: 'compact', label: 'Gọn', size: { width: 260, height: 64 } },
  { name: 'card', label: 'Thẻ', size: { width: 320, height: 100 } },
  { name: 'readerS', label: 'Đọc vừa', size: { width: 360, height: 420 } },
  { name: 'readerL', label: 'Đọc lớn', size: { width: 480, height: 640 } },
];
const DEFAULT_PRESET = PRESETS[1]; // 'card'

const MIN_WIDTH = 220;
const MIN_HEIGHT = 56;
// stays above the mobile bottom nav (var is 0 from lg)
const MINI_BOTTOM = 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 24px)';
const STORAGE_KEY = 'novelhub_miniplayer_preset';

// Height thresholds that decide which of the 3 tiers is shown - crossing one while
// dragging switches content immediately, no separate "enter reading mode" action.
function tierForHeight(height: number): 'compact' | 'card' | 'reader' {
  if (height < 80) return 'compact';
  if (height < 200) return 'card';
  return 'reader';
}

function clampToViewport(size: Size): Size {
  if (typeof window === 'undefined') return size;
  const maxW = Math.max(MIN_WIDTH, window.innerWidth - 24);
  const maxH = Math.max(MIN_HEIGHT, window.innerHeight - (window.innerWidth < 1024 ? 140 : 24));
  return { width: Math.min(size.width, maxW), height: Math.min(size.height, maxH) };
}

function nearestPreset(size: Size): Preset {
  let best = DEFAULT_PRESET;
  let bestDist = Infinity;
  for (const preset of PRESETS) {
    const target = clampToViewport(preset.size);
    const dist = Math.abs(target.width - size.width) + Math.abs(target.height - size.height);
    if (dist < bestDist) {
      bestDist = dist;
      best = preset;
    }
  }
  return best;
}

function presetByName(name: string): Preset {
  return PRESETS.find((p) => p.name === name) || DEFAULT_PRESET;
}

function loadStoredPreset(): Preset {
  if (typeof window === 'undefined') return DEFAULT_PRESET;
  try {
    const name = localStorage.getItem(STORAGE_KEY);
    if (name) return presetByName(name);
  } catch {
    // ignore
  }
  return DEFAULT_PRESET;
}

/**
 * A persistent "continue reading" widget, in the spirit of YouTube's miniplayer:
 * shows up once you navigate away from a chapter you haven't finished, follows you
 * across the site, and can be dragged from its top-left corner to resize. Size
 * decides the tier shown: a bare progress bar, a preview card, or (dragged big
 * enough) an actual scrollable chapter reader.
 */
export default function ContinueReadingMiniplayer() {
  const { session, isDismissed, dismiss } = useReadingSession();
  const pathname = usePathname();
  const router = useRouter();
  const [enabled, setEnabled] = useMiniplayerEnabled();
  const [menu, setMenu] = useState(false);

  const [size, setSize] = useState<Size>(() => clampToViewport(DEFAULT_PRESET.size));
  const [ghostPreset, setGhostPreset] = useState<Preset | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  useEffect(() => {
    setSize(clampToViewport(loadStoredPreset().size));
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, startW: size.width, startH: size.height };
    },
    [size]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    // Handle sits at the top-left corner while the widget stays anchored bottom-right,
    // so dragging left/up (negative delta) is what *grows* the box.
    const dx = dragRef.current.startX - e.clientX;
    const dy = dragRef.current.startY - e.clientY;
    const live = clampToViewport({
      width: Math.max(MIN_WIDTH, dragRef.current.startW + dx),
      height: Math.max(MIN_HEIGHT, dragRef.current.startH + dy),
    });
    setSize(live);
    setGhostPreset(nearestPreset(live));
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setSize((current) => {
      const target = nearestPreset(current);
      try {
        localStorage.setItem(STORAGE_KEY, target.name);
      } catch {
        // ignore
      }
      return clampToViewport(target.size);
    });
    setGhostPreset(null);
  }, []);

  if (!enabled || !session || isDismissed) return null;

  const chapterHref = `/truyen/${session.storySlug}/${session.chapterSlug}`;
  if (pathname === chapterHref) return null; // already reading this exact chapter, no bubble needed

  const tier = tierForHeight(size.height);

  const goToChapter = (slug?: string | null) => {
    if (slug) router.push(`/truyen/${session.storySlug}/${slug}`);
  };

  return (
    <>
      {ghostPreset && (
        <div
          className="fixed right-6 z-30 rounded-2xl border-2 border-dashed border-brand-400/60 bg-brand-400/10 flex items-end justify-center pb-2 pointer-events-none"
          style={{ width: ghostPreset.size.width, height: ghostPreset.size.height, bottom: MINI_BOTTOM }}
        >
          <span className="text-[10px] font-bold text-brand-200 bg-black/60 px-2 py-0.5 rounded-full">
            {ghostPreset.label}
          </span>
        </div>
      )}

      <div
        className="fixed right-6 z-40 rounded-2xl bg-zinc-900/95 border border-white/15 shadow-2xl shadow-black/60 backdrop-blur-md overflow-hidden select-none"
        style={{ width: size.width, height: size.height, bottom: MINI_BOTTOM }}
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="absolute top-0 left-0 w-6 h-6 z-20 flex items-start justify-start p-1.5 text-white/25 hover:text-white/70 transition cursor-nwse-resize"
          style={{ touchAction: 'none' }}
          title="Kéo để đổi kích thước"
        >
          <div className="w-2.5 h-2.5 border-l-2 border-t-2 border-current" />
        </div>

        {tier === 'compact' && (
          <CompactBar
            session={session}
            onOpen={() => router.push(chapterHref)}
            onDismiss={dismiss}
            onPrev={() => goToChapter(session.prevChapterSlug)}
            onNext={() => goToChapter(session.nextChapterSlug)}
          />
        )}
        {tier === 'card' && (
          <CardView
            session={session}
            onOpen={() => router.push(chapterHref)}
            onDismiss={dismiss}
            onPrev={() => goToChapter(session.prevChapterSlug)}
            onNext={() => goToChapter(session.nextChapterSlug)}
          />
        )}
        {tier === 'reader' && <MiniplayerReaderView session={session} />}
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-expanded={menu}
          className="absolute bottom-1 right-1 z-20 w-5 h-5 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition"
          title="Tùy chọn popup"
        >
          <Settings2 className="w-3 h-3" />
        </button>
      </div>
      {menu && (
        <div
          className="fixed right-6 z-40 w-56 rounded-xl border border-white/15 bg-zinc-900/95 p-3 shadow-2xl backdrop-blur-md"
          style={{ bottom: `calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + ${size.height + 36}px)` }}
        >
          <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-semibold text-white">
            Hiện popup đọc tiếp
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              onChange={(e) => { setEnabled(e.target.checked); setMenu(false); }}
              className="h-4 w-8 cursor-pointer accent-brand-500"
            />
          </label>
          <p className="mt-2 text-[10.5px] text-gray-400">Bật lại bất cứ lúc nào ở Tài khoản → Cài đặt đọc truyện.</p>
        </div>
      )}
    </>
  );
}

function CompactBar({
  session,
  onOpen,
  onDismiss,
  onPrev,
  onNext,
}: {
  session: ReadingSession;
  onOpen: () => void;
  onDismiss: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="w-full h-full flex items-center gap-1 pl-7 pr-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        disabled={!session.prevChapterSlug}
        className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent transition"
        title="Chương trước"
      >
        <ChevronLeft className="w-3 h-3" />
      </button>

      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        className="min-w-0 flex-1 flex flex-col justify-center gap-1.5 cursor-pointer"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-white truncate">{session.storyTitle}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-bold text-brand-300">{session.scrollPercent}%</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              className="w-4 h-4 flex items-center justify-center text-white/40 hover:text-white transition"
              title="Đóng"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-brand-500 transition-[width]" style={{ width: `${session.scrollPercent}%` }} />
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        disabled={!session.nextChapterSlug}
        className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent transition"
        title="Chương tiếp"
      >
        <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  );
}

function CardView({
  session,
  onOpen,
  onDismiss,
  onPrev,
  onNext,
}: {
  session: ReadingSession;
  onOpen: () => void;
  onDismiss: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen} className="w-full h-full cursor-pointer">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition"
        title="Đóng"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-center gap-3 w-full h-full pt-2 pr-7 pl-3 pb-7">
        <SmartImage
          src={session.storyCover}
          alt={session.storyTitle}
          className="w-12 h-16 rounded-lg object-cover shrink-0 border border-white/10"
        />
        <div className="min-w-0 flex-1 flex flex-col justify-center gap-1.5">
          <p className="text-xs font-bold text-white truncate">{session.storyTitle}</p>
          <p className="text-[11px] text-gray-400 truncate">
            Chương {session.chapterNumber}: {session.chapterTitle}
          </p>
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-brand-500 transition-[width]"
              style={{ width: `${session.scrollPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="absolute bottom-1.5 left-3 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onPrev}
          disabled={!session.prevChapterSlug}
          className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent transition"
          title="Chương trước"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onNext}
          disabled={!session.nextChapterSlug}
          className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent transition"
          title="Chương tiếp"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
