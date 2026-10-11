'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { 
  History, 
  Trash2, 
  BookOpen, 
  Clock, 
  ArrowRight, 
  AlertCircle, 
  CheckCircle2, 
  LogIn, 
  Search, 
  Compass, 
  Sparkles,
  X
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { useAuth } from '@/context/AuthContext';
import { getGuestHistory, positionHash, setGuestHistory } from '@/lib/readingHistory';
import { LIBRARY_URL } from '@/lib/apiJson';


export default function ReadingHistoryPage() {
  const { isAuthenticated, isLoading: isAuthLoading, openAuthModal, authFetch } = useAuth();

  const [history, setHistory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'novel' | 'manga'>('all');

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    // Signed in: the account's history from the server. Signed out: this browser's guest history.
    // The two are never merged, so a shared browser doesn't leak history between people.
    let combinedList: any[] = [];
    if (isAuthenticated) {
      try {
        const res = await authFetch(`${LIBRARY_URL}/history`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) combinedList = [...json.data];
        }
      } catch (e) {
        console.error('Failed to fetch history from API:', e);
      }
    } else {
      combinedList = getGuestHistory();
    }

    // Sort by read_at DESC
    combinedList.sort((a, b) => {
      const timeA = new Date(a.read_at || a.updated_at || 0).getTime();
      const timeB = new Date(b.read_at || b.updated_at || 0).getTime();
      return timeB - timeA;
    });

    // Deduplicate by story_id while keeping the most recently read chapter
    const storyMap = new Map<string, any>();
    for (const item of combinedList) {
      const key = item.story_id || item.id;
      if (key && !storyMap.has(key)) {
        storyMap.set(key, item);
      }
    }

    setHistory(Array.from(storyMap.values()));
    setIsLoading(false);
  }, [isAuthenticated, authFetch]);

  useEffect(() => {
    if (!isAuthLoading) {
      fetchHistory();
    }
  }, [isAuthLoading, isAuthenticated, fetchHistory]);

  const handleDeleteItem = async (item: any, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const targetId = item.id;
    const storyId = item.story_id;

    // Optimistically remove from state
    setHistory(prev => prev.filter(h => {
      if (targetId && h.id && h.id === targetId) return false;
      if (storyId && h.story_id && h.story_id === storyId) return false;
      return true;
    }));

    if (!isAuthenticated) {
      setGuestHistory(getGuestHistory().filter((h: any) => {
        if (targetId && h.id && h.id === targetId) return false;
        if (storyId && h.story_id && h.story_id === storyId) return false;
        return true;
      }));
    } else {
      const idToDelete = storyId || targetId;
      try {
        const res = await authFetch(`${LIBRARY_URL}/history/${idToDelete}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Failed to delete history item:', err);
        fetchHistory();
        return;
      }
    }

    setFeedback('Đã xóa truyện khỏi lịch sử đọc');
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleClearAll = async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử đọc của mình không?')) return;
    
    setHistory([]);
    if (!isAuthenticated) {
      setGuestHistory([]);
    } else {
      try {
        const res = await authFetch(`${LIBRARY_URL}/history`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Failed to clear history:', err);
        fetchHistory();
        return;
      }
    }
    setFeedback('Đã xóa toàn bộ lịch sử đọc thành công!');
    setTimeout(() => setFeedback(null), 3000);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMinutes < 1) return 'Vừa xong';
      if (diffMinutes < 60) return `${diffMinutes} phút trước`;
      if (diffHours < 24) return `${diffHours} giờ trước`;
      if (diffDays < 7) return `${diffDays} ngày trước`;

      return d.toLocaleDateString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatChapterNumber = (chapNumber?: number | string) => {
    const n = Number(chapNumber);
    return Number.isFinite(n) ? String(n) : chapNumber;
  };

  const getChapterDisplayText = (chapNumber?: number | string, chapTitle?: string) => {
    if (!chapTitle && chapNumber === undefined) return 'Đọc tiếp';
    const displayNumber = formatChapterNumber(chapNumber);
    if (!chapTitle) return `Chương ${displayNumber}`;
    if (/^(chương|chapter|ch\.|hồi)\s*\d+/i.test(chapTitle)) {
      return chapTitle;
    }
    return chapNumber !== undefined ? `Chương ${displayNumber}: ${chapTitle}` : chapTitle;
  };

  // Counts for tabs
  const novelCount = useMemo(() => history.filter(h => h.story_type === 'novel').length, [history]);
  const mangaCount = useMemo(() => history.filter(h => h.story_type === 'manga').length, [history]);

  // Filtered list based on search and story type
  const filteredHistory = useMemo(() => {
    return history.filter(item => {
      const title = (item.story_title || item.title || '').toLowerCase();
      const author = (item.story_author || item.author_name || '').toLowerCase();
      const chapterTitle = (item.chapter_title || '').toLowerCase();
      const search = searchTerm.toLowerCase().trim();

      const matchesSearch = !search || title.includes(search) || author.includes(search) || chapterTitle.includes(search);
      const matchesType = typeFilter === 'all' || item.story_type === typeFilter;

      return matchesSearch && matchesType;
    });
  }, [history, searchTerm, typeFilter]);

  if (isAuthLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6 animate-pulse">
        <div className="h-36 rounded-3xl bg-white/5" />
        <div className="h-12 w-1/3 bg-white/5 rounded-2xl" />
        <div className="space-y-4">
          <div className="h-28 rounded-3xl bg-white/5" />
          <div className="h-28 rounded-3xl bg-white/5" />
          <div className="h-28 rounded-3xl bg-white/5" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-24">
      
      {/* 1. Header Banner */}
      <div className="rounded-3xl p-6 sm:p-8 glass-panel border border-brand-500/20 bg-gradient-to-r from-brand-950/60 via-surface-2 to-surface bg-glass shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-bold">
              <History className="w-3.5 h-3.5 text-brand-400" /> Tiến Độ Đọc
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">
              Lịch Sử Đọc Truyện
            </h1>
            <p className="text-xs sm:text-sm text-gray-300">
              Theo dõi tiến độ đọc và dễ dàng tiếp tục những bộ truyện bạn đang đọc dở dang!
            </p>
          </div>

          {history.length > 0 && (
            <button
              onClick={handleClearAll}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition self-start sm:self-center shrink-0"
              title="Xóa tất cả lịch sử"
            >
              <Trash2 className="w-4 h-4" />
              Xóa toàn bộ lịch sử
            </button>
          )}
        </div>
      </div>

      {/* 2. Guest Storage Notice */}
      {!isAuthenticated && (
        <div className="p-4 rounded-2xl glass-panel border border-amber-500/30 bg-amber-500/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Bạn đang xem lịch sử lưu trên trình duyệt này. Đăng nhập để đồng bộ và lưu trữ lịch sử đọc xuyên suốt các thiết bị!</span>
          </div>
          <button
            onClick={() => openAuthModal('login')}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-ink font-bold shrink-0 transition flex items-center gap-1.5 shadow-md"
          >
            <LogIn className="w-3.5 h-3.5" /> Đăng nhập ngay
          </button>
        </div>
      )}

      {/* 3. Feedback Notification */}
      {feedback && (
        <div className="p-4 rounded-2xl bg-green-500/10 border border-green-500/30 text-green-300 text-xs font-semibold flex items-center gap-2 transition animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
          {feedback}
        </div>
      )}

      {/* 4. Controls: Filter & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Type tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/5 border border-white/10 w-fit">
          <button
            onClick={() => setTypeFilter('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              typeFilter === 'all'
                ? 'bg-brand-600 text-snow shadow-md shadow-brand-500/25'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Tất cả ({history.length})
          </button>
          <button
            onClick={() => setTypeFilter('novel')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              typeFilter === 'novel'
                ? 'bg-brand-600 text-snow shadow-md shadow-brand-500/25'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Light Novel ({novelCount})
          </button>
          <button
            onClick={() => setTypeFilter('manga')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              typeFilter === 'manga'
                ? 'bg-brand-600 text-snow shadow-md shadow-brand-500/25'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Manga ({mangaCount})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Tìm theo tên truyện, tác giả..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-9 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-brand-500/50 transition"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 5. Main Content Area */}
      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-32 rounded-3xl bg-white/5" />
          ))}
        </div>
      ) : filteredHistory.length === 0 ? (
        <div className="text-center py-20 glass-panel rounded-3xl border border-white/10 bg-glass space-y-4">
          <div className="w-16 h-16 rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center mx-auto">
            <History className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white">
            {searchTerm || typeFilter !== 'all' ? 'Không tìm thấy truyện phù hợp' : 'Lịch sử đọc đang trống'}
          </h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            {searchTerm || typeFilter !== 'all'
              ? 'Thử thay đổi từ khóa hoặc xóa bộ lọc để tìm lại các truyện đã đọc.'
              : 'Bạn chưa đọc tác phẩm nào gần đây. Hãy chọn một bộ truyện hấp dẫn để bắt đầu ngay!'}
          </p>
          {searchTerm || typeFilter !== 'all' ? (
            <button
              onClick={() => { setSearchTerm(''); setTypeFilter('all'); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/10 transition"
            >
              Đặt lại bộ lọc
            </button>
          ) : (
            <Link
              href="/kham-pha"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold shadow-lg shadow-brand-500/25 transition"
            >
              <Compass className="w-4 h-4" />
              Khám phá truyện mới
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredHistory.map((item) => {
            const storySlug = item.story_slug || item.slug || '';
            const chapterSlug = item.chapter_slug || '';
            const readChapterHref = chapterSlug && storySlug
              ? `/truyen/${storySlug}/${chapterSlug}${positionHash(item)}`
              : `/truyen/${storySlug}`;
            const storyHref = `/truyen/${storySlug}`;
            const coverUrl = item.story_cover || item.cover_image_url || '';
            const title = item.story_title || item.title || 'Truyện không tên';
            const author = item.story_author || item.author_name || 'Chưa rõ';
            const storyType = item.story_type === 'manga' ? 'Manga' : 'Light Novel';
            const chapterDisplay = getChapterDisplayText(item.chapter_number, item.chapter_title);
            const totalChapters = Number(item.total_chapters) || 0;
            const progressPercent = totalChapters > 0 && item.chapter_number !== undefined
              ? Math.min(100, Math.round((Number(item.chapter_number) / totalChapters) * 100))
              : null;

            return (
              <div
                key={item.id || item.story_id}
                className="group p-4 sm:p-5 rounded-3xl glass-panel border border-white/10 bg-glass hover:border-brand-500/30 transition duration-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                {/* Left: Cover + Meta Info */}
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  <Link 
                    href={storyHref}
                    className="w-20 h-28 sm:w-24 sm:h-32 rounded-2xl overflow-hidden flex-shrink-0 bg-gray-900 border border-white/10 relative group/cover block shadow-md"
                  >
                    <SmartImage
                      src={coverUrl}
                      alt={title}
                      className="w-full h-full object-cover group-hover/cover:scale-105 transition duration-300"
                    />
                  </Link>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    {/* Badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                        item.story_type === 'manga'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          : 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                      }`}>
                        {storyType}
                      </span>
                      {item.group_name && (
                        <span className="text-[11px] text-gray-400 bg-white/5 px-2 py-0.5 rounded-md border border-white/5">
                          {item.group_name}
                        </span>
                      )}
                    </div>

                    {/* Story Title */}
                    <Link href={storyHref} className="block group/title">
                      <h3 className="text-base sm:text-lg font-bold text-white group-hover/title:text-brand-300 transition line-clamp-1">
                        {title}
                      </h3>
                    </Link>

                    {/* Author */}
                    <p className="text-xs text-gray-400 line-clamp-1">
                      Tác giả: <span className="text-gray-300">{author}</span>
                    </p>

                    {/* Last Read Chapter */}
                    {item.chapter_title || item.chapter_number !== undefined ? (
                      <div className="pt-1">
                        <Link
                          href={readChapterHref}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 text-xs font-semibold text-brand-300 transition"
                        >
                          <BookOpen className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                          <span className="line-clamp-1">
                            {chapterDisplay}
                          </span>
                        </Link>
                      </div>
                    ) : null}

                    {/* Timestamp */}
                    <div className="flex items-center gap-1 text-[11px] text-gray-400 pt-0.5">
                      <Clock className="w-3 h-3 text-gray-500 shrink-0" />
                      <span>Đọc lúc: {formatDate(item.read_at || item.updated_at)}</span>
                    </div>

                    {/* Progress */}
                    {progressPercent !== null && (
                      <div className="flex items-center gap-2 pt-0.5">
                        <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden shrink-0">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-gray-500">
                          {progressPercent}% ({formatChapterNumber(item.chapter_number)}/{totalChapters})
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5">
                  <button
                    onClick={(e) => handleDeleteItem(item, e)}
                    className="p-2.5 rounded-xl text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition cursor-pointer"
                    title="Xóa khỏi lịch sử đọc"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <Link
                    href={readChapterHref}
                    className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold shadow-md shadow-brand-500/25 transition flex items-center justify-center gap-1.5"
                  >
                    Đọc tiếp
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
