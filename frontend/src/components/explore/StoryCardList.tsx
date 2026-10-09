'use client';

import React from 'react';
import Link from 'next/link';
import { Eye, BookOpen, Heart } from 'lucide-react';
import { Story, formatCount, formatTimeAgo } from './StoryCardGrid';
import SmartImage from '@/components/common/SmartImage';
import { stripHtml } from '@/lib/richText';

const STATUS_LABEL: Record<Story['status'], string> = {
  ongoing: 'Đang tiến hành',
  completed: 'Hoàn thành',
  hiatus: 'Tạm ngưng',
  dropped: 'Ngừng',
};

const STATUS_DOT: Record<Story['status'], string> = {
  ongoing: 'bg-emerald-400',
  completed: 'bg-sky-400',
  hiatus: 'bg-amber-400',
  dropped: 'bg-rose-400',
};

/**
 * Wide list card in the same style as the home banner: the story art fills the card and stays
 * sharp, a dark wash sits only behind the text, cover on the left. The whole card opens the story.
 */
export default function StoryCardList({ story }: { story: Story }) {
  const isNovel = story.story_type === 'novel';
  const backdrop = story.illustrations?.[0] || story.banner_image_url || story.cover_image_url;

  return (
    <Link
      href={`/truyen/${story.slug}`}
      title={story.title}
      className="group relative isolate block overflow-hidden rounded-[4px] bg-[#111] shadow-[0_10px_30px_-18px_rgba(10,40,90,0.55)] transition-shadow duration-500 hover:shadow-[0_22px_44px_-20px_rgba(22,114,214,0.55)]"
    >
      {/* Backdrop: sharp story art */}
      <SmartImage
        src={backdrop}
        alt=""
        aria-hidden
        className="absolute inset-0 -z-10 w-full h-full object-cover object-[50%_30%] transition-transform duration-[1200ms] ease-silk group-hover:scale-105"
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(68deg,rgba(0,0,0,0.74)_32%,rgba(0,0,0,0.14)_100%)]" />

      {/* Content always uses the dark palette: white text on the darkened art */}
      <div className="dark flex gap-4 sm:gap-5 p-3 sm:p-4 [text-shadow:0_1px_8px_rgba(0,0,0,0.45)]">
        <div className="relative w-[92px] sm:w-[128px] shrink-0 aspect-[2/3] overflow-hidden rounded-[3px] shadow-[0_14px_30px_-12px_rgba(0,0,0,0.7)]">
          <SmartImage src={story.cover_image_url} alt={story.title} className="w-full h-full object-cover transition-transform duration-700 ease-silk group-hover:scale-105" />
          <span className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-[2px] text-[9px] font-extrabold uppercase tracking-wider text-snow [text-shadow:none] ${
            isNovel ? 'bg-sky-600/90' : 'bg-rose-600/90'
          }`}>
            {isNovel ? 'Novel' : 'Manga'}
          </span>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 text-[11px] text-gray-300">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[story.status] || STATUS_DOT.ongoing}`} />
            <span>{STATUS_LABEL[story.status] || STATUS_LABEL.ongoing}</span>
            {story.original_language && <span className="uppercase text-gray-400">· {story.original_language}</span>}
            {story.last_chapter_at && <span className="ml-auto text-gray-400 hidden sm:inline">{formatTimeAgo(story.last_chapter_at)}</span>}
          </div>

          <h3 className="mt-1 text-base sm:text-2xl font-bold leading-tight tracking-tight text-white line-clamp-2 group-hover:text-brand-400 transition-colors">
            {story.title}
          </h3>

          {story.tags && story.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1 max-h-[21px] sm:max-h-[44px] overflow-hidden">
              {story.tags.slice(0, 8).map((tag) => (
                <span key={tag.id} className="px-1.5 py-[3px] rounded-[3px] bg-black/45 backdrop-blur-sm text-[10px] font-bold uppercase tracking-wide text-gray-200 [text-shadow:none]">
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          <p className="mt-2 hidden sm:block text-[13px] leading-relaxed text-gray-300 line-clamp-2 max-w-3xl">
            {stripHtml(story.synopsis) || 'Chưa có tóm tắt cho bộ truyện này.'}
          </p>

          <div className="mt-auto pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-300">
            <span className="italic font-medium text-white truncate max-w-[45%] pr-1">{story.author_name || 'Chưa rõ tác giả'}</span>
            <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{formatCount(story.total_views)}</span>
            <span className="hidden sm:flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{formatCount(story.total_favorites)}</span>
            <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />{story.total_chapters || 0} chương</span>
            {story.latest_chapter && (
              <span className="hidden md:inline ml-auto truncate max-w-[35%] text-brand-300">{story.latest_chapter.title}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
