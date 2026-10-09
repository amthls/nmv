'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Library, Plus, Shuffle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { API_BASE_URL, AlbumSummary, albumPath, readJson } from '@/lib/albums';
import AlbumCard from './AlbumCard';

interface StoryAlbumsSectionProps {
  storyId: string;
  /** bump to reload after the story was saved to / removed from an album */
  refreshKey?: number;
  onOpenSave: () => void;
}

/**
 * Bottom of a story page: one scrolling row of other users' public albums that hold this story,
 * in random order. Opening one shows what else is inside; the album page has Save / Copy.
 * My own albums holding the story are listed as small links above the row.
 */
export default function StoryAlbumsSection({ storyId, refreshKey, onOpenSave }: StoryAlbumsSectionProps) {
  const { isAuthenticated, authFetch, openAuthModal } = useAuth();
  const [mine, setMine] = useState<AlbumSummary[]>([]);
  const [others, setOthers] = useState<AlbumSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [shuffle, setShuffle] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetcher = isAuthenticated ? authFetch : fetch;
    setIsLoading(true);
    fetcher(`${API_BASE_URL}/albums/by-story/${storyId}?limit=20`, { credentials: 'include' })
      .then(readJson)
      .then((json) => {
        setMine(json.data.mine);
        setOthers(json.data.others);
        rowRef.current?.scrollTo({ left: 0 });
      })
      .catch((e) => console.error('Failed to load albums:', e))
      .finally(() => setIsLoading(false));
  }, [storyId, isAuthenticated, refreshKey, shuffle]);

  const scroll = (direction: -1 | 1) => {
    const row = rowRef.current;
    if (row) row.scrollBy({ left: direction * row.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-white/10">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Library className="w-5 h-5 text-brand-400" />
            <h3 className="text-xl font-bold text-white tracking-wide">Album có truyện này</h3>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Album của người đọc khác. Mở album để xem họ còn lưu truyện gì, thích thì lưu về hoặc sao chép.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {others.length > 1 && (
            <button
              onClick={() => setShuffle((n) => n + 1)}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold flex items-center gap-1 border border-white/10"
              title="Xem các album khác"
            >
              <Shuffle className="w-3.5 h-3.5" /> Ngẫu nhiên
            </button>
          )}
          <button
            onClick={() => (isAuthenticated ? onOpenSave() : openAuthModal('login'))}
            className="px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Lưu vào album
          </button>
        </div>
      </div>

      {mine.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-400">Bạn đã lưu trong:</span>
          {mine.map((album) => (
            <Link
              key={album.id}
              href={albumPath(album)}
              className="px-2.5 py-1 rounded-lg bg-brand-600/15 border border-brand-500/30 text-brand-300 hover:bg-brand-600/25 font-semibold"
            >
              {album.name}
            </Link>
          ))}
        </div>
      )}

      {isLoading && others.length === 0 ? (
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="w-44 sm:w-48 h-60 shrink-0 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : others.length === 0 ? (
        <p className="text-xs text-gray-400">Chưa có album công khai nào của người khác chứa truyện này.</p>
      ) : (
        <div className="relative group/row">
          <div
            ref={rowRef}
            className={`flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 [scrollbar-width:thin] transition-opacity ${isLoading ? 'opacity-50' : ''}`}
          >
            {others.map((album) => (
              <div key={album.id} className="w-44 sm:w-48 shrink-0 snap-start">
                <AlbumCard album={album} showOwner previewLabel="Còn có" />
              </div>
            ))}
          </div>
          {others.length > 3 && (
            <>
              <button
                onClick={() => scroll(-1)}
                className="hidden md:flex absolute left-0 top-1/3 -translate-x-1/2 w-9 h-9 rounded-full bg-zinc-900/90 border border-white/20 text-white items-center justify-center opacity-0 group-hover/row:opacity-100 transition"
                aria-label="Cuộn sang trái"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => scroll(1)}
                className="hidden md:flex absolute right-0 top-1/3 translate-x-1/2 w-9 h-9 rounded-full bg-zinc-900/90 border border-white/20 text-white items-center justify-center opacity-0 group-hover/row:opacity-100 transition"
                aria-label="Cuộn sang phải"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
