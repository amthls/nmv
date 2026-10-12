'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { 
  Users, 
  Sparkles, 
  Search, 
  Plus, 
  BookOpen, 
  Globe, 
  MessageSquare,
  ChevronRight
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import CreateGroupModal from '@/components/groups/CreateGroupModal';
import { stripHtml } from '@/lib/richText';
import { useAuth } from '@/context/AuthContext';
import SearchInput from '@/components/common/SearchInput';
import { useDebounced } from '@/lib/useDebounced';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function GroupsPage() {
  const { isAuthenticated, authFetch, openAuthModal } = useAuth();
  const [groups, setGroups] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'all' | 'my_groups'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // search as you type: one request when typing stops, the previous one aborted (Plan/load-and-layout.md)
  const [settledQuery, typing] = useDebounced(searchQuery.trim());
  const inFlight = useRef<AbortController | null>(null);

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  /** Page 1 replaces the list; later pages ("Tải thêm") are appended. */
  const fetchGroups = async (pageNum = 1) => {
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    if (pageNum === 1) setIsLoading(true); else setLoadingMore(true);
    try {
      let url = `${API_BASE_URL}/groups?page=${pageNum}&`;
      if (filterTab === 'my_groups') url += `filter_status=my_groups&`;
      if (settledQuery) url += `q=${encodeURIComponent(settledQuery)}&`;

      // authFetch: "my groups" depends on who is signed in
      const res = await authFetch(url, { signal: ctrl.signal });
      const json = await res.json().catch(() => null);
      if (!ctrl.signal.aborted) {
        const rows = res.ok && json?.success ? json.data || [] : [];
        setGroups((prev) => (pageNum === 1 ? rows : [...prev, ...rows]));
        setPage(pageNum);
        setHasMore(!!json?.pagination?.hasNextPage);
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.error('Failed to fetch groups:', e);
    } finally {
      if (!ctrl.signal.aborted) { setIsLoading(false); setLoadingMore(false); }
    }
  };

  useEffect(() => {
    fetchGroups();
  }, [filterTab, isAuthenticated, settledQuery]);

  // "My groups" falls back to "all" when nobody is signed in any more (e.g. logout)
  useEffect(() => {
    if (filterTab === 'my_groups' && !isAuthenticated) setFilterTab('all');
  }, [isAuthenticated]);

  const requireLogin = (action: () => void) => () => (isAuthenticated ? action() : openAuthModal('login'));

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchGroups();
  };

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-24">
      
      {/* 1. Header Banner */}
      <div className="relative rounded-3xl overflow-hidden glass-panel border border-brand-500/20 p-6 sm:p-8 bg-gradient-to-r from-brand-900/30 via-indigo-900/20 to-surface shadow-xl">
        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-bold">
              <Users className="w-3.5 h-3.5 text-brand-400" /> Danh Bạ & Không Gian Nhóm Dịch
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">
              Khám Phá & Đồng Hành Cùng Các Nhóm Dịch Thuật
            </h1>
            <p className="text-xs sm:text-sm text-gray-300">
              Quản lý nhóm dịch, thêm thành viên phân quyền, trò chuyện nội bộ và đăng tải các tác phẩm Light Novel & Manga độc quyền!
            </p>
          </div>

          <button
            onClick={requireLogin(() => setIsCreateModalOpen(true))}
            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-snow font-bold text-xs shadow-xl shadow-brand-500/25 flex items-center gap-2 transition hover:scale-105 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Thành Lập Nhóm Mới</span>
          </button>
        </div>
      </div>

      {/* 2. Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/5 border border-white/10 w-full sm:w-auto overflow-x-auto">
          <button
            onClick={() => setFilterTab('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
              filterTab === 'all'
                ? 'bg-brand-600 text-snow shadow-md shadow-brand-500/20'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            🌟 Tất Cả Nhóm Dịch
          </button>
          
          <button
            onClick={requireLogin(() => setFilterTab('my_groups'))}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
              filterTab === 'my_groups'
                ? 'bg-brand-600 text-snow shadow-md shadow-brand-500/20'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            👥 Nhóm Của Tôi
          </button>

        </div>

        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="w-full sm:w-72">
          <SearchInput value={searchQuery} onChange={setSearchQuery} loading={typing || (isLoading && !!settledQuery)} placeholder="Tìm theo tên nhóm dịch..." />
        </form>

      </div>

      {/* 3. Group Grid */}
      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-64 rounded-3xl bg-white/5 border border-white/10" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="p-16 text-center rounded-3xl glass-panel border border-white/10 space-y-3">
          <Users className="w-12 h-12 text-brand-400 mx-auto opacity-60" />
          <h3 className="text-base font-bold text-white">Chưa tìm thấy nhóm dịch nào</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            {filterTab === 'my_groups' 
              ? 'Bạn chưa tham gia hoặc làm chủ nhóm dịch nào. Hãy tạo nhóm mới ngay!' 
              : 'Hãy thử tìm kiếm với từ khóa khác hoặc tạo một nhóm dịch mới.'}
          </p>
          <button
            onClick={requireLogin(() => setIsCreateModalOpen(true))}
            className="px-5 py-2.5 rounded-xl bg-brand-600 text-snow text-xs font-bold hover:bg-brand-500 transition"
          >
            Tạo nhóm dịch ngay
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
          {groups.map((group) => (
            <div 
              key={group.id}
              className="rounded-3xl glass-panel border border-white/10 hover:border-brand-500/40 transition-all duration-300 overflow-hidden flex flex-col justify-between group hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-500/10 bg-surface-2/85"
            >
              <div>
                {/* Banner */}
                <div className="h-28 w-full bg-gradient-to-r from-brand-900/50 to-indigo-900/50 relative overflow-hidden">
                  {group.banner_url ? (
                    <SmartImage src={group.banner_url} alt={group.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-indigo-600/30 to-brand-600/20" />
                  )}
                </div>

                {/* Avatar & Info */}
                <div className="px-5 pb-4 relative pt-12">
                  {/* Floating Avatar */}
                  <div className="absolute -top-10 left-5 w-20 h-20 rounded-2xl overflow-hidden border-2 border-surface-2 bg-gray-900 shadow-xl">
                    <SmartImage 
                      src={group.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200'} 
                      alt={group.name} 
                      className="w-full h-full object-cover" 
                    />
                  </div>

                  <div className="space-y-2">
                    <Link href={`/nhom-dich/${group.slug}`}>
                      <h3 className="text-base font-extrabold text-white group-hover:text-brand-400 transition-colors leading-snug">
                        {group.name}
                      </h3>
                    </Link>

                    <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
                      {stripHtml(group.description) || 'Chưa có mô tả nhóm dịch.'}
                    </p>

                    {/* Stats pills */}
                    <div className="flex items-center gap-3 pt-2 text-xs text-gray-300">
                      <span className="flex items-center gap-1 font-semibold text-brand-300">
                        <BookOpen className="w-3.5 h-3.5" /> {group.story_count || 0} bộ truyện
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 font-semibold text-cyan-300">
                        <Users className="w-3.5 h-3.5" /> {group.member_count || 1} thành viên
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="px-5 py-3.5 border-t border-white/5 bg-black/20 flex items-center justify-between">
                <div className="text-[11px] text-gray-500 truncate">
                  Trưởng nhóm: <strong className="text-gray-300">{group.leader?.display_name || group.leader?.username || group.creator_name || group.creator_username}</strong>
                </div>

                <Link
                  href={`/nhom-dich/${group.slug}`}
                  className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold flex items-center gap-1 transition group/btn"
                >
                  <span>Vào Nhóm</span>
                  <ChevronRight className="w-3.5 h-3.5 text-brand-400 group-hover/btn:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
      {!isLoading && hasMore && (
        <div className="text-center">
          <button
            onClick={() => fetchGroups(page + 1)}
            disabled={loadingMore}
            className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center gap-2"
          >
            {loadingMore && <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />} Tải thêm nhóm
          </button>
        </div>
      )}

      {/* Create Group Modal */}
      <CreateGroupModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={fetchGroups}
      />

    </div>
  );
}
