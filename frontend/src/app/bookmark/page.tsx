'use client';

import React, { useState, useEffect } from 'react';
import Link from '@/components/common/Link';
import {
  Bookmark,
  BookOpen,
  Trash2,
  ArrowRight,
  CheckCircle2,
  Lock,
  LogIn,
  Library,
  Heart,
  Plus,
  Link2,
  Globe,
  Loader2
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import AlbumCard from '@/components/album/AlbumCard';
import { useAuth } from '@/context/AuthContext';
import { AlbumSummary, albumShareUrl, copyText, readJson } from '@/lib/albums';
import { LIBRARY_URL } from '@/lib/apiJson';


type Tab = 'albums' | 'saved_albums' | 'favorites' | 'line_bookmarks';

export default function BookmarkPage() {
  const { isAuthenticated, isLoading: isAuthLoading, openAuthModal, authFetch } = useAuth();

  const [mainTab, setMainTab] = useState<Tab>('albums');

  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [savedAlbums, setSavedAlbums] = useState<AlbumSummary[]>([]);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [newAlbumPublic, setNewAlbumPublic] = useState(false);
  const [isCreatingAlbum, setIsCreatingAlbum] = useState(false);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [lineBookmarks, setLineBookmarks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2800);
  };

  // Albums ("Truyện Đã Lưu" upgraded): mine, and other people's that I saved
  const fetchAlbums = async (which: 'me' | 'saved') => {
    setIsLoading(true);
    try {
      const json = await readJson(await authFetch(`${LIBRARY_URL}/albums/${which}`));
      (which === 'me' ? setAlbums : setSavedAlbums)(json.data);
    } catch (e) {
      console.error('Failed to load albums:', e);
    }
    setIsLoading(false);
  };

  const handleCreateAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlbumName.trim() || isCreatingAlbum) return;
    setIsCreatingAlbum(true);
    try {
      const json = await readJson(await authFetch(`${LIBRARY_URL}/albums`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAlbumName.trim(), is_public: newAlbumPublic }),
      }));
      setNewAlbumName('');
      showFeedback(json.message);
      fetchAlbums('me');
    } catch (err: any) {
      showFeedback(err.message);
    } finally {
      setIsCreatingAlbum(false);
    }
  };

  // Public/private: one album from its card, or all of mine at once
  const handleToggleVisibility = async (album: AlbumSummary) => {
    const next = !album.is_public;
    setAlbums(prev => prev.map(a => (a.id === album.id ? { ...a, is_public: next } : a)));
    try {
      await readJson(await authFetch(`${LIBRARY_URL}/albums/${album.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: next }),
      }));
      showFeedback(next ? `"${album.name}" đã công khai.` : `"${album.name}" đã chuyển riêng tư.`);
    } catch (err: any) {
      setAlbums(prev => prev.map(a => (a.id === album.id ? { ...a, is_public: album.is_public } : a)));
      showFeedback(err.message);
    }
  };

  const handleAllVisibility = async (isPublic: boolean) => {
    try {
      const json = await readJson(await authFetch(`${LIBRARY_URL}/albums/me/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: isPublic }),
      }));
      showFeedback(json.message);
      setAlbums(prev => prev.map(a => ({ ...a, is_public: isPublic })));
    } catch (err: any) {
      showFeedback(err.message);
    }
  };

  const handleShareAlbum = async (album: AlbumSummary) => {
    const url = albumShareUrl(album);
    if (await copyText(url)) showFeedback('Đã sao chép link chia sẻ album.');
    else window.prompt('Sao chép link album:', url);
  };

  const handleUnsaveAlbum = async (album: AlbumSummary) => {
    setSavedAlbums(prev => prev.filter(a => a.id !== album.id));
    try {
      const json = await readJson(await authFetch(`${LIBRARY_URL}/albums/${album.id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: album.share_key || undefined }),
      }));
      // the endpoint toggles: if it saved again (stale list), reload
      if (json.action !== 'removed') fetchAlbums('saved');
    } catch (err) {
      fetchAlbums('saved');
    }
  };

  // Followed stories (chapter update notifications) belong to the signed-in account
  const fetchFavorites = async () => {
    setIsLoading(true);
    let list: any[] = [];
    if (isAuthenticated) {
      try {
        const res = await authFetch(`${LIBRARY_URL}/favorites`);
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
        const res = await authFetch(`${LIBRARY_URL}/bookmarks`);
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
    if (!isAuthenticated) {
      setIsLoading(false);
      return;
    }
    if (mainTab === 'albums') fetchAlbums('me');
    else if (mainTab === 'saved_albums') fetchAlbums('saved');
    else if (mainTab === 'favorites') fetchFavorites();
    else fetchLineBookmarks();
  }, [mainTab, isAuthenticated]);

  const handleDeleteFavorite = async (storyId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = favorites.find(f => f.story_id === storyId);
    setFavorites(prev => prev.filter(f => f.story_id !== storyId));
    try {
      // toggle only removes when the category matches the stored one
      const res = await authFetch(`${LIBRARY_URL}/favorites/toggle`, {
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
      const res = await authFetch(`${LIBRARY_URL}/bookmarks/${id}`, { method: 'DELETE' });
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-6">
          <div className="h-64 rounded-3xl bg-white/5" />
          <div className="h-64 rounded-3xl bg-white/5" />
          <div className="h-64 rounded-3xl bg-white/5" />
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; count: number; icon: any }[] = [
    { id: 'albums', label: 'Album của tôi', count: albums.length, icon: Library },
    { id: 'saved_albums', label: 'Album đã lưu', count: savedAlbums.length, icon: Bookmark },
    { id: 'favorites', label: 'Đang theo dõi', count: favorites.length, icon: Heart },
    { id: 'line_bookmarks', label: 'Đoạn Bookmark', count: lineBookmarks.length, icon: BookOpen },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-24">

      {/* 1. Header Banner */}
      <div className="rounded-3xl p-6 sm:p-8 glass-panel border border-brand-500/20 bg-gradient-to-r from-brand-900/30 via-indigo-900/20 to-surface shadow-xl space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-bold">
          <Library className="w-3.5 h-3.5 text-brand-400" /> Tủ Sách & Đánh Dấu Cá Nhân
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">
          Album & Bookmark
        </h1>
        <p className="text-xs sm:text-sm text-gray-300">
          Xếp truyện vào các album tự đặt tên (một truyện nằm được trong nhiều album), chia sẻ album bằng link, lưu hoặc sao chép album của người khác.
        </p>
      </div>

      {/* 2. Main Tab Switcher */}
      <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/5 border border-white/10 w-full sm:w-fit overflow-x-auto scrollbar-none">
        {tabs.map(({ id, label, count, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMainTab(id)}
            className={`shrink-0 min-h-11 px-4 py-2.5 rounded-xl text-sm sm:text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
              mainTab === id
                ? 'bg-brand-600 text-snow shadow-md shadow-brand-500/25'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}{mainTab === id && !isLoading ? ` (${count})` : ''}
          </button>
        ))}
      </div>

      {/* 3. Content */}
      {!isAuthenticated ? (
        <div className="text-center py-20 glass-panel rounded-3xl border border-white/10 bg-glass space-y-4">
          <div className="w-16 h-16 rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white">Đăng nhập để xem tủ sách của bạn</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Album, truyện đang theo dõi và bookmark được lưu theo tài khoản của bạn.
          </p>
          <button
            onClick={() => openAuthModal('login')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold shadow-lg shadow-brand-500/25 transition"
          >
            <LogIn className="w-4 h-4" /> Đăng nhập
          </button>
        </div>
      ) : (
        <>
          {mainTab === 'albums' && (
            <form onSubmit={handleCreateAlbum} className="p-4 rounded-2xl glass-panel border border-white/10 flex flex-col sm:flex-row sm:items-center gap-3">
              <input
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                maxLength={100}
                placeholder="Tên album mới, ví dụ: Isekai hay nhất, Đọc cuối tuần..."
                className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-brand-500"
              />
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={newAlbumPublic} onChange={(e) => setNewAlbumPublic(e.target.checked)} className="accent-brand-500" />
                <Globe className="w-3.5 h-3.5" /> Công khai
              </label>
              <button
                type="submit"
                disabled={!newAlbumName.trim() || isCreatingAlbum}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isCreatingAlbum ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Tạo album
              </button>
            </form>
          )}

          {isLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-6 animate-pulse">
              <div className="h-64 rounded-3xl bg-white/5" />
              <div className="h-64 rounded-3xl bg-white/5" />
              <div className="h-64 rounded-3xl bg-white/5" />
            </div>
          ) : (
            <>
              {mainTab === 'albums' && (
                albums.length === 0 ? (
                  <div className="text-center py-16 glass-panel rounded-3xl border border-white/10 bg-glass space-y-4">
                    <div className="w-16 h-16 rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center mx-auto">
                      <Library className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-white">Bạn chưa có album nào</h3>
                    <p className="text-xs text-gray-400 max-w-sm mx-auto">
                      Tạo album ở trên, hoặc mở một truyện và bấm "Lưu vào album".
                    </p>
                    <Link
                      href="/kham-pha"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold shadow-lg shadow-brand-500/25 transition"
                    >
                      Khám phá truyện mới ngay
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-4">
                  {/* All albums at once; single albums switch from the badge on their card */}
                  <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/10">
                    <span className="text-xs text-gray-400 mr-auto">
                      <b className="text-emerald-400">{albums.filter(a => a.is_public).length}</b> công khai ·{' '}
                      <b className="text-gray-200">{albums.filter(a => !a.is_public).length}</b> riêng tư
                      <span className="hidden sm:inline text-gray-500"> · bấm nhãn trên từng album để đổi riêng album đó</span>
                    </span>
                    <button
                      onClick={() => handleAllVisibility(true)}
                      disabled={albums.every(a => a.is_public)}
                      className="min-h-11 sm:min-h-0 px-3 py-1.5 rounded-lg text-xs sm:text-[11px] font-bold flex items-center gap-1.5 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition"
                    >
                      <Globe className="w-3.5 h-3.5" /> Công khai tất cả
                    </button>
                    <button
                      onClick={() => handleAllVisibility(false)}
                      disabled={albums.every(a => !a.is_public)}
                      className="min-h-11 sm:min-h-0 px-3 py-1.5 rounded-lg text-xs sm:text-[11px] font-bold flex items-center gap-1.5 bg-white/5 text-gray-200 hover:bg-white/10 disabled:opacity-40 transition"
                    >
                      <Lock className="w-3.5 h-3.5" /> Riêng tư tất cả
                    </button>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(150px,calc(50%_-_8px)),1fr))] gap-3 sm:gap-4">
                    {albums.map((album) => (
                      <AlbumCard
                        key={album.id}
                        album={album}
                        onToggleVisibility={() => handleToggleVisibility(album)}
                        actions={
                          <button
                            onClick={() => handleShareAlbum(album)}
                            className="flex-1 min-h-11 sm:min-h-0 px-2.5 py-1.5 rounded-lg text-xs sm:text-[11px] font-bold flex items-center justify-center gap-1 bg-white/5 hover:bg-white/10 text-gray-300 transition"
                          >
                            <Link2 className="w-3 h-3" /> Chia sẻ link
                          </button>
                        }
                      />
                    ))}
                  </div>
                  </div>
                )
              )}

              {mainTab === 'saved_albums' && (
                savedAlbums.length === 0 ? (
                  <div className="text-center py-16 glass-panel rounded-3xl border border-white/10 bg-glass space-y-4">
                    <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto">
                      <Bookmark className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-white">Chưa lưu album nào của người khác</h3>
                    <p className="text-xs text-gray-400 max-w-sm mx-auto">
                      Cuối mỗi trang truyện có mục "Album khác có truyện này". Bấm "Lưu" để theo dõi album: khi chủ album thêm truyện, bạn cũng thấy ngay.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(150px,calc(50%_-_8px)),1fr))] gap-4">
                    {savedAlbums.map((album) => (
                      <AlbumCard
                        key={album.id}
                        album={album}
                        showOwner
                        actions={
                          <button
                            onClick={() => handleUnsaveAlbum(album)}
                            className="flex-1 min-h-11 sm:min-h-0 px-2.5 py-1.5 rounded-lg text-xs sm:text-[11px] font-bold flex items-center justify-center gap-1 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-rose-300 transition"
                          >
                            <Trash2 className="w-3 h-3" /> Bỏ lưu
                          </button>
                        }
                      />
                    ))}
                  </div>
                )
              )}

              {mainTab === 'favorites' && (
                favorites.length === 0 ? (
                  <div className="text-center py-20 glass-panel rounded-3xl border border-white/10 bg-glass space-y-4">
                    <div className="w-16 h-16 rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center mx-auto">
                      <Heart className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-white">Chưa theo dõi truyện nào</h3>
                    <p className="text-xs text-gray-400 max-w-sm mx-auto">
                      Bấm "Theo dõi" trên trang truyện để nhận thông báo khi có chương mới.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-6">
                    {favorites.map((fav) => (
                      <div
                        key={fav.id}
                        className="group rounded-3xl overflow-hidden glass-panel border border-white/10 bg-glass hover:border-brand-500/40 transition duration-300 flex flex-col justify-between"
                      >
                        <div className="p-5 flex gap-4">
                          <Link href={`/truyen/${fav.slug}`} className="w-24 h-32 rounded-2xl overflow-hidden flex-shrink-0 bg-gray-900 border border-white/10 relative">
                            <SmartImage src={fav.cover_image_url} alt={fav.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                          </Link>
                          <div className="min-w-0 flex-1">
                            <span className="text-xs sm:text-[10px] font-bold uppercase tracking-wider text-brand-400">
                              {fav.story_type}
                            </span>
                            <Link href={`/truyen/${fav.slug}`}>
                              <h4 className="text-sm font-bold text-white group-hover:text-brand-300 transition line-clamp-2 mt-0.5">
                                {fav.title}
                              </h4>
                            </Link>
                            <p className="text-xs text-gray-400 line-clamp-1 mt-1">{fav.author_name}</p>
                          </div>
                        </div>

                        <div className="px-5 py-3 border-t border-white/5 bg-black/20 flex items-center justify-between text-xs">
                          <span className="text-gray-400 text-xs sm:text-[11px]">
                            {fav.total_chapters || 0} chương
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => handleDeleteFavorite(fav.story_id, e)}
                              className="p-1.5 text-gray-400 hover:text-red-400 transition"
                              title="Bỏ theo dõi"
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
                )
              )}

              {mainTab === 'line_bookmarks' && (
                lineBookmarks.length === 0 ? (
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
                )
              )}
            </>
          )}
        </>
      )}

      {feedback && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-zinc-900/95 border border-white/20 text-white shadow-2xl backdrop-blur-md">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{feedback}</span>
        </div>
      )}
    </div>
  );
}
