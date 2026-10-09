'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  MessageSquare,
  Search,
  Plus,
  BookOpen,
  ShieldCheck,
  Award,
  FileText,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  CheckSquare,
  Square,
  User,
  Newspaper,
  X,
  PenSquare,
  Users,
} from 'lucide-react';
import PostCard, { PostItem } from '@/components/fandom/PostCard';
import CreatePostModal from '@/components/fandom/CreatePostModal';
import SmartImage from '@/components/common/SmartImage';
import { useAuth } from '@/context/AuthContext';
import { API_BASE_URL, CATEGORIES, ROLE_BADGES, readJson, topRole } from '@/lib/fandom';

type Feed = 'all' | 'mine' | 'drafts' | 'pending';
type Sort = 'newest' | 'hot' | 'top' | 'views';
interface StoryRef { id: string; title: string; slug: string; cover_image_url?: string; story_type?: string; author_name?: string; post_count?: number }
interface Sidebar {
  leaderboard: { username: string; display_name: string | null; avatar_url: string | null; roles: string[]; posts: number; reactions: number; comments: number }[];
  stories: StoryRef[];
  counts: { total: number; drafts: number; mine: number; pending: number | null };
}

const SORTS: { id: Sort; label: string }[] = [
  { id: 'newest', label: 'Mới nhất' },
  { id: 'hot', label: 'Đang sôi nổi' },
  { id: 'top', label: 'Nhiều cảm xúc nhất' },
  { id: 'views', label: 'Nhiều lượt xem' },
];

function FandomContent() {
  const { user, isAuthenticated, isLoading: authLoading, hasRole, authFetch, openAuthModal } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isStaff = hasRole('admin', 'mod');

  const [feed, setFeed] = useState<Feed>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [category, setCategory] = useState<string>(searchParams?.get('category') || 'all');
  const [story, setStory] = useState<StoryRef | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');

  const [posts, setPosts] = useState<PostItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sidebar, setSidebar] = useState<Sidebar | null>(null);

  const [composer, setComposer] = useState<{ open: boolean; edit: PostItem | null }>({ open: false, edit: null });
  const [selected, setSelected] = useState<string[]>([]);
  const [isBulk, setIsBulk] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ?story=<slug> (from a story page) filters by that story; &compose=1 opens the composer for it
  useEffect(() => {
    const slug = searchParams?.get('story');
    if (!slug) return;
    fetch(`${API_BASE_URL}/stories/${slug}`)
      .then(readJson)
      .then((json) => {
        const s = json.data;
        setStory({ id: s.id, title: s.title, slug: s.slug, cover_image_url: s.cover_image_url, story_type: s.story_type, author_name: s.author_name });
        if (searchParams?.get('compose') === '1') setComposer({ open: true, edit: null });
      })
      .catch(() => {});
  }, [searchParams]);

  // search as you type (debounced)
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetcher = isAuthenticated ? authFetch : fetch;

  const buildUrl = (p: number) => {
    const params = new URLSearchParams({ sort, page: String(p), limit: '10' });
    if (feed !== 'all') params.set('filter_status', feed);
    if (category !== 'all') params.set('category', category);
    if (story) params.set('story_id', story.id);
    if (query) params.set('q', query);
    return `${API_BASE_URL}/posts?${params}`;
  };

  const loadSidebar = useCallback(() => {
    fetcher(`${API_BASE_URL}/posts/sidebar`).then(readJson).then((j) => setSidebar(j.data)).catch(() => {});
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPosts = useCallback(async () => {
    setIsLoading(true);
    setSelected([]);
    try {
      const json = await readJson(await fetcher(buildUrl(1)));
      setPosts(json.data || []);
      setPage(1);
      setTotalPages(json.pagination?.totalPages || 1);
    } catch (e: any) {
      setPosts([]);
      showToast(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [feed, sort, category, story?.id, query, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!authLoading) loadPosts(); }, [loadPosts, authLoading]);
  useEffect(() => { if (!authLoading) loadSidebar(); }, [loadSidebar, authLoading]);

  const refresh = () => { loadPosts(); loadSidebar(); };

  const loadMore = async () => {
    if (isLoadingMore || page >= totalPages) return;
    setIsLoadingMore(true);
    try {
      const json = await readJson(await fetcher(buildUrl(page + 1)));
      setPosts((prev) => [...prev, ...(json.data || [])]);
      setPage(page + 1);
      setTotalPages(json.pagination?.totalPages || 1);
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const openComposer = (edit: PostItem | null = null) => {
    if (!isAuthenticated) return openAuthModal('login');
    setComposer({ open: true, edit });
  };

  const pickFeed = (f: Feed) => {
    if (f !== 'all' && !isAuthenticated) return openAuthModal('login');
    setFeed(f);
  };

  const pickStory = (s: StoryRef | null) => {
    setStory(s);
    // keep the URL shareable / bookmarkable
    router.replace(s ? `/fandom?story=${s.slug}` : '/fandom', { scroll: false });
  };

  const bulk = async (approve: boolean) => {
    if (selected.length === 0 || isBulk) return;
    let reason: string | null = null;
    if (approve) {
      if (!confirm(`Duyệt ${selected.length} bài viết đã chọn?`)) return;
    } else {
      reason = prompt(`Lý do từ chối ${selected.length} bài viết (người đăng sẽ thấy, có thể để trống):`);
      if (reason === null) return;
    }
    setIsBulk(true);
    try {
      const json = await readJson(await authFetch(`${API_BASE_URL}/posts/${approve ? 'bulk-approve' : 'bulk-reject'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_ids: selected, reason }),
      }));
      showToast(json.message);
      refresh();
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setIsBulk(false);
    }
  };

  const counts = sidebar?.counts;
  const feeds: { id: Feed; label: string; icon: any; count?: number | null; hidden?: boolean }[] = [
    { id: 'all', label: 'Bảng tin', icon: Newspaper, count: counts?.total },
    { id: 'mine', label: 'Bài viết của tôi', icon: User, count: isAuthenticated ? counts?.mine : null },
    { id: 'drafts', label: 'Bản nháp', icon: FileText, count: isAuthenticated ? counts?.drafts : null },
    { id: 'pending', label: 'Cần xem lại', icon: ShieldAlert, count: counts?.pending, hidden: !isStaff },
  ];

  const emptyText = {
    all: query || story || category !== 'all' ? 'Không có bài viết nào khớp bộ lọc.' : 'Chưa có bài viết nào. Hãy mở đầu cuộc thảo luận!',
    mine: 'Bạn chưa đăng bài viết nào.',
    drafts: 'Bạn chưa có bản nháp nào. Khi soạn bài, bấm "Lưu Nháp" để viết tiếp sau.',
    pending: 'Không có bài viết nào cần xem lại.',
  }[feed];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 pb-24">
      {/* Header */}
      <div className="rounded-2xl glass-panel border border-white/10 p-5 sm:p-6 bg-gradient-to-r from-brand-900/30 via-indigo-900/20 to-transparent flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">Fandom</h1>
          <p className="text-sm text-gray-300 mt-1">
            Review, fanart, giả thuyết và thảo luận về những bộ truyện bạn yêu thích.
            {counts?.total ? <span className="text-gray-400"> · {counts.total.toLocaleString('vi-VN')} bài viết</span> : null}
          </p>
        </div>
        <button
          onClick={() => openComposer()}
          className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-bold text-sm shadow-lg shadow-brand-500/25 flex items-center justify-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" /> Viết bài
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: feeds + stories */}
        <aside className="lg:col-span-3 space-y-4">
          <nav className="glass-panel border border-white/10 rounded-2xl p-2 flex lg:flex-col gap-1 overflow-x-auto">
            {feeds.filter((f) => !f.hidden).map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => pickFeed(id)}
                className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
                  feed === id ? 'bg-brand-600/25 text-white' : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${id === 'pending' ? 'text-rose-400' : 'text-brand-400'}`} /> {label}
                </span>
                {count ? (
                  <span className={`text-[11px] px-1.5 rounded-full ${id === 'pending' ? 'bg-rose-500/25 text-rose-200' : 'bg-white/10 text-gray-300'}`}>{count}</span>
                ) : null}
              </button>
            ))}
          </nav>

          {sidebar && sidebar.stories.length > 0 && (
            <div className="hidden lg:block glass-panel border border-white/10 rounded-2xl p-4 space-y-2">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-cyan-400" /> Thảo luận theo truyện
              </h3>
              <div className="space-y-1 max-h-96 overflow-y-auto -mx-1 px-1">
                {sidebar.stories.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => pickStory(story?.id === s.id ? null : s)}
                    className={`w-full flex items-center gap-2.5 p-1.5 rounded-xl text-left transition ${
                      story?.id === s.id ? 'bg-brand-600/25' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="w-8 h-11 rounded-md overflow-hidden bg-gray-900 shrink-0">
                      <SmartImage src={s.cover_image_url} alt={s.title} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-gray-200 line-clamp-2">{s.title}</div>
                      <div className="text-[10px] text-gray-500">{s.post_count} bài viết</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Center: feed */}
        <main className="lg:col-span-6 space-y-4 min-w-0">
          {/* Composer shortcut */}
          {feed === 'all' && (
            <button
              onClick={() => openComposer()}
              className="w-full p-3 rounded-2xl glass-panel border border-white/10 hover:border-brand-500/40 transition flex items-center gap-3 text-left"
            >
              <div className="w-9 h-9 rounded-full overflow-hidden bg-brand-600/30 flex items-center justify-center shrink-0">
                {user?.avatar_url
                  ? <SmartImage src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                  : <User className="w-4 h-4 text-brand-300" />}
              </div>
              <span className="flex-1 py-2 px-4 rounded-xl bg-white/5 text-sm text-gray-400">
                {story ? `Viết gì đó về ${story.title}...` : 'Bạn đang nghĩ gì về bộ truyện mình đọc?'}
              </span>
              <PenSquare className="w-4 h-4 text-brand-400 mr-1" />
            </button>
          )}

          {/* Categories */}
          {feed === 'all' && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              {[{ id: 'all', label: 'Tất cả', emoji: '✨', cls: '' }, ...CATEGORIES].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition ${
                    category === c.id ? (c.cls || 'bg-white/15 text-white border-white/20') : 'border-white/10 text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {c.emoji} {c.label}
                </button>
              ))}
            </div>
          )}

          {/* Search + sort */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                placeholder="Tìm trong tiêu đề và nội dung bài viết..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-brand-500"
            >
              {SORTS.map((s) => <option key={s.id} value={s.id} className="bg-surface-3">{s.label}</option>)}
            </select>
          </div>

          {/* Active story filter */}
          {story && (
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-brand-600/10 border border-brand-500/25">
              <div className="w-8 h-11 rounded-md overflow-hidden bg-gray-900 shrink-0">
                <SmartImage src={story.cover_image_url} alt={story.title} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0 text-xs">
                <div className="text-gray-400">Đang xem thảo luận về</div>
                <Link href={`/truyen/${story.slug}`} className="font-bold text-white hover:text-brand-300 truncate block">{story.title}</Link>
              </div>
              <button onClick={() => openComposer()} className="px-2.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow text-[11px] font-bold shrink-0">
                Viết về truyện này
              </button>
              <button onClick={() => pickStory(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10" aria-label="Bỏ lọc truyện">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Moderation bar */}
          {feed === 'pending' && isStaff && posts.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25">
              <button
                onClick={() => setSelected(selected.length === posts.length ? [] : posts.map((p) => p.id))}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-200"
              >
                {selected.length === posts.length ? <CheckSquare className="w-4 h-4 text-brand-400" /> : <Square className="w-4 h-4 text-gray-400" />}
                Chọn tất cả ({selected.length}/{posts.length})
              </button>
              <div className="flex gap-2">
                <button onClick={() => bulk(true)} disabled={!selected.length || isBulk} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-snow text-xs font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Duyệt
                </button>
                <button onClick={() => bulk(false)} disabled={!selected.length || isBulk} className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-snow text-xs font-bold flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> Từ chối
                </button>
              </div>
            </div>
          )}

          {/* Feed */}
          {isLoading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="p-5 rounded-2xl bg-white/5 border border-white/10 animate-pulse space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10" />
                    <div className="h-3 bg-white/10 rounded w-1/3" />
                  </div>
                  <div className="h-5 bg-white/10 rounded w-3/4" />
                  <div className="h-14 bg-white/10 rounded" />
                </div>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="p-10 text-center rounded-2xl glass-panel border border-white/10 space-y-3">
              <MessageSquare className="w-10 h-10 text-brand-400 mx-auto opacity-60" />
              <p className="text-sm text-gray-300">{emptyText}</p>
              {feed !== 'pending' && (
                <button onClick={() => openComposer()} className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold">
                  Viết bài viết
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onRefresh={refresh}
                  onEdit={(p) => openComposer(p)}
                  onToast={showToast}
                  isAdminView={feed === 'pending'}
                  isSelectable={feed === 'pending' && isStaff}
                  isSelected={selected.includes(post.id)}
                  onSelectToggle={(id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
                />
              ))}
              {page < totalPages && (
                <div className="flex justify-center">
                  <button
                    onClick={loadMore}
                    disabled={isLoadingMore}
                    className="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/10 text-xs font-bold text-gray-200"
                  >
                    {isLoadingMore ? 'Đang tải...' : 'Xem thêm bài viết'}
                  </button>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Right: members + rules */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="glass-panel border border-white/10 rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" /> Thành viên sôi nổi (30 ngày)
            </h3>
            {!sidebar ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-white/5 animate-pulse" />)}</div>
            ) : sidebar.leaderboard.length === 0 ? (
              <p className="text-xs text-gray-500 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Chưa có ai đăng bài trong 30 ngày qua.</p>
            ) : (
              <ol className="space-y-2.5">
                {sidebar.leaderboard.map((m, idx) => {
                  const role = topRole(m.roles);
                  return (
                    <li key={m.username}>
                      <Link href={`/nguoi-dung/${m.username}`} className="flex items-center gap-2.5 group">
                        <span className={`w-5 text-center text-xs font-black ${idx === 0 ? 'text-amber-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-amber-700' : 'text-gray-500'}`}>{idx + 1}</span>
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-600/30 shrink-0 flex items-center justify-center">
                          {m.avatar_url ? <SmartImage src={m.avatar_url} alt="" className="w-full h-full object-cover" /> : <User className="w-4 h-4 text-brand-300" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-white truncate group-hover:text-brand-300">{m.display_name || m.username}</span>
                            {role && <span className={`px-1 rounded text-[9px] font-bold border ${ROLE_BADGES[role].cls}`}>{ROLE_BADGES[role].label}</span>}
                          </div>
                          <div className="text-[10px] text-gray-500">{m.posts} bài · {m.reactions} cảm xúc · {m.comments} bình luận</div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="glass-panel border border-white/10 rounded-2xl p-4 space-y-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Nội quy
            </h3>
            <ul className="text-xs text-gray-300 space-y-1.5 list-disc pl-4 leading-relaxed">
              <li>Bài viết hiện ngay khi đăng. Bài vi phạm sẽ bị Ban quản trị ẩn.</li>
              <li>Gắn đúng truyện và chuyên mục để mọi người dễ tìm.</li>
              <li>Cảnh báo spoiler ở đầu bài nếu tiết lộ nội dung mới.</li>
              <li>Fanart ghi rõ nguồn nếu không phải tác phẩm của bạn.</li>
              <li>Thấy nội dung vi phạm, hãy dùng nút Báo cáo trong bài viết.</li>
            </ul>
          </div>
        </aside>
      </div>

      <CreatePostModal
        isOpen={composer.open}
        onClose={() => setComposer({ open: false, edit: null })}
        onSuccess={refresh}
        editPostData={composer.edit}
        presetStory={story}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-zinc-900/95 border border-white/20 text-white shadow-2xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{toast}</span>
        </div>
      )}
    </div>
  );
}

export default function FandomPage() {
  return (
    <Suspense fallback={<div className="max-w-7xl mx-auto px-4 py-8"><div className="h-28 rounded-2xl bg-white/5 animate-pulse" /></div>}>
      <FandomContent />
    </Suspense>
  );
}
