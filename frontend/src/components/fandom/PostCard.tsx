'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  MessageSquare,
  MessageCircle,
  Share2,
  BookOpen,
  User,
  MoreHorizontal,
  Edit3,
  Trash2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ShieldAlert,
  Check,
  Pin,
  Eye,
  FileText,
  EyeOff,
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import SmartPostGallery from './SmartPostGallery';
import ReactionBar from './ReactionBar';
import { useAuth } from '@/context/AuthContext';
import { stripHtml } from '@/lib/richText';
import { API_BASE_URL, REACTIONS, ROLE_BADGES, categoryOf, readJson, timeAgo, topRole } from '@/lib/fandom';

export interface PostItem {
  id: string;
  user_id: string;
  title: string;
  slug: string;
  content: string;
  category?: string;
  is_pinned?: boolean;
  cover_image_url?: string;
  images?: string[];
  story_id?: string;
  story_title?: string;
  story_slug?: string;
  story_cover?: string;
  story_type?: string;
  story_author?: string;
  author_username: string;
  author_name: string;
  author_avatar?: string;
  author_roles?: string[];
  is_draft?: boolean;
  approval_status?: 'pending' | 'approved' | 'rejected' | 'draft';
  rejection_reason?: string | null;
  reaction_count: number;
  reaction_summary?: { [key: string]: number };
  my_reaction?: string | null;
  /** the viewer muted notifications about this post */
  notifications_muted?: boolean;
  real_comment_count?: number;
  comment_count?: number;
  view_count?: number | string;
  published_at: string;
  created_at?: string;
}

interface PostCardProps {
  post: PostItem;
  onRefresh?: () => void;
  onEdit?: (post: PostItem) => void;
  onToast?: (message: string) => void;
  isAdminView?: boolean;
  isSelectable?: boolean;
  isSelected?: boolean;
  onSelectToggle?: (postId: string) => void;
}

const PREVIEW_CHARS = 320;

export default function PostCard({
  post,
  onRefresh,
  onEdit,
  onToast,
  isAdminView = false,
  isSelectable = false,
  isSelected = false,
  onSelectToggle,
}: PostCardProps) {
  const { user, isAuthenticated, hasRole, authFetch } = useAuth();
  const [reactions, setReactions] = useState<Record<string, number>>(post.reaction_summary || {});
  const [totalReactions, setTotalReactions] = useState<number>(Number(post.reaction_count) || 0);
  const [myReaction, setMyReaction] = useState<string | null>(post.my_reaction || null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAuthor = isAuthenticated && !!user && user.id === post.user_id;
  const isStaff = hasRole('admin', 'mod');
  const canModify = isAuthor || isStaff;
  const toast = (m: string) => (onToast ? onToast(m) : console.info(m));

  useEffect(() => {
    if (!isMenuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setIsMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isMenuOpen]);

  const call = async (path: string, init: RequestInit = { method: 'POST' }) => {
    setIsProcessing(true);
    try {
      const json = await readJson(await authFetch(`${API_BASE_URL}/posts/${post.id}${path}`, init));
      toast(json.message);
      onRefresh?.();
    } catch (e: any) {
      toast(e.message);
    } finally {
      setIsProcessing(false);
      setIsMenuOpen(false);
    }
  };

  const handleDelete = () => {
    if (confirm(`Xóa bài viết "${post.title}"?`)) call('', { method: 'DELETE' });
  };
  const handleReject = () => {
    const reason = prompt('Lý do ẩn bài viết (người đăng sẽ thấy, có thể để trống):');
    if (reason === null) return;
    call('/reject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/fandom/${post.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Đã sao chép link bài viết.');
    } catch {
      prompt('Sao chép link bài viết:', url);
    }
  };

  const category = categoryOf(post.category);
  const role = topRole(post.author_roles);
  const text = stripHtml(post.content) || '';
  const longText = text.length > PREVIEW_CHARS;
  const images: string[] = post.images && post.images.length > 0 ? post.images : (post.cover_image_url ? [post.cover_image_url] : []);
  const comments = Number(post.real_comment_count ?? post.comment_count ?? 0);
  const status = post.is_draft ? 'draft' : post.approval_status;

  return (
    <article className={`rounded-2xl glass-panel border transition p-4 sm:p-5 space-y-3.5 relative ${
      isSelected ? 'border-brand-500 ring-2 ring-brand-500/40' : post.is_pinned ? 'border-amber-500/30' : 'border-white/10 hover:border-white/20'
    }`}>
      {/* Status banners (only the author / staff ever see non-public posts) */}
      {status === 'pending' && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-semibold">
          <span className="flex items-center gap-1.5"><ShieldAlert className="w-4 h-4" /> Đã sửa sau khi bị ẩn, chờ Ban quản trị xem lại</span>
          {isAdminView && isStaff && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => call('/approve')} disabled={isProcessing} className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-snow text-[11px] font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Hiện lại
              </button>
              <button onClick={handleReject} disabled={isProcessing} className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-snow text-[11px] font-bold flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" /> Giữ ẩn
              </button>
            </div>
          )}
        </div>
      )}
      {status === 'rejected' && (
        <div className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs space-y-0.5">
          <div className="font-semibold flex items-center gap-1.5"><EyeOff className="w-4 h-4" /> Bài viết đã bị Ban quản trị ẩn</div>
          {post.rejection_reason && <div className="text-rose-200/80">Lý do: {post.rejection_reason}</div>}
          {isAuthor && <div className="text-gray-400">Sửa lại nội dung để Ban quản trị xem xét hiện lại.</div>}
        </div>
      )}
      {status === 'draft' && (
        <div className="px-3 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-xs font-semibold flex items-center gap-1.5">
          <FileText className="w-4 h-4" /> Bản nháp, chỉ mình bạn thấy
        </div>
      )}

      {/* Author row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {isSelectable && isStaff && (
            <button
              type="button"
              onClick={() => onSelectToggle?.(post.id)}
              aria-label="Chọn bài viết"
              className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition ${
                isSelected ? 'bg-brand-600 border-brand-500 text-snow' : 'border-white/30 text-transparent hover:border-white/60'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          <Link href={`/nguoi-dung/${post.author_username}`} className="w-10 h-10 rounded-full overflow-hidden bg-brand-600/30 shrink-0 flex items-center justify-center">
            {post.author_avatar
              ? <SmartImage src={post.author_avatar} alt={post.author_name} className="w-full h-full object-cover" />
              : <User className="w-5 h-5 text-brand-300" />}
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link href={`/nguoi-dung/${post.author_username}`} className="text-sm font-bold text-white hover:text-brand-300 truncate">
                {post.author_name || post.author_username}
              </Link>
              {role && <span className={`px-1.5 py-px rounded text-[10px] font-bold border ${ROLE_BADGES[role].cls}`}>{ROLE_BADGES[role].label}</span>}
              {isAuthenticated && !isAuthor && (
                <Link href={`/tin-nhan?u=${encodeURIComponent(post.author_username)}`} className="text-gray-500 hover:text-brand-300 transition" title="Nhắn tin">
                  <MessageCircle className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>
            <div className="text-[11px] text-gray-500 flex items-center gap-1.5 flex-wrap">
              <span>{timeAgo(post.published_at || post.created_at)}</span>
              <span>·</span>
              <span className={`px-1.5 py-px rounded border text-[10px] font-semibold ${category.cls}`}>{category.emoji} {category.label}</span>
              {post.is_pinned && <span className="flex items-center gap-0.5 text-amber-300 font-semibold"><Pin className="w-3 h-3" /> Đã ghim</span>}
            </div>
          </div>
        </div>

        {canModify && (
          <div ref={menuRef} className="relative shrink-0">
            <button onClick={() => setIsMenuOpen((v) => !v)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5" aria-label="Tùy chọn">
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 top-8 z-30 w-48 bg-surface-3 border border-white/15 rounded-xl shadow-2xl p-1 text-xs font-semibold">
                {onEdit && (
                  <button onClick={() => { setIsMenuOpen(false); onEdit(post); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/10">
                    <Edit3 className="w-3.5 h-3.5 text-brand-400" /> Sửa bài viết
                  </button>
                )}
                {isStaff && post.approval_status === 'approved' && !post.is_draft && (
                  <button onClick={() => call('/pin')} disabled={isProcessing} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/10">
                    <Pin className="w-3.5 h-3.5 text-amber-400" /> {post.is_pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
                  </button>
                )}
                {isStaff && !isAuthor && post.approval_status === 'approved' && !post.is_draft && (
                  <button onClick={handleReject} disabled={isProcessing} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-amber-300 hover:bg-amber-500/10">
                    <EyeOff className="w-3.5 h-3.5" /> Ẩn bài vi phạm
                  </button>
                )}
                <button onClick={handleDelete} disabled={isProcessing} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-rose-400 hover:bg-rose-500/10">
                  <Trash2 className="w-3.5 h-3.5" /> Xóa bài viết
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Title + preview */}
      <div className="space-y-1.5">
        <Link href={`/fandom/${post.slug}`} className="block">
          <h2 className="text-base sm:text-lg font-bold text-white hover:text-brand-300 transition-colors leading-snug">{post.title}</h2>
        </Link>
        {text && (
          <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line break-words">
            {longText ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}… ` : text}
            {longText && <Link href={`/fandom/${post.slug}`} className="text-brand-300 hover:underline font-semibold">Đọc tiếp</Link>}
          </p>
        )}
      </div>

      {images.length > 0 && <SmartPostGallery images={images} altTitle={post.title} />}

      {post.story_title && post.story_slug && (
        <Link
          href={`/truyen/${post.story_slug}`}
          className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition group"
        >
          <div className="w-10 h-14 rounded-lg overflow-hidden bg-gray-900 shrink-0">
            <SmartImage src={post.story_cover} alt={post.story_title} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1"><BookOpen className="w-3 h-3" /> Truyện được nhắc đến</span>
            <h4 className="text-sm font-semibold text-white group-hover:text-brand-300 truncate">{post.story_title}</h4>
            {post.story_author && <div className="text-[11px] text-gray-400 truncate">{post.story_author}</div>}
          </div>
          <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-brand-400 shrink-0" />
        </Link>
      )}

      {/* Counters */}
      <div className="flex items-center justify-between text-[11px] text-gray-400">
        <span className="flex items-center gap-1.5">
          {totalReactions > 0 ? (
            <>
              <span className="flex -space-x-1">
                {Object.keys(reactions).filter((k) => reactions[k] > 0).sort((a, b) => reactions[b] - reactions[a]).slice(0, 3).map((k) => (
                  <span key={k} className="w-5 h-5 rounded-full bg-surface-3 border border-white/10 flex items-center justify-center text-[11px]">
                    {REACTIONS.find((r) => r.type === k)?.emoji || '👍'}
                  </span>
                ))}
              </span>
              {totalReactions}
            </>
          ) : 'Chưa có cảm xúc'}
        </span>
        <span className="flex items-center gap-3">
          <Link href={`/fandom/${post.slug}#binh-luan`} className="hover:text-white">{comments} bình luận</Link>
          {post.view_count !== undefined && <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{Number(post.view_count).toLocaleString('vi-VN')}</span>}
        </span>
      </div>

      {/* Actions */}
      {status === 'approved' && (
        <div className="pt-2.5 border-t border-white/5 flex items-center gap-2">
          <ReactionBar
            postId={post.id}
            myReaction={myReaction}
            onChange={(d) => { setReactions(d.reaction_summary || {}); setTotalReactions(Number(d.reaction_count) || 0); setMyReaction(d.my_reaction); }}
          />
          <Link
            href={`/fandom/${post.slug}#binh-luan`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold transition"
          >
            <MessageSquare className="w-3.5 h-3.5" /> Bình luận
          </Link>
          <button onClick={handleShare} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold transition">
            <Share2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Chia sẻ</span>
          </button>
        </div>
      )}
      {status !== 'approved' && onEdit && isAuthor && (
        <div className="pt-2.5 border-t border-white/5 flex justify-end">
          <button onClick={() => onEdit(post)} className="px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center gap-1.5">
            <Edit3 className="w-3.5 h-3.5" /> {status === 'draft' ? 'Tiếp tục viết' : 'Sửa bài viết'}
          </button>
        </div>
      )}
    </article>
  );
}
