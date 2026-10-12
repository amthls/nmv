'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from '@/components/common/Link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import StoryCardGrid, { CardMeta, Story } from '@/components/explore/StoryCardGrid';

/** One horizontal row of poster cards with scroll buttons. */
export default function StoryRail({ title, subtitle, href, stories, meta, ranked = false, onItemClick }: {
  title: string;
  subtitle?: string;
  href?: string;
  stories: Story[];
  meta: CardMeta;
  ranked?: boolean;
  onItemClick?: (story: Story) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const updateEdges = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    updateEdges();
    window.addEventListener('resize', updateEdges);
    return () => window.removeEventListener('resize', updateEdges);
  }, [updateEdges, stories]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  if (stories.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-white">
          {href ? (
            <Link href={href} className="group inline-flex items-center gap-1 hover:text-brand-500 transition-colors">
              {title}
              <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : title}
          {subtitle && <span className="block text-xs font-normal text-gray-400 mt-0.5">{subtitle}</span>}
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            disabled={edge.start}
            aria-label={`Cuộn ${title} sang trái`}
            className="w-8 h-8 grid place-items-center rounded-full bg-white/5 hover:bg-white/10 text-gray-300 disabled:opacity-30 disabled:cursor-default transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            disabled={edge.end}
            aria-label={`Cuộn ${title} sang phải`}
            className="w-8 h-8 grid place-items-center rounded-full bg-white/5 hover:bg-white/10 text-gray-300 disabled:opacity-30 disabled:cursor-default transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={updateEdges}
        className="scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2"
      >
        {stories.map((story, idx) => (
          <div key={story.id} className="snap-start shrink-0 w-[132px] sm:w-[156px] lg:w-[172px]" onClickCapture={onItemClick ? () => onItemClick(story) : undefined}>
            <StoryCardGrid story={story} meta={meta} rank={ranked ? idx + 1 : undefined} />
          </div>
        ))}
      </div>
    </section>
  );
}
