'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { EyeOff, Lock, ExternalLink, RotateCcw, Search } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';
import CodeBadge from '@/components/common/CodeBadge';
import SmartImage from '@/components/common/SmartImage';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

const TYPE_TABS: { value: string; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'story', label: 'Truyện' },
  { value: 'post', label: 'Bài viết' },
];

const hrefOf = (item: any) => (item.type === 'story' ? `/truyen/${item.slug}` : `/fandom/${item.slug}`);
const restoreUrl = (item: any) =>
  item.type === 'story' ? `${API_BASE_URL}/stories/${item.id}/restore` : `${API_BASE_URL}/posts/${item.id}/approve`;

/** Stories and posts taken down by Admin/Mod: search them and restore them. */
export default function RemovedContentPage() {
  const { isAuthenticated, isLoading: isAuthLoading, hasRole, authFetch, openAuthModal } = useAuth();
  const [type, setType] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isModerator = hasRole('admin', 'mod');

  const load = useCallback(async (pageNum: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ type, page: String(pageNum) });
      if (query) params.set('q', query);
      const res = await authFetch(`${API_BASE_URL}/moderation/removed?${params}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setItems((prev) => (pageNum === 1 ? json.data : [...prev, ...json.data]));
        setTotal(json.pagination?.total ?? 0);
        setPage(pageNum);
      } else {
        setError(json.message || 'Không tải được danh sách nội dung đã gỡ.');
      }
    } catch (e: any) {
      setError('Lỗi kết nối: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }, [type, query, authFetch]);

  useEffect(() => {
    if (isAuthenticated && isModerator) load(1);
    else setIsLoading(false);
  }, [isAuthenticated, isModerator, load]);

  const restore = async (item: any) => {
    if (!confirm(`Khôi phục ${item.type === 'story' ? 'truyện' : 'bài viết'} "${item.title}"?`)) return;
    setBusyId(item.id);
    try {
      const res = await authFetch(restoreUrl(item), { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.success) {
        setItems((prev) => prev.filter((x) => x.id !== item.id));
        setTotal((n) => Math.max(0, n - 1));
      } else {
        alert(json.message || 'Khôi phục thất bại.');
      }
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  if (isAuthLoading) {
    return <PageLoader label="Đang kiểm tra quyền truy cập..." />;
  }

  if (!isAuthenticated || !isModerator) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-5">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Chỉ dành cho Admin/Mod</h2>
        <p className="text-sm text-gray-400 mb-6">Bạn cần đăng nhập bằng tài khoản quản trị hoặc kiểm duyệt viên để xem nội dung đã gỡ.</p>
        {!isAuthenticated && (
          <button onClick={() => openAuthModal('login')} className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm transition">
            Đăng nhập
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/25">
          <EyeOff className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white">Nội dung đã gỡ</h1>
          <p className="text-xs text-gray-400">{total} mục · chỉ Admin/Mod thấy trang này</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`px-3.5 h-8 rounded-lg text-xs font-bold border transition ${
                type === t.value
                  ? 'bg-brand-600 border-brand-500 text-snow'
                  : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); setQuery(searchInput.trim()); }}
          className="relative w-full sm:w-80 sm:ml-auto"
        >
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Mã, tên truyện/bài viết, nội dung, người đăng..."
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition"
          />
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        </form>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold">{error}</div>}

      {isLoading && page === 1 ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-white/5" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="p-10 text-center glass-panel rounded-2xl text-xs text-gray-400">
          {query ? 'Không có nội dung đã gỡ nào khớp tìm kiếm.' : 'Chưa có nội dung nào bị gỡ.'}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={`${item.type}-${item.id}`} className="p-4 rounded-2xl glass-panel border border-white/10 flex gap-4">
              <div className="w-14 h-20 rounded-lg overflow-hidden bg-gray-900 shrink-0">
                {item.image && <SmartImage src={item.image} alt={item.title} className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <CodeBadge code={item.code} />
                  <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold uppercase">
                    {item.type === 'story' ? 'Truyện' : 'Bài viết'}
                  </span>
                  <span className="text-gray-500 ml-auto">
                    {item.removed_at ? new Date(item.removed_at).toLocaleString('vi-VN') : 'Không rõ thời điểm'}
                    {item.removed_by_username && <> · gỡ bởi {item.removed_by_name || item.removed_by_username}</>}
                  </span>
                </div>
                <Link href={hrefOf(item)} className="text-sm text-white font-semibold hover:text-brand-400 inline-flex items-center gap-1.5 break-words">
                  {item.title}
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </Link>
                <div className="text-[11px] text-gray-400">
                  Người đăng: <Link href={`/nguoi-dung/${item.author_username}`} className="text-gray-300 hover:text-brand-300">{item.author_name || item.author_username}</Link>
                </div>
                {item.reason && <p className="text-xs text-rose-200/80 break-words">Lý do: {item.reason}</p>}
              </div>
              <div className="shrink-0 self-center">
                <button
                  onClick={() => restore(item)}
                  disabled={busyId === item.id}
                  className="px-3.5 h-8 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Khôi phục
                </button>
              </div>
            </div>
          ))}
          {items.length < total && (
            <div className="flex justify-center">
              <button
                onClick={() => load(page + 1)}
                disabled={isLoading}
                className="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/10 text-xs font-bold text-gray-200"
              >
                {isLoading ? 'Đang tải...' : 'Xem thêm'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
