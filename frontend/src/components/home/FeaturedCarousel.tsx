'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/components/common/Link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { Story } from '@/components/explore/StoryCardGrid';
import { stripHtml } from '@/lib/richText';

const SLIDE_MS = 6500;

export interface GalleryImage {
  story_slug: string;
  image_url: string;
}

/** Any illustration of this story; falls back to its banner, then to its own cover. */
function pickArtwork(story: Story, gallery: GalleryImage[]) {
  const pool = [
    ...(story.illustrations || []),
    ...gallery.filter((g) => g.story_slug === story.slug).map((g) => g.image_url),
    story.banner_image_url,
  ].filter(Boolean) as string[];
  if (pool.length === 0) return { url: story.cover_image_url, isCover: true };
  return { url: pool[Math.floor(Math.random() * pool.length)], isCover: false };
}

type Nav = { active: number; leaving: number | null; dir: 1 | -1 };

/**
 * "Featured this week" banner card, aligned with the rows below so the page wallpaper shows around it:
 * story art fills the card,
 * cover on the left, title / tags / description / author on the right. The whole slide is one link.
 * Slides turn in 3D; autoplay, ← / → keys, arrow buttons and swipe all navigate.
 */
export default function FeaturedCarousel({ stories, gallery = [] }: { stories: Story[]; gallery?: GalleryImage[] }) {
  const slides = stories.slice(0, 6);
  const count = slides.length;
  const artwork = useMemo(() => slides.map((s) => pickArtwork(s, gallery)), [stories, gallery]); // eslint-disable-line react-hooks/exhaustive-deps

  const [nav, setNav] = useState<Nav>({ active: 0, leaving: null, dir: 1 });
  const [paused, setPaused] = useState(false);
  const navRef = useRef(nav);
  navRef.current = nav;
  const raf = useRef(0);

  // Two phases so the incoming slide always enters from the correct side:
  // 1) park every inactive slide on the side it will come from (no transition),
  // 2) next frame, swap active/leaving so both animate.
  const go = useCallback(
    (target: number, dir: 1 | -1) => {
      if (count < 2) return;
      const next = ((target % count) + count) % count;
      const current = navRef.current.active;
      if (next === current) return;
      cancelAnimationFrame(raf.current);
      setNav({ active: current, leaving: null, dir });
      raf.current = requestAnimationFrame(() => {
        raf.current = requestAnimationFrame(() => setNav({ active: next, leaving: current, dir }));
      });
    },
    [count],
  );
  const next = useCallback(() => go(navRef.current.active + 1, 1), [go]);
  const prev = useCallback(() => go(navRef.current.active - 1, -1), [go]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Keyboard: ← / → anywhere on the page, unless the user is typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev]);

  // Touch swipe (a swipe must not also count as a tap on the slide link)
  const swipeX = useRef<number | null>(null);
  const swiped = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    swiped.current = false;
    if (e.pointerType !== 'mouse') swipeX.current = e.clientX;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (swipeX.current === null) return;
    const dx = e.clientX - swipeX.current;
    swipeX.current = null;
    if (Math.abs(dx) > 50) {
      swiped.current = true;
      (dx < 0 ? next : prev)();
    }
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; }
  };

  if (count === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Truyện nổi bật tuần"
      className={`max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 ${paused ? 'hero-paused' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClickCapture={onClickCapture}
    >
      <h2 className="text-lg sm:text-xl font-semibold leading-snug tracking-tight text-white">Truyện nổi bật tuần</h2>

      <div className="relative isolate mt-3 overflow-hidden rounded-xl border border-white/10 bg-surface-3 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.8)]">
      {/* Story art fills the card */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        {slides.map((s, i) => (
          <SmartImage
            key={s.id}
            src={artwork[i].url}
            alt=""
            aria-hidden
            className={`absolute inset-0 w-full h-full object-cover object-[50%_25%] transition-opacity duration-[1200ms] ease-silk ${
              i === nav.active ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ))}
        {/* the image stays clear: a dark wash only behind the text */}
        <div className="absolute inset-0 bg-[linear-gradient(68deg,rgba(0,0,0,0.7)_30%,rgba(0,0,0,0.15)_100%)]" />
        {/* thin top highlight, like the glass panels */}
        <div className="absolute inset-0 rounded-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]" />
      </div>

      {/* banner content always uses the dark palette (white text on the darkened image) */}
      <div className="dark p-4 sm:p-6">
        <div className="hero-stage relative h-[180px] sm:h-[260px] lg:h-[300px]">
          {slides.map((story, i) => {
            const state =
              i === nav.active
                ? 'is-active'
                : i === nav.leaving
                  ? nav.dir > 0 ? 'is-left' : 'is-right'
                  : `${nav.dir > 0 ? 'is-right' : 'is-left'} is-parked`;
            return (
              <Link
                key={story.id}
                href={`/truyen/${story.slug}`}
                tabIndex={i === nav.active ? 0 : -1}
                aria-hidden={i !== nav.active}
                aria-label={`${story.title} — ${i + 1} / ${count}`}
                className={`hero-slide group flex gap-4 sm:gap-6 [text-shadow:0_1px_8px_rgba(0,0,0,0.45)] ${state}`}
              >
                {/* Cover */}
                <div className="hero-layer-near h-full aspect-[2/3] shrink-0 overflow-hidden rounded-[4px] bg-surface-3 shadow-[0_18px_40px_-16px_rgba(10,40,90,0.45)]">
                  <SmartImage src={story.cover_image_url} alt={story.title} loading="eager" className="w-full h-full object-cover transition-transform duration-700 ease-silk group-hover:scale-105" />
                </div>

                {/* Title, tags, description, author */}
                <div className="flex-1 min-w-0 h-full flex flex-col pr-0 sm:pr-4">
                  <h3 className="rise rise-1 text-base sm:text-2xl lg:text-[1.75rem] font-semibold leading-snug tracking-tight text-white line-clamp-2 group-hover:text-brand-500 transition-colors">
                    {story.title}
                  </h3>

                  {story.tags && story.tags.length > 0 && (
                    <div className="rise rise-2 mt-2 sm:mt-3 flex flex-wrap gap-1 max-h-[26px] sm:max-h-none overflow-hidden">
                      {story.tags.slice(0, 6).map((t) => (
                        <span key={t.id} className="px-1.5 py-[3px] rounded-[3px] bg-black/45 backdrop-blur-sm [text-shadow:none] text-xs sm:text-[10px] font-bold uppercase tracking-wide text-gray-200">
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="rise rise-3 mt-3 hidden sm:block text-sm leading-relaxed text-gray-300 line-clamp-4 lg:line-clamp-5 max-w-4xl">
                    {stripHtml(story.synopsis)}
                  </p>

                  <p className="rise rise-4 mt-auto pr-0 [@media(hover:hover)]:pr-32 sm:pr-44 text-sm sm:text-base font-medium italic text-white truncate">
                    {story.author_name || 'Chưa rõ tác giả'}
                  </p>
                </div>
              </Link>
            );
          })}

          {/* Arrows, bottom-right like MangaDex. The hidden bar is the autoplay timer. */}
          <div className="absolute bottom-0 right-0 z-10 flex items-center gap-1 sm:gap-2">
            <button type="button" onClick={prev} aria-label="Truyện trước (phím ←)" className="w-11 h-11 sm:w-10 sm:h-10 grid place-items-center rounded-full text-white hover:bg-white/10 transition active:scale-95 [@media(hover:none)]:hidden">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button type="button" onClick={next} aria-label="Truyện tiếp theo (phím →)" className="w-11 h-11 sm:w-10 sm:h-10 grid place-items-center rounded-full text-white hover:bg-white/10 transition active:scale-95 [@media(hover:none)]:hidden">
              <ChevronRight className="w-6 h-6" />
            </button>
            <span
              key={`${nav.active}-${nav.leaving}`}
              aria-hidden
              className="hero-progress absolute left-0 right-0 -bottom-2 h-px opacity-0"
              style={{ animationDuration: `${SLIDE_MS}ms` }}
              onAnimationEnd={next}
            />
          </div>
        </div>
      </div>
      </div>

      <p className="sr-only" aria-live="polite">Đang hiển thị: {slides[nav.active].title}</p>
    </section>
  );
}
