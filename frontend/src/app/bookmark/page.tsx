'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Bookmark, 
  BookOpen, 
  Clock, 
  Trash2, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle,
  Layers,
  Star,
  Eye,
  Lock,
  LogIn,
  Sparkles
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function BookmarkPage() {
  const { isAuthenticated, isLoading: isAuthLoading, openAuthModal, authFetch } = useAuth();

  const [mainTab, setMainTab] = useState<'favorites' | 'line_bookmarks'>('favorites');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  
  const [favorites, setFavorites] = useState<any[]>([]);
  const [lineBookmarks, setLineBookmarks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Followed stories belong to the signed-in account and live only on the server
  const fetchFavorites = async () => {
    setIsLoading(true);
    let list: any[] = [];
    if (isAuthenticated) {
      try {
        let url = `${API_BASE_URL}/favorites?`;
        if (categoryFilter !== 'all') url += `category=${categoryFilter}&`;
        const res = await authFetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) list = json.data;
        }
      } catch (e) {
        console.error('Failed to load favorites:', e);
      }
    }
    setFavorites(list);
    setIsLoading(false);
  };

  const fetchLineBookmarks = async () => {
    setIsLoading(true);
    let list: any[] = [];
    if (isAuthenticated) {
      try {
        const res = await authFetch(`${API_BASE_URL}/bookmarks`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) list = json.data;
        }
      } catch (e) {
        console.error('Failed to load bookmarks:', e);
      }
    }

    setLineBookmarks(list);
    setIsLoading(false);
  };

  // Drop the old browser-wide lists that leaked between accounts on the same browser
  useEffect(() => {
    try {
      localStorage.removeItem('novelhub_guest_favorites');
      localStorage.removeItem('novelhub_guest_bookmarks');
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (mainTab === 'favorites') {
      fetchFavorites();
    } else {
      fetchLineBookmarks();
    }
  }, [mainTab, categoryFilter, isAuthenticated]);

  const handleUpdateCategory = async (storyId: string, newCat: string) => {
    try {
      const res = await authFetch(`${API_BASE_URL}/favorites/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story_id: storyId, category: newCat }),
      });
      if (res.ok) {
        fetchFavorites();
      }
    } catch (e) {}
  };

  const handleDeleteFavorite = async (storyId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = favorites.find(f => f.story_id === storyId);
    setFavorites(prev => prev.filter(f => f.story_id !== storyId));
    try {
      // toggle only removes when the category matches the stored one
      const res = await authFetch(`${API_BASE_URL}/favorites/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story_id: storyId, category: target?.category || 'reading' }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.action !== 'removed') throw new Error(json?.message || `HTTP ${res.status}`);
    } catch (err) {
      console.error('Failed to unfollow:', err);
      fetchFavorites();
    }
  };

  const handleDeleteBookmark = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLineBookmarks(prev => prev.filter(b => b.id !== id));
    try {
      const res = await authFetch(`${API_BASE_URL}/bookmarks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Failed to delete bookmark:', err);
      fetchLineBookmarks();
    }
  };

  if (isAuthLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 space-y-6 animate-pulse">
        <div className="h-36 rounded-3xl bg-white/5" />
        <div className="h-12 w-1/3 bg-white/5 rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="h-64 rounded-3xl bg-white/5" />
          <div className="h-64 rounded-3xl bg-white/5" />
          <div className="h-64 rounded-3xl bg-white/5" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-24">
      
      {/* 1. Header Banner */}
      <div className="rounded-3xl p-6 sm:p-8 glass-panel border border-brand-500/20 bg-gradient-to-r from-brand-900/30 via-indigo-900/20 to-surface shadow-xl space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-bold">
          <Bookmark className="w-3.5 h-3.5 text-brand-400" /> Tủ Sách & Đánh Dấu Cá Nhân
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">
          Danh Sách Đã Lưu & Bookmark
        </h1>
        <p className="text-xs sm:text-sm text-gray-300">
          Quản lý tủ sách truyện theo trạng thái đọc và lưu trữ các đoạn văn tâm đắc để đọc lại bất kỳ lúc nào!
        </p>
      </div>

      {/* 2. Main Tab Switcher */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/5 border border-white/10 w-full sm:w-auto">
          <button
            onClick={() => setMainTab('favorites')}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              mainTab === 'favorites'
                ? 'bg-brand-600 text-snow shadow-md shadow-brand-500/25'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            Truyện Đã Lưu ({favorites.length})
          </button>
          <button
            onClick={() => setMainTab('line_bookmarks')}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              mainTab === 'line_bookmarks'
                ? 'bg-brand-600 text-snow shadow-md shadow-brand-500/25'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Bookmark className="w-4 h-4" />
            Đoạn Bookmark ({lineBookmarks.length})
          </button>
        </div>

        {mainTab === 'favorites' && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 w-full sm:w-auto">
            {[
              { id: 'all', name: 'Tất cả' },
              { id: 'reading', name: 'Đang đọc' },
              { id: 'completed', name: 'Đã đọc xong' },
              { id: 'on_hold', name: 'Tạm dừng' },
              { id: 'plan_to_read', name: 'Dự định đọc' },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryFilter(c.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                  categoryFilter === c.id
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'bg-white/5 text-gray-400 hover:text-white'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3. Content */}
      {!isAuthenticated ? (
        <div className="text-center py-20 glass-panel rounded-3xl border border-white/10 bg-glass space-y-4">
          <div className="w-16 h-16 rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white">Đăng nhập để xem tủ sách của bạn</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Truyện đang theo dõi và bookmark được lưu theo tài khoản của bạn.
          </p>
          <button
            onClick={() => openAuthModal('login')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold shadow-lg shadow-brand-500/25 transition"
          >
            <LogIn className="w-4 h-4" /> Đăng nhập
          </button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          <div className="h-64 rounded-3xl bg-white/5" />
          <div className="h-64 rounded-3xl bg-white/5" />
          <div className="h-64 rounded-3xl bg-white/5" />
        </div>
      ) : (
        <>
          {mainTab === 'favorites' && (
            <div>
              {favorites.length === 0 ? (
                <div className="text-center py-20 glass-panel rounded-3xl border border-white/10 bg-glass space-y-4">
                  <div className="w-16 h-16 rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center mx-auto">
                    <BookOpen className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Chưa có truyện nào trong danh sách này</h3>
                  <p className="text-xs text-gray-400 max-w-sm mx-auto">
                    Khi xem bất kỳ truyện nào, bấm nút "Lưu truyện" hoặc "Yêu thích" để đưa vào danh mục theo dõi của bạn.
                  </p>
                  <Link
                    href="/kham-pha"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold shadow-lg shadow-brand-500/25 transition"
                  >
                    Khám phá truyện mới ngay
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {favorites.map((fav) => (
                    <div
                      key={fav.id}
                      className="group rounded-3xl overflow-hidden glass-panel border border-white/10 bg-glass hover:border-brand-500/40 transition duration-300 flex flex-col justify-between"
                    >
                      <div className="p-5 flex gap-4">
                        <Link href={`/truyen/${fav.slug}`} className="w-24 h-32 rounded-2xl overflow-hidden flex-shrink-0 bg-gray-900 border border-white/10 relative">
                          <SmartImage src={fav.cover_image_url} alt={fav.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                        </Link>
                        <div className="min-w-0 flex-1 flex flex-col justify-between">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-brand-400">
                              {fav.story_type}
                            </span>
                            <Link href={`/truyen/${fav.slug}`}>
                              <h4 className="text-sm font-bold text-white group-hover:text-brand-300 transition line-clamp-2 mt-0.5">
                                {fav.title}
                              </h4>
                            </Link>
                            <p className="text-xs text-gray-400 line-clamp-1 mt-1">{fav.author_name}</p>
                          </div>

                          <div className="pt-2">
                            <select
                              value={fav.category}
                              onChange={(e) => handleUpdateCategory(fav.story_id, e.target.value)}
                              className="text-[11px] font-medium bg-white/5 border border-white/10 text-brand-300 rounded-lg px-2 py-1 focus:outline-none"
                            >
                              <option value="reading" className="bg-glass text-white">Đang đọc</option>
                              <option value="completed" className="bg-glass text-white">Đã đọc xong</option>
                              <option value="on_hold" className="bg-glass text-white">Tạm dừng</option>
                              <option value="plan_to_read" className="bg-glass text-white">Dự định đọc</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="px-5 py-3 border-t border-white/5 bg-black/20 flex items-center justify-between text-xs">
                        <span className="text-gray-400 text-[11px]">
                          {fav.total_chapters || 0} chương
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => handleDeleteFavorite(fav.story_id, e)}
                            className="p-1.5 text-gray-400 hover:text-red-400 transition"
                            title="Xóa khỏi danh sách"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <Link
                            href={`/truyen/${fav.slug}`}
                            className="flex items-center gap-1 text-brand-400 hover:text-brand-300 font-semibold"
                          >
                            Đọc <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {mainTab === 'line_bookmarks' && (
            <div>
              {lineBookmarks.length === 0 ? (
                <div className="text-center py-20 glass-panel rounded-3xl border border-white/10 bg-glass space-y-4">
                  <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto">
                    <Bookmark className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Chưa có bookmark đánh dấu dòng nào</h3>
                  <p className="text-xs text-gray-400 max-w-sm mx-auto">
                    Khi đang đọc một chương truyện, bạn có thể click vào bất kỳ đoạn văn nào để ghim lại làm bookmark riêng.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {lineBookmarks.map((bm) => (
                    <div
                      key={bm.id}
                      className="p-5 rounded-3xl glass-panel border border-white/10 bg-glass hover:border-brand-500/30 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                    >
                      <Link 
                        href={`/truyen/${bm.story_slug}/${bm.chapter_slug}?line=${bm.line_index}#line-${bm.line_index}`}
                        className="space-y-1.5 min-w-0 flex-1 block group/item cursor-pointer"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-brand-400 group-hover/item:underline">{bm.story_title}</span>
                          <span className="text-xs text-gray-500">•</span>
                          <span className="text-xs text-gray-300 font-medium group-hover/item:text-white">Chương {bm.chapter_number}: {bm.chapter_title}</span>
                        </div>

                        {bm.line_text && (
                          <p className="text-sm text-gray-200 italic pl-3 border-l-2 border-brand-500/50 py-1 bg-white/[0.02] rounded-r-xl group-hover/item:text-brand-200 transition">
                            "{bm.line_text}"
                          </p>
                        )}

                        {bm.note && (
                          <p className="text-xs text-amber-300 flex items-center gap-1 pt-1">
                            <Bookmark className="w-3 h-3" />
                            Ghi chú: {bm.note}
                          </p>
                        )}
                      </Link>

                      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                        <button
                          onClick={(e) => handleDeleteBookmark(bm.id, e)}
                          className="p-2 text-gray-400 hover:text-red-400 transition"
                          title="Xóa bookmark"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <Link
                          href={`/truyen/${bm.story_slug}/${bm.chapter_slug}?line=${bm.line_index}#line-${bm.line_index}`}
                          className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold shadow transition flex items-center gap-1.5"
                        >
                          Đến chương <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}