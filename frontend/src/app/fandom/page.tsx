'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  MessageSquare, 
  Sparkles, 
  Search, 
  Plus, 
  Filter, 
  BookOpen, 
  ShieldCheck, 
  Award, 
  FileText,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  CheckSquare,
  Square,
  User
} from 'lucide-react';
import PostCard, { PostItem } from '@/components/fandom/PostCard';
import CreatePostModal from '@/components/fandom/CreatePostModal';
import SmartImage from '@/components/common/SmartImage';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function FandomPage() {
  const { user, isAuthenticated, hasRole, authFetch, openAuthModal } = useAuth();

  const [posts, setPosts] = useState<PostItem[]>([]);
  const [trendingStories, setTrendingStories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<PostItem | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<'newest' | 'popular' | 'views'>('newest');
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<'all' | 'popular' | 'newest' | 'drafts' | 'pending' | 'mine'>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Multi-select state for Bulk Approve / Bulk Reject
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkActionFeedback, setBulkActionFeedback] = useState<string | null>(null);

  const isAdminOrMod = hasRole('admin', 'mod');

  const buildPostsUrl = (targetPage: number) => {
    let url = `${API_BASE_URL}/posts?sort=${sortOption}&page=${targetPage}&limit=10`;

    if (filterTab === 'drafts') {
      url += `&filter_status=drafts`;
    } else if (filterTab === 'pending') {
      url += `&filter_status=pending`;
    } else if (filterTab === 'mine') {
      url += `&filter_status=mine`;
    }

    if (searchQuery.trim()) url += `&q=${encodeURIComponent(searchQuery.trim())}`;
    if (selectedStoryId) url += `&story_id=${selectedStoryId}`;
    return url;
  };

  const fetchPosts = async () => {
    setIsLoading(true);
    setSelectedPostIds([]); // Reset selection on fetch
    setPage(1);
    try {
      const res = await authFetch(buildPostsUrl(1));
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setPosts(json.data || []);
          setTotalPages(json.pagination?.totalPages || 1);
        }
      }
    } catch (e) {
      console.error('Failed to load fandom posts:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMorePosts = async () => {
    if (isLoadingMore || page >= totalPages) return;
    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await authFetch(buildPostsUrl(nextPage));
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setPosts((prev) => [...prev, ...(json.data || [])]);
          setPage(nextPage);
          setTotalPages(json.pagination?.totalPages || 1);
        }
      }
    } catch (e) {
      console.error('Failed to load more fandom posts:', e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [sortOption, selectedStoryId, filterTab]);

  useEffect(() => {
    async function fetchTrendingStories() {
      try {
        const res = await fetch(`${API_BASE_URL}/stories/trending`);
        if (res.ok) {
          const json = await res.json();
          if (json.success) setTrendingStories(json.data || []);
        }
      } catch (e) {}
    }
    fetchTrendingStories();
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPosts();
  };

  const handleEditPost = (post: PostItem) => {
    if (!isAuthenticated || !user) {
      openAuthModal('login');
      return;
    }
    const isAuthor = user.id === post.user_id;
    const isAdminOrMod = hasRole('admin', 'mod');
    if (!isAuthor && !isAdminOrMod) {
      alert('Bạn không có quyền chỉnh sửa bài viết của người khác.');
      return;
    }
    setEditingPost(post);
    setIsCreateModalOpen(true);
  };

  const handleOpenCreatePost = () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    setEditingPost(null);
    setIsCreateModalOpen(true);
  };

  // Bulk actions toggle
  const toggleSelectPost = (postId: string) => {
    setSelectedPostIds(prev => 
      prev.includes(postId) ? prev.filter(id => id !== postId) : [...prev, postId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedPostIds.length === posts.length) {
      setSelectedPostIds([]);
    } else {
      setSelectedPostIds(posts.map(p => p.id));
    }
  };

  // Bulk Approve API call
  const handleBulkApprove = async () => {
    if (selectedPostIds.length === 0 || isBulkProcessing) return;
    if (!confirm(`Bạn có chắc chắn muốn duyệt ${selectedPostIds.length} bài viết đã chọn?`)) return;

    setIsBulkProcessing(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/posts/bulk-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_ids: selectedPostIds }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setBulkActionFeedback(json.message);
        setTimeout(() => setBulkActionFeedback(null), 3000);
        fetchPosts();
      } else {
        alert(json.message || 'Duyệt hàng loạt thất bại.');
      }
    } catch (err: any) {
      alert('Lỗi kết nối: ' + err.message);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Bulk Reject API call
  const handleBulkReject = async () => {
    if (selectedPostIds.length === 0 || isBulkProcessing) return;
    if (!confirm(`Bạn có chắc chắn muốn từ chối ${selectedPostIds.length} bài viết đã chọn?`)) return;

    setIsBulkProcessing(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/posts/bulk-reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_ids: selectedPostIds }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setBulkActionFeedback(json.message);
        setTimeout(() => setBulkActionFeedback(null), 3000);
        fetchPosts();
      } else {
        alert(json.message || 'Từ chối hàng loạt thất bại.');
      }
    } catch (err: any) {
      alert('Lỗi kết nối: ' + err.message);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* 1. Header Banner */}
      <div className="relative rounded-3xl overflow-hidden glass-panel border border-brand-500/20 p-6 sm:p-8 bg-gradient-to-r from-brand-900/30 via-indigo-900/20 to-[#0F0F17] shadow-xl">
        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5 text-brand-400" /> Cộng Đồng Fandom & Diễn Đàn Thảo Luận
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">
              Không Gian Chia Sẻ, Review & Giao Lưu Cùng Độc Giả
            </h1>
            <p className="text-xs sm:text-sm text-gray-300">
              Hỗ trợ bản nháp bài viết, tìm kiếm thông minh khi gắn truyện, kiểm duyệt bài đăng bởi Admin/Mod và duyệt nhiều bài viết cùng lúc!
            </p>
          </div>

          <button
            onClick={handleOpenCreatePost}
            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white font-bold text-xs shadow-xl shadow-brand-500/25 flex items-center gap-2 transition hover:scale-105 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Đăng Bài Viết Mới</span>
          </button>
        </div>
      </div>

      {/* 2. Main 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Sidebar: Topics & Story Filter (3 cols) */}
        <aside className="lg:col-span-3 space-y-6">
          
          {/* Quick Filter Box */}
          <div className="glass-panel border border-white/10 rounded-3xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-brand-400" /> Bộ Lọc Bài Viết
            </h3>
            
            <div className="space-y-1 text-xs">
              <button
                onClick={() => { setFilterTab('all'); setSortOption('newest'); setSelectedStoryId(null); }}
                className={`w-full text-left px-3 py-2 rounded-xl font-semibold transition ${
                  filterTab === 'all' && selectedStoryId === null ? 'bg-brand-600/30 text-brand-300 border border-brand-500/30 font-bold' : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                Tất cả bài viết
              </button>

              <button
                onClick={() => { setFilterTab('all'); setSortOption('popular'); }}
                className={`w-full text-left px-3 py-2 rounded-xl font-semibold transition ${
                  filterTab === 'all' && sortOption === 'popular' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold' : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                Sôi nổi nhất
              </button>

              <button
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuthModal('login');
                    return;
                  }
                  setFilterTab('mine');
                }}
                className={`w-full text-left px-3 py-2 rounded-xl font-semibold transition flex items-center justify-between ${
                  filterTab === 'mine' ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-bold' : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-cyan-400" /> Bài Viết Của Tôi</span>
              </button>

              <button
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuthModal('login');
                    return;
                  }
                  setFilterTab('drafts');
                }}
                className={`w-full text-left px-3 py-2 rounded-xl font-semibold transition flex items-center justify-between ${
                  filterTab === 'drafts' ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 font-bold' : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-indigo-400" /> Bản Nháp Của Tôi</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600/30 text-indigo-300">Nháp</span>
              </button>

              {isAdminOrMod && (
                <button
                  onClick={() => setFilterTab('pending')}
                  className={`w-full text-left px-3 py-2 rounded-xl font-semibold transition flex items-center justify-between ${
                    filterTab === 'pending' ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold' : 'text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-rose-400" /> Chờ Duyệt</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-600/30 text-rose-300">Admin/Mod</span>
                </button>
              )}
            </div>
          </div>

          {/* Stories with Discussions */}
          {trendingStories.length > 0 && (
            <div className="glass-panel border border-white/10 rounded-3xl p-4 space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-cyan-400" /> Thảo Luận Theo Truyện
              </h3>
              
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {trendingStories.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStoryId(selectedStoryId === s.id ? null : s.id)}
                    className={`w-full flex items-center gap-2.5 p-2 rounded-xl text-left text-xs transition ${
                      selectedStoryId === s.id
                        ? 'bg-brand-600/30 border border-brand-500 text-white font-bold'
                        : 'hover:bg-white/5 text-gray-300'
                    }`}
                  >
                    <div className="w-8 h-10 rounded-lg overflow-hidden bg-gray-900 shrink-0">
                      <SmartImage src={s.cover_image_url} alt={s.title} className="w-full h-full object-cover" />
                    </div>
                    <div className="truncate">
                      <div className="truncate font-semibold">{s.title}</div>
                      <div className="text-[10px] text-gray-500">{s.story_type === 'novel' ? 'Light Novel' : 'Manga'}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

        </aside>

        {/* Center Main Feed (6 cols) */}
        <main className="lg:col-span-6 space-y-5">
          
          {/* Quick Trigger Post Box */}
          <div 
            onClick={handleOpenCreatePost}
            className="p-4 rounded-3xl glass-panel border border-white/10 hover:border-brand-500/40 transition cursor-pointer flex items-center gap-3 bg-[#131322]/90 shadow-md group"
          >
            <div className="w-9 h-9 rounded-full bg-brand-600/30 text-brand-300 border border-brand-500/30 flex items-center justify-center font-bold text-xs">
              {user?.display_name ? user.display_name.slice(0, 1).toUpperCase() : 'Bạn'}
            </div>
            <div className="flex-1 py-2 px-4 rounded-2xl bg-white/5 text-xs text-gray-400 group-hover:text-gray-300 transition">
              Bạn muốn chia sẻ cảm nhận, review hay thảo luận về bộ truyện nào...?
            </div>
            <button className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-500/20">
              Đăng
            </button>
          </div>

          {/* Search & Sort Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-2 rounded-2xl bg-white/5 border border-white/10">
            <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-72">
              <input
                type="text"
                placeholder="Tìm bài viết, tiêu đề..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            </form>

            <div className="flex items-center gap-2 self-end sm:self-auto text-xs">
              <span className="text-gray-400 text-[11px]">Sắp xếp:</span>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as any)}
                className="h-9 px-3 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-brand-500"
              >
                <option value="newest">Mới nhất</option>
                <option value="popular">Sôi nổi nhất</option>
                <option value="views">Nhiều lượt xem</option>
              </select>
            </div>
          </div>

          {/* Bulk Action Feedback Message */}
          {bulkActionFeedback && (
            <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{bulkActionFeedback}</span>
            </div>
          )}

          {/* Filter Status Alert Banner & Bulk Operations Bar */}
          {filterTab === 'drafts' && (
            <div className="p-3.5 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-xs font-semibold flex items-center justify-between">
              <span>Đang hiển thị các bài viết ở chế độ Bản Nháp của bạn</span>
              <span className="text-[11px] opacity-75">{posts.length} bản nháp</span>
            </div>
          )}

          {filterTab === 'pending' && isAdminOrMod && (
            <div className="p-4 rounded-3xl bg-[#1c1424] border border-rose-500/30 space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-rose-300">
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-rose-400" /> Hàng chờ duyệt bài đăng ({posts.length} bài)
                </span>
                <span className="text-[11px] text-gray-400">Quyền Kiểm duyệt Admin/Mod</span>
              </div>

              {/* Bulk Controls */}
              {posts.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-rose-500/20">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold transition"
                  >
                    {selectedPostIds.length === posts.length && posts.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-brand-400" />
                    ) : (
                      <Square className="w-4 h-4 text-gray-400" />
                    )}
                    <span>Chọn tất cả ({selectedPostIds.length}/{posts.length})</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleBulkApprove}
                      disabled={selectedPostIds.length === 0 || isBulkProcessing}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Duyệt ({selectedPostIds.length}) bài đã chọn</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleBulkReject}
                      disabled={selectedPostIds.length === 0 || isBulkProcessing}
                      className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-rose-600/20"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Từ chối ({selectedPostIds.length}) bài</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Posts List Feed */}
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="p-6 rounded-3xl bg-white/5 border border-white/10 animate-pulse space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-4 bg-white/10 rounded w-1/4" />
                      <div className="h-3 bg-white/10 rounded w-1/6" />
                    </div>
                  </div>
                  <div className="h-5 bg-white/10 rounded w-3/4" />
                  <div className="h-16 bg-white/10 rounded" />
                </div>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="p-12 text-center rounded-3xl glass-panel border border-white/10 space-y-3">
              <MessageSquare className="w-12 h-12 text-brand-400 mx-auto opacity-60" />
              <h3 className="text-base font-bold text-white">
                {filterTab === 'drafts' ? 'Bạn chưa có bản nháp nào' : (filterTab === 'pending' ? 'Không có bài viết nào đang chờ duyệt' : 'Chưa có bài viết nào')}
              </h3>
              <p className="text-xs text-gray-400 max-w-sm mx-auto">
                {filterTab === 'drafts' ? 'Soạn bài viết và chọn "Lưu Nháp" để lưu trữ an toàn.' : 'Hãy tạo một bài viết mới để bắt đầu thảo luận cùng mọi người!'}
              </p>
              <button
                onClick={handleOpenCreatePost}
                className="px-5 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-500 transition"
              >
                Tạo bài viết ngay
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onRefresh={fetchPosts}
                  onEdit={handleEditPost}
                  isAdminView={filterTab === 'pending'}
                  isSelectable={filterTab === 'pending' && isAdminOrMod}
                  isSelected={selectedPostIds.includes(post.id)}
                  onSelectToggle={toggleSelectPost}
                />
              ))}

              {page < totalPages && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={fetchMorePosts}
                    disabled={isLoadingMore}
                    className="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/10 text-xs font-bold text-gray-200 transition"
                  >
                    {isLoadingMore ? 'Đang tải...' : 'Xem thêm bài viết'}
                  </button>
                </div>
              )}
            </div>
          )}

        </main>

        {/* Right Sidebar: Guidelines & Leaderboard (3 cols) */}
        <aside className="lg:col-span-3 space-y-6">
          
          {/* Moderation Notice */}
          <div className="glass-panel border border-white/10 rounded-3xl p-5 space-y-3 bg-[#131322]/80">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Kiểm Duyệt Bài Viết
            </h3>
            
            <ul className="text-xs text-gray-300 space-y-2 list-disc list-inside leading-relaxed">
              <li>Bài viết từ độc giả sẽ được Ban quản trị duyệt để bảo đảm chất lượng nội dung.</li>
              <li>Bạn có thể lưu bản nháp và chỉnh sửa bài đăng của chính mình bất cứ lúc nào.</li>
              <li>Chỉ tác giả bài viết hoặc Admin/Mod mới có quyền chỉnh sửa hoặc xóa bài.</li>
              <li>Dùng thanh tìm kiếm thông minh để gắn đúng tác phẩm muốn thảo luận.</li>
            </ul>
          </div>

          {/* Active Members Leaderboard */}
          <div className="glass-panel border border-white/10 rounded-3xl p-5 space-y-3 bg-[#131322]/80">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" /> Thành Viên Sôi Nổi Tuần
            </h3>
            
            <div className="space-y-3 pt-1">
              {[
                { name: 'Hana_Translator', role: 'Dịch Giả', posts: 14, avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100' },
                { name: 'KuroNeko', role: 'Mod', posts: 11, avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' },
                { name: 'MinhTri_Novel', role: 'Độc giả VIP', posts: 8, avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100' }
              ].map((member, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      idx === 0 ? 'bg-amber-500 text-black' : idx === 1 ? 'bg-gray-400 text-black' : 'bg-amber-800 text-white'
                    }`}>
                      {idx + 1}
                    </span>
                    <div>
                      <div className="font-bold text-white">{member.name}</div>
                      <div className="text-[10px] text-gray-400">{member.role}</div>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-brand-300">{member.posts} bài</span>
                </div>
              ))}
            </div>
          </div>

        </aside>

      </div>

      {/* Create / Edit Post Modal */}
      <CreatePostModal
        isOpen={isCreateModalOpen}
        onClose={() => { setIsCreateModalOpen(false); setEditingPost(null); }}
        onSuccess={fetchPosts}
        editPostData={editingPost}
      />

    </div>
  );
}