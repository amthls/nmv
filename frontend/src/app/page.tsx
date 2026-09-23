'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Flame, 
  Sparkles, 
  Clock, 
  BookOpen, 
  Eye, 
  Star, 
  ChevronRight, 
  Heart,
  Image as ImageIcon,
  ShieldCheck,
  TrendingUp,
  Compass,
  Layers
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import StoryCardGrid, { Story } from '@/components/explore/StoryCardGrid';
import { stripHtml } from '@/lib/richText';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function HomePage() {
  const [trendingStories, setTrendingStories] = useState<Story[]>([]);
  const [recentlyUpdated, setRecentlyUpdated] = useState<any[]>([]);
  const [featuredIllustrations, setFeaturedIllustrations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch Home Page Data
  useEffect(() => {
    async function fetchHomeData() {
      setIsLoading(true);
      try {
        const [trendingRes, recentRes, illustRes] = await Promise.all([
          fetch(`${API_BASE_URL}/stories/trending`),
          fetch(`${API_BASE_URL}/stories/recently-updated`),
          fetch(`${API_BASE_URL}/stories/illustrations`),
        ]);

        if (trendingRes.ok) {
          const json = await trendingRes.json();
          if (json.success) setTrendingStories(json.data || []);
        }

        if (recentRes.ok) {
          const json = await recentRes.json();
          if (json.success) setRecentlyUpdated(json.data || []);
        }

        if (illustRes.ok) {
          const json = await illustRes.json();
          if (json.success) setFeaturedIllustrations(json.data || []);
        }
      } catch (err) {
        console.error('Failed to load home page data:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchHomeData();
  }, []);

  const heroStory = trendingStories[0];

  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return 'Vừa xong';
    const diffMs = new Date().getTime() - new Date(dateStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay} ngày trước`;
    if (diffHour > 0) return `${diffHour} giờ trước`;
    if (diffMin > 0) return `${diffMin} phút trước`;
    return 'Vừa xong';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-12 pb-24">
      
      {/* 1. HERO SPOTLIGHT BANNER WITH COVER & ILLUSTRATION GALLERY */}
      {heroStory && (
        <section className="relative rounded-3xl overflow-hidden glass-panel border border-white/15 p-6 sm:p-8 md:p-10 shadow-2xl bg-gradient-to-br from-[#18182c]/90 via-[#10101c]/95 to-[#090912]">
          
          {/* Background Ambient Blur */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20 filter blur-3xl scale-125">
            <SmartImage
              src={heroStory.cover_image_url}
              alt="Hero blur background"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="relative flex flex-col lg:flex-row gap-8 items-center lg:items-start justify-between">
            
            {/* Left Cover Poster */}
            <Link 
              href={`/truyen/${heroStory.slug}`}
              className="w-48 sm:w-56 shrink-0 aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl ring-2 ring-brand-500/40 group relative block"
            >
              <SmartImage
                src={heroStory.cover_image_url}
                alt={heroStory.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <span className="absolute top-3 left-3 px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wider text-white bg-indigo-600/90 backdrop-blur-md shadow-md">
                {heroStory.story_type === 'novel' ? 'Light Novel' : 'Manga'}
              </span>
              <span className="absolute bottom-3 left-3 right-3 py-1 px-2 rounded-lg bg-black/70 backdrop-blur-sm text-[11px] text-amber-300 font-bold flex items-center justify-center gap-1">
                <Star className="w-3.5 h-3.5 fill-amber-300" />
                {heroStory.rating_avg} ({heroStory.rating_count || 0} vote)
              </span>
            </Link>

            {/* Middle Info & Synopsis */}
            <div className="flex-1 space-y-4 text-center lg:text-left">
              
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-brand-500/20 text-brand-300 border border-brand-500/30 flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-brand-400" /> Truyện Nổi Bật Tuần
                </span>
                <span className="text-xs text-gray-400">
                  {heroStory.author_name || 'Chưa rõ tác giả'}
                </span>
                {heroStory.group_name && (
                  <span className="text-xs text-brand-400 font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {heroStory.group_name}
                  </span>
                )}
              </div>

              <Link href={`/truyen/${heroStory.slug}`}>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-wide hover:text-brand-400 transition-colors leading-tight">
                  {heroStory.title}
                </h1>
              </Link>

              <p className="text-xs sm:text-sm text-gray-300 line-clamp-3 leading-relaxed max-w-3xl">
                {stripHtml(heroStory.synopsis)}
              </p>

              {/* Tag Pills */}
              {heroStory.tags && (
                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-1.5 pt-1">
                  {heroStory.tags.slice(0, 5).map((t) => (
                    <span key={t.id} className="text-[11px] px-2.5 py-0.5 rounded-lg bg-white/5 text-gray-300 border border-white/10">
                      {t.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3 pt-2">
                <Link
                  href={`/truyen/${heroStory.slug}`}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-brand-500/25 flex items-center gap-2 transition hover:scale-105"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Đọc Ngay</span>
                </Link>

                <Link
                  href={`/truyen/${heroStory.slug}/chuong-1-minh-hoa`}
                  className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-xs border border-white/15 flex items-center gap-2 transition"
                >
                  <ImageIcon className="w-4 h-4 text-cyan-400" />
                  <span>Xem 21 Ảnh Minh Họa</span>
                </Link>
              </div>

            </div>

            {/* Right Mini Illustration Showcase Carousel */}
            {heroStory.illustrations && heroStory.illustrations.length > 0 && (
              <div className="hidden xl:flex flex-col gap-2 p-3 rounded-2xl bg-black/40 border border-white/10 shrink-0 w-44">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <ImageIcon className="w-3 h-3 text-cyan-400" /> Ảnh Minh Họa
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {heroStory.illustrations.slice(0, 4).map((imgUrl: string, idx: number) => (
                    <Link 
                      key={idx}
                      href={`/truyen/${heroStory.slug}/chuong-1-minh-hoa`}
                      className="aspect-[3/4] rounded-lg overflow-hidden border border-white/10 hover:border-brand-500 transition group/img block bg-gray-900"
                    >
                      <SmartImage
                        src={imgUrl}
                        alt="Mini illustration"
                        className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-300"
                      />
                    </Link>
                  ))}
                </div>
                <Link 
                  href={`/truyen/${heroStory.slug}/chuong-1-minh-hoa`}
                  className="text-[10px] text-center text-brand-300 hover:underline pt-1 font-semibold"
                >
                  Xem toàn bộ ({heroStory.illustrations.length}+ ảnh) →
                </Link>
              </div>
            )}

          </div>

        </section>
      )}

      {/* 2. MỚI CẬP NHẬT (RECENTLY UPDATED) - MỖI TRUYỆN ĐỀU CÓ ẢNH BÌA POSTER SẮC NÉT */}
      <section className="space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-white tracking-wide flex items-center gap-2">
                <span>Truyện Mới Cập Nhật</span>
                <span className="text-xs font-normal text-gray-400">({recentlyUpdated.length} bộ)</span>
              </h2>
            </div>
          </div>

          <Link 
            href="/kham-pha?sort=updated" 
            className="text-xs font-semibold text-brand-400 hover:text-brand-300 flex items-center gap-1 transition"
          >
            <span>Xem tất cả</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Recently Updated Grid with Cover Posters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {recentlyUpdated.map((story) => (
            <div 
              key={story.id} 
              className="flex gap-3.5 p-3 rounded-2xl glass-panel border border-white/10 hover:border-brand-500/40 transition-all duration-300 group hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-500/10"
            >
              {/* Thumbnail Cover Image */}
              <Link 
                href={`/truyen/${story.slug}`}
                className="w-20 h-28 shrink-0 rounded-xl overflow-hidden bg-gray-900 relative shadow-md group-hover:ring-1 group-hover:ring-brand-500/50 transition block"
              >
                <SmartImage
                  src={story.cover_image_url}
                  alt={story.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <span className={`absolute top-1 left-1 px-1.5 py-0.2 rounded text-[9px] font-bold text-white uppercase backdrop-blur-md ${
                  story.story_type === 'novel' ? 'bg-indigo-600/90' : 'bg-rose-600/90'
                }`}>
                  {story.story_type === 'novel' ? 'Novel' : 'Manga'}
                </span>
              </Link>

              {/* Story & Chapter Info */}
              <div className="flex-1 flex flex-col justify-between py-0.5 min-w-0">
                <div className="space-y-1">
                  <Link href={`/truyen/${story.slug}`}>
                    <h3 className="text-xs font-bold text-white group-hover:text-brand-400 transition-colors line-clamp-2 leading-snug" title={story.title}>
                      {story.title}
                    </h3>
                  </Link>
                  
                  <div className="text-[11px] text-gray-400 truncate">
                    {story.author_name || 'Chưa rõ tác giả'}
                  </div>
                </div>

                {/* Latest chapter bar */}
                <div className="pt-2 border-t border-white/5 space-y-1">
                  {story.latest_chapter ? (
                    <Link 
                      href={`/truyen/${story.slug}/${story.latest_chapter.slug}`}
                      className="text-[11px] text-brand-300 hover:text-brand-200 font-semibold truncate block"
                      title={story.latest_chapter.title}
                    >
                      {story.latest_chapter.title}
                    </Link>
                  ) : (
                    <span className="text-[11px] text-gray-500 italic">Đang cập nhật...</span>
                  )}

                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <span className="truncate">{story.group_name || 'Độc lập'}</span>
                    <span className="shrink-0">{formatTimeAgo(story.last_chapter_at || story.created_at)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. TRIỂN LÃM ẢNH MINH HỌA LIGHT NOVEL NỔI BẬT (FEATURED ILLUSTRATIONS GALLERY) */}
      {featuredIllustrations.length > 0 && (
        <section className="space-y-4 p-6 rounded-3xl glass-panel border border-cyan-500/20 bg-gradient-to-r from-cyan-950/20 via-black/40 to-transparent">
          
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                <ImageIcon className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-white tracking-wide">
                  Triển Lãm Ảnh Minh Họa Light Novel Mới
                </h2>
                <p className="text-[11px] text-gray-400">
                  Hình ảnh minh họa màu chất lượng cao trích xuất trực tiếp từ các tập truyện
                </p>
              </div>
            </div>

            <Link
              href="/truyen/vi-da-tro-thanh-ke-thu-cua-oshi/chuong-1-minh-hoa"
              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition"
            >
              <span>Xem bộ sưu tập</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Horizontal Gallery Scroll */}
          <div className="flex gap-4 overflow-x-auto pb-3 pt-2 scrollbar-thin">
            {featuredIllustrations.slice(0, 10).map((illust, idx) => (
              <Link
                key={idx}
                href={`/truyen/${illust.story_slug}/${illust.chapter_slug}`}
                className="shrink-0 w-36 sm:w-44 group relative rounded-2xl overflow-hidden border border-white/10 hover:border-cyan-400/50 transition-all duration-300 hover:-translate-y-1 shadow-lg bg-gray-950"
              >
                <div className="aspect-[3/4] w-full overflow-hidden">
                  <SmartImage
                    src={illust.image_url}
                    alt={illust.chapter_title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-90 group-hover:opacity-100 transition-opacity p-2.5 flex flex-col justify-end">
                  <span className="text-[9px] font-bold text-cyan-300 uppercase tracking-wider truncate">
                    {illust.story_title}
                  </span>
                  <span className="text-[11px] font-bold text-white truncate">
                    {illust.chapter_title} #{illust.page_number}
                  </span>
                </div>
              </Link>
            ))}
          </div>

        </section>
      )}

      {/* 4. BẢNG XẾP HẠNG & TRUYỆN ĐỌC NHIỀU (TRENDING STORIES POSTER GRID) */}
      <section className="space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-white tracking-wide">
                Bảng Xếp Hạng & Truyện Nổi Bật
              </h2>
            </div>
          </div>

          <Link 
            href="/kham-pha?sort=views" 
            className="text-xs font-semibold text-brand-400 hover:text-brand-300 flex items-center gap-1 transition"
          >
            <span>Khám phá thêm</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {/* 4-Column Grid with Full StoryCardGrid Component */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {trendingStories.map((story) => (
            <StoryCardGrid key={story.id} story={story} />
          ))}
        </div>
      </section>

    </div>
  );
}
