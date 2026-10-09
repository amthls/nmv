'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  User,
  BookOpen,
  Share2,
  AlertCircle,
  Trash2,
  Edit3,
  MoreHorizontal,
  Eye,
  Pin,
  ShieldAlert,
  EyeOff,
  FileText,
  CheckCircle2,
  MessageSquare,
  Clock,
  ArrowRight,
  Bell,
  BellOff,
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import SmartPostGallery from '@/components/fandom/SmartPostGallery';
import CreatePostModal from '@/components/fandom/CreatePostModal';
import ReactionBar from '@/components/fandom/ReactionBar';
import CommentSection from '@/components/comments/CommentSection';
import ReportButton from '@/components/common/ReportButton';
import RichContent from '@/components/common/RichContent';
import ImageLightbox from '@/components/reader/ImageLightbox';
import { useAuth } from '@/context/AuthContext';
import { PostItem } from '@/components/fandom/PostCard';
import { API_BASE_URL, REACTIONS, ROLE_BADGES, categoryOf, readJson, timeAgo, topRole } from '@/lib/fandom';

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;
  const { user, isAuthenticated, isLoading: authLoading, hasRole, authFetch } = useAuth();

  const [post, setPost] = useState<PostItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [more, setMore] = useState<PostItem[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [heroOpen, setHeroOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const fetcher = isAuthenticated ? authFetch : fetch;
      const json = await readJson(await fetcher(`${API_BASE_URL}/posts/${slug}`, { credentials: 'include' }));
      const p: PostItem = json.data;
      setPost(p);
      const moreUrl = p.story_id ? `${API_BASE_URL}/posts?story_id=${p.story_id}&limit=6` : `${API_BASE_URL}/posts?limit=6`;
      fetch(moreUrl).then(readJson).then((m) => setMore((m.data as PostItem[]).filter((x) => x.id !== p.id).slice(0, 5))).catch(() => {});
    } catch {
      setPost(null);
    } finally {
      setIsLoading(false);
    }
  }, [slug, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!authLoading) load(); }, [load, authLoading]);

  useEffect(() => {
    if (!showMenu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setShowMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showMenu]);

  const isAuthor = Boolean(user && post && user.id === post.user_id);
  const isStaff = hasRole('admin', 'mod');
  const canModify = isAuthor || isStaff;

  const action = async (path: string, init: RequestInit, after?: () => void) => {
    if (!post) return;
    setBusy(true);
    setShowMenu(false);
    try {
      const json = await readJson(await authFetch(`${API_BASE_URL}/posts/${post.id}${path}`, init));
      showToast(json.message);
      after ? after() : load();
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    if (!confirm('Xóa bài viết này? Không thể hoàn tác.')) return;
    action('', { method: 'DELETE' }, () => router.push('/fandom'));
  };
  const handleHide = () => {
    const reason = prompt('Lý do ẩn bài viết (người đăng sẽ thấy, có thể để trống):');
    if (reason === null) return;
    action('/reject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
  };
  const toggleMute = async () => {
    if (!post) return;
    try {
      const json = await readJson(await authFetch(`${API_BASE_URL}/posts/${post.id}/mute`, { method: 'POST' }));
      setPost((p) => (p ? { ...p, notifications_muted: json.muted } : p));
      showToast(json.message);
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Đã sao chép link bài viết.');
    } catch {
      prompt('Sao chép link bài viết:', window.location.href);
    }
  };

  if (isLoading || authLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 grid lg:grid-cols-12 gap-6 animate-pulse">
        <div className="lg:col-span-8 h-[480px] bg-white/5 rounded-2xl" />
        <div className="lg:col-span-4 h-64 bg-white/5 rounded-2xl" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-4 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-brand-400" />
        <h2 className="text-xl font-bold text-white">Không tìm thấy bài viết này</h2>
        <p className="text-sm text-gray-400">Bài viết có thể đã bị xóa hoặc bị ẩn.</p>
        <Link href="/fandom" className="px-4 py-2 rounded-xl bg-brand-600 text-snow text-xs font-semibold">Quay lại Fandom</Link>
      </div>
    );
  }

  const category = categoryOf(post.category);
  const role = topRole(post.author_roles);
  const images: string[] = post.images && post.images.length > 0 ? post.images : (post.cover_image_url ? [post.cover_image_url] : []);
  const status = post.is_draft ? 'draft' : post.approval_status;
  const reactions = post.reaction_summary || {};
  const reactionTotal = Number(post.reaction_count) || 0;
  const comments = Number(post.real_comment_count ?? post.comment_count ?? 0);
  const authorName = post.author_name || post.author_username;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-gray-400 min-w-0">
        <Link href="/fandom" className="inline-flex items-center gap-1.5 font-semibold hover:text-white shrink-0">
          <ArrowLeft className="w-4 h-4" /> Fandom
        </Link>
        <span>/</span>
        <Link href={`/fandom?category=${category.id}`} className="hover:text-white shrink-0">{category.label}</Link>
        <span className="hidden sm:inline">/</span>
        <span className="hidden sm:inline truncate text-gray-500">{post.title}</span>
      </nav>

      {/* Visibility notes for the author / moderators */}
      {status === 'pending' && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-sm">
          <span className="flex items-center gap-2 font-semibold"><ShieldAlert className="w-4 h-4" /> Bài đã được sửa sau khi bị ẩn, đang chờ Ban quản trị xem lại.</span>
          {isStaff && (
            <div className="flex gap-2">
              <button onClick={() => action('/approve', { method: 'POST' })} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-snow text-xs font-bold">Hiện lại</button>
              <button onClick={handleHide} disabled={busy} className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-snow text-xs font-bold">Giữ ẩn</button>
            </div>
          )}
        </div>
      )}
      {status === 'rejected' && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-sm">
          <div className="space-y-0.5">
            <div className="font-semibold flex items-center gap-2"><EyeOff className="w-4 h-4" /> Bài viết đã bị Ban quản trị ẩn</div>
            {post.rejection_reason && <div className="text-rose-200/80">Lý do: {post.rejection_reason}</div>}
          </div>
          {isAuthor && <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold">Sửa bài viết</button>}
          {isStaff && <button onClick={() => action('/approve', { method: 'POST' })} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-snow text-xs font-bold">Hiện lại</button>}
        </div>
      )}
      {status === 'draft' && (
        <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-sm">
          <span className="flex items-center gap-2 font-semibold"><FileText className="w-4 h-4" /> Bản nháp, chỉ mình bạn thấy.</span>
          {isAuthor && <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold">Tiếp tục viết & đăng</button>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ------------------------------------------------ main column */}
        <div className="lg:col-span-8 space-y-6 min-w-0">
          <article className="rounded-2xl glass-panel border border-white/10 overflow-hidden">
            {/* Single image: shown whole over a blurred copy of itself, not cropped or towering */}
            {images.length === 1 && (
              <button type="button" onClick={() => setHeroOpen(true)} className="relative block w-full h-64 sm:h-80 lg:h-[420px] bg-black overflow-hidden group">
                <SmartImage src={images[0]} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-50" />
                <SmartImage src={images[0]} alt={post.title} className="relative w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" />
              </button>
            )}

            <div className="p-5 sm:p-8 space-y-5">
              {/* Title block */}
              <header className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/fandom?category=${category.id}`} className={`px-2.5 py-0.5 rounded-full border text-xs font-semibold ${category.cls}`}>
                    {category.emoji} {category.label}
                  </Link>
                  {post.is_pinned && <span className="flex items-center gap-1 text-xs font-semibold text-amber-300"><Pin className="w-3.5 h-3.5" /> Đã ghim</span>}
                </div>
                <h1 className="text-2xl sm:text-[2rem] font-extrabold text-white leading-tight break-words">{post.title}</h1>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Link href={`/nguoi-dung/${post.author_username}`} className="w-9 h-9 rounded-full overflow-hidden bg-brand-600/30 shrink-0 flex items-center justify-center">
                      {post.author_avatar ? <SmartImage src={post.author_avatar} alt={authorName} className="w-full h-full object-cover" /> : <User className="w-4 h-4 text-brand-300" />}
                    </Link>
                    <div className="min-w-0 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/nguoi-dung/${post.author_username}`} className="font-bold text-white hover:text-brand-300 truncate">{authorName}</Link>
                        {role && <span className={`px-1.5 py-px rounded text-[10px] font-bold border ${ROLE_BADGES[role].cls}`}>{ROLE_BADGES[role].label}</span>}
                      </div>
                      <div className="text-gray-500 flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1" title={post.published_at ? new Date(post.published_at).toLocaleString('vi-VN') : ''}>
                          <Clock className="w-3 h-3" />{timeAgo(post.published_at || post.created_at)}
                        </span>
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{Number(post.view_count || 0).toLocaleString('vi-VN')}</span>
                        <a href="#binh-luan" className="flex items-center gap-1 hover:text-white"><MessageSquare className="w-3 h-3" />{comments}</a>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {isAuthenticated && status === 'approved' && (
                      <button
                        onClick={toggleMute}
                        className={`p-2 rounded-lg hover:bg-white/5 ${post.notifications_muted ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-white'}`}
                        title={post.notifications_muted
                          ? 'Đang tắt thông báo bài này. Bấm để bật lại'
                          : 'Tắt thông báo về bài này (bình luận, trả lời, cảm xúc)'}
                      >
                        {post.notifications_muted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                      </button>
                    )}
                    <button onClick={handleShare} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5" title="Sao chép link">
                      <Share2 className="w-4 h-4" />
                    </button>
                    {!isAuthor && <ReportButton targetType="post" targetId={post.id} className="p-2 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-white/5 flex items-center gap-1.5 text-xs font-semibold" />}
                    {canModify && (
                      <div ref={menuRef} className="relative">
                        <button onClick={() => setShowMenu((v) => !v)} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5" aria-label="Tùy chọn">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {showMenu && (
                          <div className="absolute right-0 mt-1 w-52 rounded-xl bg-surface-3 border border-white/15 shadow-2xl p-1 z-20 text-xs font-semibold">
                            <button onClick={() => { setShowMenu(false); setIsEditing(true); }} className="w-full text-left px-3 py-2 rounded-lg text-gray-200 hover:bg-white/10 flex items-center gap-2">
                              <Edit3 className="w-3.5 h-3.5 text-brand-400" /> Sửa bài viết
                            </button>
                            {isStaff && status === 'approved' && (
                              <>
                                <button onClick={() => action('/pin', { method: 'POST' })} className="w-full text-left px-3 py-2 rounded-lg text-gray-200 hover:bg-white/10 flex items-center gap-2">
                                  <Pin className="w-3.5 h-3.5 text-amber-400" /> {post.is_pinned ? 'Bỏ ghim' : 'Ghim lên đầu Fandom'}
                                </button>
                                {!isAuthor && (
                                  <button onClick={handleHide} className="w-full text-left px-3 py-2 rounded-lg text-amber-300 hover:bg-amber-500/10 flex items-center gap-2">
                                    <EyeOff className="w-3.5 h-3.5" /> Ẩn bài vi phạm
                                  </button>
                                )}
                              </>
                            )}
                            <button onClick={handleDelete} disabled={busy} className="w-full text-left px-3 py-2 rounded-lg text-rose-400 hover:bg-rose-500/10 flex items-center gap-2">
                              <Trash2 className="w-3.5 h-3.5" /> Xóa bài viết
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </header>

              <div className="h-px bg-white/10" />

              <RichContent content={post.content} className="text-[15px] sm:text-base text-gray-200 leading-[1.8]" />

              {images.length > 1 && <SmartPostGallery images={images} altTitle={post.title} />}

              {/* Linked story, inline on small screens (it moves to the sidebar on large ones) */}
              {post.story_title && post.story_slug && (
                <Link href={`/truyen/${post.story_slug}`} className="lg:hidden flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/10">
                  <div className="w-10 h-14 rounded-md overflow-hidden bg-gray-900 shrink-0">
                    <SmartImage src={post.story_cover} alt={post.story_title} className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Truyện được nhắc đến</span>
                    <div className="text-sm font-semibold text-white truncate">{post.story_title}</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-500" />
                </Link>
              )}
            </div>

            {/* Reactions footer */}
            {status === 'approved' && (
              <footer className="px-5 sm:px-8 py-4 border-t border-white/10 bg-black/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <ReactionBar
                  variant="wide"
                  postId={post.id}
                  myReaction={post.my_reaction || null}
                  onChange={(d) => setPost((p) => (p ? { ...p, reaction_summary: d.reaction_summary, reaction_count: d.reaction_count, my_reaction: d.my_reaction } : p))}
                />
                <span className="text-xs text-gray-400 flex items-center gap-1.5 shrink-0">
                  {reactionTotal > 0 ? (
                    <>
                      {Object.keys(reactions).filter((k) => reactions[k] > 0).sort((a, b) => reactions[b] - reactions[a]).slice(0, 3)
                        .map((k) => <span key={k}>{REACTIONS.find((r) => r.type === k)?.emoji}</span>)}
                      <span className="text-gray-300 font-semibold">{reactionTotal}</span> cảm xúc
                    </>
                  ) : 'Hãy là người đầu tiên bày tỏ cảm xúc'}
                </span>
              </footer>
            )}
          </article>

          {status === 'approved' && (
            <div id="binh-luan" className="scroll-mt-24">
              <CommentSection targetType="post" targetId={post.id} title={`Bình luận (${comments})`} />
            </div>
          )}
        </div>

        {/* ------------------------------------------------ sidebar */}
        <aside className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
          {/* Author */}
          <div className="glass-panel border border-white/10 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <Link href={`/nguoi-dung/${post.author_username}`} className="w-12 h-12 rounded-full overflow-hidden bg-brand-600/30 shrink-0 flex items-center justify-center">
                {post.author_avatar ? <SmartImage src={post.author_avatar} alt={authorName} className="w-full h-full object-cover" /> : <User className="w-5 h-5 text-brand-300" />}
              </Link>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-gray-500">Người đăng</div>
                <Link href={`/nguoi-dung/${post.author_username}`} className="text-sm font-bold text-white hover:text-brand-300 truncate block">{authorName}</Link>
                <div className="text-[11px] text-gray-500">@{post.author_username}</div>
              </div>
              <Link href={`/nguoi-dung/${post.author_username}`} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-200 shrink-0">
                Trang cá nhân
              </Link>
            </div>
          </div>

          {/* Linked story */}
          {post.story_title && post.story_slug && (
            <div className="hidden lg:block glass-panel border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5 text-brand-400" /> Truyện được nhắc đến</div>
              <Link href={`/truyen/${post.story_slug}`} className="flex gap-3 group">
                <div className="w-20 h-28 rounded-lg overflow-hidden bg-gray-900 shrink-0 ring-1 ring-white/10">
                  <SmartImage src={post.story_cover} alt={post.story_title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                </div>
                <div className="min-w-0 space-y-1">
                  <h3 className="text-sm font-bold text-white group-hover:text-brand-300 line-clamp-3">{post.story_title}</h3>
                  {post.story_author && <p className="text-xs text-gray-400 truncate">{post.story_author}</p>}
                  <span className="inline-block text-[10px] font-bold uppercase text-gray-500">{post.story_type === 'manga' ? 'Manga' : 'Light Novel'}</span>
                </div>
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <Link href={`/truyen/${post.story_slug}`} className="py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold text-center">Đọc truyện</Link>
                <Link href={`/fandom?story=${post.story_slug}`} className="py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200 text-xs font-bold text-center">Thảo luận khác</Link>
              </div>
            </div>
          )}

          {/* More posts */}
          {more.length > 0 && (
            <div className="glass-panel border border-white/10 rounded-2xl p-4 space-y-1">
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pb-1">
                {post.story_title ? 'Cùng truyện này' : 'Bài viết mới'}
              </div>
              {more.map((m) => {
                const c = categoryOf(m.category);
                const thumb = m.images?.[0] || m.cover_image_url;
                return (
                  <Link key={m.id} href={`/fandom/${m.slug}`} className="flex gap-3 p-2 -mx-2 rounded-xl hover:bg-white/5 transition">
                    {thumb && (
                      <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-900 shrink-0">
                        <SmartImage src={thumb} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-semibold text-gray-100 line-clamp-2">{m.title}</h4>
                      <p className="text-[10px] text-gray-500 mt-0.5">{c.emoji} {c.label} · {timeAgo(m.published_at)} · {Number(m.real_comment_count || 0)} bình luận</p>
                    </div>
                  </Link>
                );
              })}
              <Link href="/fandom" className="block pt-2 text-xs font-semibold text-brand-300 hover:text-brand-200">Xem tất cả trên Fandom →</Link>
            </div>
          )}
        </aside>
      </div>

      {heroOpen && images.length === 1 && (
        <ImageLightbox images={[{ src: images[0], alt: post.title }]} index={0} onIndex={() => {}} onClose={() => setHeroOpen(false)} />
      )}

      <CreatePostModal
        isOpen={isEditing}
        onClose={() => setIsEditing(false)}
        onSuccess={() => { load(); }}
        editPostData={post}
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
