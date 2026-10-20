'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ChevronLeft, 
  ChevronRight, 
  List, 
  Settings, 
  ArrowUp, 
  BookOpen,
  MessageSquare
} from 'lucide-react';

interface FloatingReaderBarProps {
  storySlug: string;
  chapterNumber: number | string;
  chapterTitle: string;
  totalChapters?: number;
  prevChapter: { slug: string; title: string; chapter_number: number } | null;
  nextChapter: { slug: string; title: string; chapter_number: number } | null;
  onOpenChapterList: () => void;
  onOpenSettings: () => void;
  hiddenByTap?: boolean;
}

export default function FloatingReaderBar({
  storySlug,
  chapterNumber,
  chapterTitle,
  totalChapters,
  prevChapter,
  nextChapter,
  onOpenChapterList,
  onOpenSettings,
  hiddenByTap = false,
}: FloatingReaderBarProps) {
  const router = useRouter();
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  // Track scroll progress and auto-hide/show behavior (one pass per frame, state only when the value changes)
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (totalHeight > 0) {
        setScrollProgress(Math.min(100, Math.max(0, Math.round((window.scrollY / totalHeight) * 100))));
      }
      setIsVisible(true);
    };
    const handleScroll = () => { if (!raf) raf = requestAnimationFrame(update); };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <aside 
      aria-label="Thanh điều hướng đọc truyện"
      className={`fixed bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] lg:bottom-5 left-1/2 -translate-x-1/2 z-40 transition-all duration-300 ${
        isVisible && !hiddenByTap ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0 pointer-events-none'
      }`}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface/90 hover:bg-surface/95 backdrop-blur-xl border border-white/15 shadow-2xl shadow-black/80 ring-1 ring-white/5 transition-all">
        
        {/* 1. Nút Chương Trước */}
        <button
          onClick={() => prevChapter && router.push(`/truyen/${storySlug}/${prevChapter.slug}`)}
          disabled={!prevChapter}
          className="w-11 h-11 lg:w-8 lg:h-8 rounded-full flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition"
          title={prevChapter ? `Chương trước: ${prevChapter.title} (Phím A)` : 'Đã ở chương đầu tiên'}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* 2. Nút Trung Tâm: Hiển thị chương hiện tại + Click mở danh mục chương */}
        <button
          onClick={onOpenChapterList}
          className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-brand-500/40 text-xs text-white font-semibold transition group max-w-[110px] min-h-11 lg:min-h-0 sm:max-w-xs"
          title="Nhấn để mở danh mục chọn chương"
        >
          <List className="w-3.5 h-3.5 text-brand-400 group-hover:scale-110 transition-transform shrink-0" />
          
          <div className="truncate text-left">
            <span className="font-bold text-brand-300">C.{chapterNumber}</span>
            <span className="hidden sm:inline text-gray-300 text-[11px] ml-1.5 truncate">
              {chapterTitle}
            </span>
          </div>

          {/* Progress Pill */}
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-brand-600/30 text-brand-300 border border-brand-500/30 shrink-0 ml-1">
            {scrollProgress}%
          </span>
        </button>

        {/* 3. Nút Chương Sau */}
        <button
          onClick={() => nextChapter && router.push(`/truyen/${storySlug}/${nextChapter.slug}`)}
          disabled={!nextChapter}
          className="w-11 h-11 lg:w-8 lg:h-8 rounded-full flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition"
          title={nextChapter ? `Chương tiếp: ${nextChapter.title} (Phím D)` : 'Đã ở chương mới nhất'}
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-4 bg-white/15 mx-0.5" />

        {/* 4. Nút Mở Cài Đặt Nhanh */}
        <button
          onClick={onOpenSettings}
          className="w-11 h-11 lg:w-8 lg:h-8 rounded-full flex items-center justify-center text-gray-300 hover:text-brand-400 hover:bg-white/10 transition"
          title="Cài đặt giao diện đọc (Font, cỡ chữ, màu nền)"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* 5. Nút Lên Đầu Trang */}
        <button
          onClick={scrollToTop}
          className="w-11 h-11 lg:w-8 lg:h-8 rounded-full flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 transition"
          title="Cuộn lên đầu trang"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>

      </div>
    </aside>
  );
}
