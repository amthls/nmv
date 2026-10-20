'use client';

import React from 'react';
import Link from '@/components/common/Link';
import { Eye, BookOpen, PlayCircle } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';

export interface Story {
  id: string;
  title: string;
  slug: string;
  original_title?: string;
  synopsis?: string;
  cover_image_url?: string;
  banner_image_url?: string;
  story_type: 'novel' | 'manga';
  status: 'ongoing' | 'completed' | 'hiatus' | 'dropped';
  original_language?: string;
  author_name?: string;
  artist_name?: string;
  total_chapters: number;
  total_views: string | number;
  total_favorites: string | number;
  last_chapter_at?: string;
  created_at?: string;
  group_name?: string;
  tags?: { id: string; name: string; slug: string }[];
  illustrations?: string[];
  latest_chapter?: {
    title: string;
    chapter_number: number;
    slug: string;
    published_at: string;
  };
  /** recommendation rows: why this story is shown */
  rec_reason?: string;
  rec_label?: string;
  /** "continue reading" cards open this chapter directly */
  continue_slug?: string;
}

export function formatCount(value: Story['total_views']) {
  const n = typeof value === 'number' ? value : parseInt(value || '0', 10);
  if (!Number.isFinite(n)) return String(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString('vi-VN');
}

export function formatTimeAgo(dateStr?: string) {
  if (!dateStr) return 'Vừa xong';
  const diffMin = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay > 0) return `${diffDay} ngày trước`;
  if (diffHour > 0) return `${diffHour} giờ trước`;
  if (diffMin > 0) return `${diffMin} phút trước`;
  return 'Vừa xong';
}

export type CardMeta = 'stats' | 'updated' | 'views';

/**
 * Poster card: the cover is shown clean (no dark overlay), title and one line of
 * meta sit underneath on the page background. Clicking anywhere opens the story.
 */
export default function StoryCardGrid({ story, rank, meta = 'stats' }: { story: Story; rank?: number; meta?: CardMeta }) {
  const isNovel = story.story_type === 'novel';

  return (
    <Link
      href={story.continue_slug ? `/truyen/${story.slug}/${story.continue_slug}` : `/truyen/${story.slug}`}
      className="group block min-w-0 transition-transform duration-150 active:scale-[0.97] [@media(hover:hover)]:active:scale-100"
      title={story.title}
    >
      <div className="tile aspect-[2/3]">
        <SmartImage src={story.cover_image_url} alt={story.title} className="tile__img w-full h-full object-cover" />
        <span className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-[3px] text-xs sm:text-[9.5px] font-extrabold uppercase tracking-wider text-snow shadow ${
          isNovel ? 'bg-sky-600/90' : 'bg-rose-600/90'
        }`}>
          {isNovel ? 'Novel' : 'Manga'}
        </span>
        {story.continue_slug && (
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] bg-black/70 text-xs sm:text-[10px] font-bold text-white">
            <PlayCircle className="w-3 h-3" /> Đọc tiếp
          </span>
        )}
        {rank !== undefined && (
          <span className="absolute bottom-0 left-0 min-w-[30px] px-2 py-1 bg-brand-500 text-snow text-sm font-black text-center rounded-tr-[4px]">
            {rank}
          </span>
        )}
      </div>

      <h3 className="mt-2 min-h-[2.75em] text-sm sm:text-[13px] font-semibold leading-snug text-white line-clamp-2 group-hover:text-brand-500 transition-colors">
        {story.title}
      </h3>

      <div className="mt-1 h-4 flex items-center gap-2 text-xs sm:text-[11px] leading-4 text-gray-400 min-w-0">
        {meta === 'updated' ? (
          <>
            <span className="truncate">{story.latest_chapter?.title || 'Đang cập nhật'}</span>
            <span className="ml-auto shrink-0">{formatTimeAgo(story.last_chapter_at || story.created_at)}</span>
          </>
        ) : meta === 'views' ? (
          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatCount(story.total_views)} lượt xem</span>
        ) : (
          <>
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatCount(story.total_views)}</span>
            <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" />{story.total_chapters || 0}</span>
          </>
        )}
      </div>
    </Link>
  );
}
