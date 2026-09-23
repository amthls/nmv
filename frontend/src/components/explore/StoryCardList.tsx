'use client';

import React from 'react';
import Link from 'next/link';
import { Star, Eye, BookOpen, Heart, User, ShieldCheck } from 'lucide-react';
import { Story } from './StoryCardGrid';
import SmartImage from '@/components/common/SmartImage';
import { stripHtml } from '@/lib/richText';

export default function StoryCardList({ story }: { story: Story }) {
  const isNovel = story.story_type === 'novel';
  const rating = typeof story.rating_avg === 'number' ? story.rating_avg.toFixed(1) : parseFloat(story.rating_avg || '0').toFixed(1);

  const statusLabel = {
    ongoing: 'Đang tiến hành',
    completed: 'Đã hoàn thành',
    hiatus: 'Tạm ngưng',
    dropped: 'Ngừng',
  }[story.status] || 'Đang tiến hành';

  const statusColor = {
    ongoing: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    completed: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    hiatus: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    dropped: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  }[story.status];

  return (
    <div className="group relative flex flex-col sm:flex-row gap-4 p-4 rounded-2xl glass-panel border border-white/10 hover:border-brand-500/30 transition-all duration-300">
      {/* Thumbnail */}
      <Link href={`/truyen/${story.slug}`} className="sm:w-36 h-48 sm:h-auto shrink-0 relative overflow-hidden rounded-xl bg-gray-900 block">
        <SmartImage
          src={story.cover_image_url}
          alt={story.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <span className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase backdrop-blur-md ${
          isNovel ? 'bg-indigo-600/90' : 'bg-rose-600/90'
        }`}>
          {isNovel ? 'Novel' : 'Manga'}
        </span>
      </Link>

      {/* Details */}
      <div className="flex-1 flex flex-col justify-between gap-3">
        <div className="space-y-2">
          {/* Header Info */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${statusColor}`}>
                {statusLabel}
              </span>
              {story.original_language && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 uppercase">
                  {story.original_language}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-400 font-medium">
              <span className="flex items-center gap-1 text-amber-300">
                <Star className="w-3.5 h-3.5 fill-amber-300" />
                {rating} ({story.rating_count || 0})
              </span>
              <span className="flex items-center gap-1">
                <Eye className="w-3.5 h-3.5 text-cyan-400" />
                {typeof story.total_views === 'number' ? story.total_views.toLocaleString() : story.total_views}
              </span>
              <span className="flex items-center gap-1">
                <Heart className="w-3.5 h-3.5 text-rose-400" />
                {typeof story.total_favorites === 'number' ? story.total_favorites.toLocaleString() : story.total_favorites}
              </span>
            </div>
          </div>

          {/* Title */}
          <Link href={`/truyen/${story.slug}`}>
            <h3 className="text-base font-bold text-white group-hover:text-brand-400 transition-colors line-clamp-1">
              {story.title}
            </h3>
          </Link>

          {/* Meta Line */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <User className="w-3 h-3 text-gray-500" />
              {story.author_name || 'Chưa rõ tác giả'}
            </span>
            {story.group_name && (
              <span className="flex items-center gap-1 text-brand-300">
                <ShieldCheck className="w-3 h-3 text-brand-400" />
                {story.group_name}
              </span>
            )}
            <span className="flex items-center gap-1">
              <BookOpen className="w-3 h-3 text-gray-500" />
              {story.total_chapters || 0} chương
            </span>
          </div>

          {/* Synopsis */}
          <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
            {stripHtml(story.synopsis) || 'Chưa có tóm tắt cho bộ truyện này.'}
          </p>

          {/* Tags */}
          {story.tags && story.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {story.tags.map((tag) => (
                <span key={tag.id} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 border border-white/5 transition">
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Latest chapter bar */}
        <div className="pt-2.5 border-t border-white/5 flex items-center justify-between text-xs">
          {story.latest_chapter ? (
            <div className="flex items-center gap-2 text-gray-300 truncate">
              <span className="text-[11px] text-brand-400 font-semibold shrink-0">Chương mới nhất:</span>
              <Link 
                href={`/truyen/${story.slug}/${story.latest_chapter.slug}`}
                className="truncate hover:text-brand-400 transition font-medium"
              >
                {story.latest_chapter.title}
              </Link>
            </div>
          ) : (
            <span className="text-gray-500 italic text-[11px]">Đang cập nhật chương mới...</span>
          )}

          <Link
            href={`/truyen/${story.slug}`}
            className="px-3 py-1 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium text-xs shrink-0 transition"
          >
            Đọc truyện
          </Link>
        </div>
      </div>
    </div>
  );
}
