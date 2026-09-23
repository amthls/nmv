'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, BookOpen, X, Check, Loader2 } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

interface StorySuggestion {
  id: string;
  title: string;
  slug: string;
  cover_image_url?: string;
  story_type: 'novel' | 'manga';
  author_name?: string;
  total_chapters: number;
}

interface SmartStorySearchProps {
  selectedStoryId: string;
  onSelectStory: (story: StorySuggestion | null) => void;
  initialStory?: StorySuggestion | null;
}

export default function SmartStorySearch({
  selectedStoryId,
  onSelectStory,
  initialStory = null,
}: SmartStorySearchProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<StorySuggestion[]>([]);
  const [selectedStory, setSelectedStory] = useState<StorySuggestion | null>(initialStory);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialStory && initialStory.id === selectedStoryId) {
      setSelectedStory(initialStory);
    } else if (!selectedStoryId) {
      setSelectedStory(null);
    }
  }, [initialStory, selectedStoryId]);

  // Debounced live search
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/stories/explore?q=${encodeURIComponent(query.trim())}&limit=6`);
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setSuggestions(json.data || []);
            setIsOpen(true);
          }
        }
      } catch (e) {
        console.error('Failed to search stories:', e);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (story: StorySuggestion) => {
    setSelectedStory(story);
    onSelectStory(story);
    setQuery('');
    setIsOpen(false);
  };

  const handleClear = () => {
    setSelectedStory(null);
    onSelectStory(null);
    setQuery('');
  };

  return (
    <div className="space-y-2" ref={containerRef}>
      <label className="text-[11px] font-bold text-brand-400 uppercase tracking-wider flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5" /> Gắn link bộ truyện liên quan (Tìm kiếm thông minh)
        </span>
        {selectedStory && (
          <button
            type="button"
            onClick={handleClear}
            className="text-[10px] text-rose-400 hover:underline font-semibold"
          >
            Hủy gắn truyện
          </button>
        )}
      </label>

      {/* Selected Story Preview Capsule */}
      {selectedStory ? (
        <div className="flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-brand-600/20 border border-brand-500/40 animate-in fade-in">
          <div className="flex items-center gap-3 truncate">
            <div className="w-10 h-14 rounded-lg overflow-hidden bg-gray-900 shrink-0 shadow-md">
              <SmartImage
                src={selectedStory.cover_image_url}
                alt={selectedStory.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="truncate text-xs">
              <div className="font-bold text-white truncate">{selectedStory.title}</div>
              <div className="text-[11px] text-gray-300">
                {selectedStory.author_name || 'Chưa rõ'} • <span className="text-brand-300 font-semibold">{selectedStory.total_chapters} chương</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* Search Input */
        <div className="relative">
          <input
            type="text"
            placeholder="Gõ tên truyện để tìm kiếm nhanh (e.g. Vì đã trở thành, Oshi, Seiken...)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.trim() && setIsOpen(true)}
            className="w-full h-10 pl-9 pr-9 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition"
          />
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          
          {isLoading && (
            <Loader2 className="w-4 h-4 text-brand-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
          )}

          {/* Autocomplete Suggestions Dropdown */}
          {isOpen && suggestions.length > 0 && (
            <div className="absolute top-12 left-0 right-0 z-30 bg-[#161626] border border-white/15 rounded-2xl shadow-2xl p-2 space-y-1 max-h-64 overflow-y-auto animate-in fade-in zoom-in-95">
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => handleSelect(s)}
                  className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/10 cursor-pointer transition text-xs group"
                >
                  <div className="w-8 h-11 rounded-lg overflow-hidden bg-gray-900 shrink-0">
                    <SmartImage src={s.cover_image_url} alt={s.title} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-white group-hover:text-brand-300 truncate">
                      {s.title}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      {s.author_name || 'Chưa rõ'} • {s.story_type === 'novel' ? 'Light Novel' : 'Manga'}
                    </div>
                  </div>
                  <Check className="w-4 h-4 text-brand-400 opacity-0 group-hover:opacity-100 transition" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
