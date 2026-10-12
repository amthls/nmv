'use client';

import React, { useState } from 'react';
import Link from '@/components/common/Link';
import { List, X, Search, Check, BookOpen, Layers } from 'lucide-react';

interface ChapterItem {
  id: string;
  title: string;
  chapter_number: number;
  slug: string;
  volume_title?: string;
  volume_number?: number;
}

interface ChapterSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  storySlug: string;
  currentChapterSlug: string;
  chapters: ChapterItem[];
}

export default function ChapterSelectorModal({
  isOpen,
  onClose,
  storySlug,
  currentChapterSlug,
  chapters,
}: ChapterSelectorModalProps) {
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const filteredChapters = chapters.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()) ||
    c.chapter_number.toString().includes(search)
  );

  return (
    <div 
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-lg bg-glass border border-white/15 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col animate-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30">
              <List className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Danh Mục Chương</h3>
              <p className="text-[11px] text-gray-400">{chapters.length} chương đã phát hành</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="Tìm nhanh theo số chương hoặc tiêu đề..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition"
            autoFocus
          />
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          {search && (
            <button 
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs"
            >
              Xóa
            </button>
          )}
        </div>

        {/* Chapter List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 max-h-[55vh]">
          {filteredChapters.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-500">
              Không tìm thấy chương nào phù hợp với từ khóa &quot;{search}&quot;
            </div>
          ) : (
            filteredChapters.map((c) => {
              const isCurrent = c.slug === currentChapterSlug;

              return (
                <Link
                  key={c.id}
                  href={`/truyen/${storySlug}/${c.slug}`}
                  onClick={onClose}
                  className={`flex items-center justify-between p-3 rounded-xl border text-xs transition-all ${
                    isCurrent
                      ? 'bg-brand-600/30 border-brand-500 text-white font-bold shadow-md shadow-brand-500/20'
                      : 'bg-white/5 hover:bg-white/10 border-transparent text-gray-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <span className={`w-7 h-7 rounded-lg text-[10px] font-bold flex items-center justify-center shrink-0 ${
                      isCurrent ? 'bg-brand-500 text-snow' : 'bg-white/10 text-gray-400'
                    }`}>
                      {c.chapter_number}
                    </span>
                    <span className="truncate">{c.title}</span>
                  </div>

                  {isCurrent && (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-500 text-snow shrink-0 ml-2 shadow-sm">
                      <Check className="w-3 h-3" /> Đang đọc
                    </span>
                  )}
                </Link>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-gray-400">
          <span>Nhấn vào chương để chuyển tiếp ngay lập tức</span>
          <button 
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white font-semibold transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
