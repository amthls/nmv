'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  MessageSquare, 
  Share2, 
  BookOpen, 
  Clock, 
  User, 
  MoreHorizontal, 
  Edit3, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  ChevronRight,
  ShieldAlert,
  Check
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import SmartPostGallery from './SmartPostGallery';
import { useAuth } from '@/context/AuthContext';
import { stripHtml } from '@/lib/richText';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export interface PostItem {
  id: string;
  user_id: string;
  title: string;
  slug: string;
  content: string;
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
  reaction_count: number;
  reaction_summary?: { [key: string]: number };
  real_comment_count?: number;
  comment_count?: number;
  published_at: string;
}

interface PostCardProps {
  post: PostItem;
  onRefresh?: () => void;
  onEdit?: (post: PostItem) => void;
  isAdminView?: boolean;
  isSelectable?: boolean;
  isSelected?: boolean;
  onSelectToggle?: (postId: string) => void;
}

export default function PostCard({ 
  post, 
  onRefresh, 
  onEdit, 
  isAdminView = false,
  isSelectable = false,
  isSelected = false,
  onSelectToggle,
}: PostCardProps) {
  const { user, isAuthenticated, hasRole, authFetch, openAuthModal } = useAuth();
  
  const [reactions, setReactions] = useState<{ [key: string]: number }>(post.reaction_summary || {});
  const [totalReactions, setTotalReactions] = useState<number>(post.reaction_count || 0);
  const [userReaction, setUserReaction] = useState<string | null>(null);
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const isAuthor = isAuthenticated && !!user && user.id === post.user_id;
  const isAdminOrMod = hasRole('admin', 'mod');
  const canModify = isAuthor || isAdminOrMod;

  const emojiList = [
    { type: 'like', emoji: '👍', name: 'Thích', color: 'text-blue-400' },
    { type: 'love', emoji: '❤️', name: 'Yêu thích', color: 'text-rose-400' },
    { type: 'haha', emoji: '😆', name: 'Haha', color: 'text-amber-400' },
    { type: 'wow', emoji: '😮', name: 'Wow', color: 'text-purple-400' },
    { type: 'sad', emoji: '😢', name: 'Buồn', color: 'text-indigo-400' },
    { type: 'angry', emoji: '😡', name: 'Phẫn nộ', color: 'text-red-500' },
  ];

  const handleReact = async (reactionType: string) => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }

    try {
      const res = await authFetch(`${API_BASE_URL}/posts/${post.id}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction: reactionType }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setUserReaction(userReaction === reactionType ? null : reactionType);
          setReactions(json.data.reaction_summary || {});
          setTotalReactions(json.data.reaction_count || 0);
        }
      }
    } catch (e) {
      console.error('Error reacting to post:', e);
    } finally {
      setIsReactionPickerOpen(false);
    }
  };

  const handleDelete = async () => {
    if (!canModify) {
      alert('Bạn không có quyền xóa bài viết này.');
      return;
    }

    if (!confirm(`Bạn có chắc chắn muốn xóa bài viết "${post.title}"?`)) return;
    setIsProcessing(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/posts/${post.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        onRefresh && onRefresh();
      } else {
        const err = await res.json();
        alert(err.message || 'Xóa bài viết thất bại.');
      }
    } catch (e) {
      console.error('Failed to delete post:', e);
    } finally {
      setIsProcessing(false);
      setIsMenuOpen(false);
    }
  };

  const handleApprove = async () => {
    if (!isAdminOrMod) return;
    setIsProcessing(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/posts/${post.id}/approve`, {
        method: 'POST',
      });
      if (res.ok) {
        onRefresh && onRefresh();
      }
    } catch (e) {
      console.error('Failed to approve post:', e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!isAdminOrMod) return;
    if (!confirm('Bạn có chắc chắn muốn từ chối bài viết này?')) return;
    setIsProcessing(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/posts/${post.id}/reject`, {
        method: 'POST',
      });
      if (res.ok) {
        onRefresh && onRefresh();
      }
    } catch (e) {
      console.error('Failed to reject post:', e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleShare = () => {
    if (typeof window !== 'undefined') {
      const url = `${window.location.origin}/fandom/${post.slug}`;
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    if (!dateStr) return 'Vừa xong';
    const diffMs = new Date().getTime() - new Date(dateStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay} ngày trước`;
    if (diffHour > 0) return `${diffHour} giờ trước`;
    if (diffMin > 0) return `${diffMin} phút trước`;
    return 'Vừa xong';
  };

  const getRoleBadge = (roles?: string[]) => {
    if (!roles || roles.length === 0) return null;
    if (roles.includes('admin')) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase">Admin</span>;
    }
    if (roles.includes('mod')) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase">Mod</span>;
    }
    if (roles.includes('translator')) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase">Dịch Giả</span>;
    }
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/10 text-gray-400">Thành viên</span>;
  };

  const currentEmoji = emojiList.find((e) => e.type === userReaction);

  // Collect all images for the post
  const allImages: string[] = post.images && Array.isArray(post.images) && post.images.length > 0
    ? post.images
    : (post.cover_image_url ? [post.cover_image_url] : []);

  return (
    <article className={`rounded-3xl glass-panel border transition-all duration-300 p-5 sm:p-6 space-y-4 shadow-lg relative ${
      isSelected 
        ? 'border-brand-500 bg-[#17172b]/95 ring-2 ring-brand-500/40' 
        : 'border-white/10 hover:border-brand-500/30 bg-[#12121e]/80'
    }`}>
      
      {/* Multi-Select Checkbox for Bulk Operations (Admin/Mod only) */}
      {isSelectable && isAdminOrMod && (
        <div className="absolute top-4 left-4 z-20">
          <button
            type="button"
            onClick={() => onSelectToggle && onSelectToggle(post.id)}
            className={`w-6 h-6 rounded-lg border flex items-center justify-center transition ${
              isSelected 
                ? 'bg-brand-600 border-brand-500 text-white' 
                : 'bg-black/60 border-white/30 text-transparent hover:border-white/60'
            }`}
          >
            <Check className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Pending / Draft Warning Banner */}
      {post.approval_status === 'pending' && (
        <div className="flex items-center justify-between p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            Bài viết đang chờ Ban quản trị duyệt
          </span>
          {isAdminView && isAdminOrMod && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleApprove}
                disabled={isProcessing}
                className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition flex items-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Duyệt
              </button>
              <button
                onClick={handleReject}
                disabled={isProcessing}
                className="px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold transition flex items-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" /> Từ chối
              </button>
            </div>
          )}
        </div>
      )}

      {/* 1. Author Header */}
      <div className={`flex items-center justify-between ${isSelectable && isAdminOrMod ? 'pl-8' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-brand-600/30 border border-brand-500/30 shrink-0 flex items-center justify-center">
            {post.author_avatar ? (
              <SmartImage src={post.author_avatar} alt={post.author_name} className="w-full h-full object-cover" />
            ) : (
              <User className="w-5 h-5 text-brand-300" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Link href={`/nguoi-dung/${post.author_username}`} className="text-xs font-bold text-white hover:text-brand-400 transition">
                {post.author_name || post.author_username}
              </Link>
              {getRoleBadge(post.author_roles)}
            </div>
            <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              <span>{formatTimeAgo(post.published_at)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 relative">
          <button 
            onClick={handleShare}
            className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition relative"
            title="Chia sẻ bài viết"
          >
            <Share2 className="w-4 h-4" />
            {copied && (
              <span className="absolute -top-7 right-0 text-[10px] px-2 py-0.5 rounded-md bg-brand-600 text-white font-bold whitespace-nowrap shadow-md">
                Đã sao chép!
              </span>
            )}
          </button>

          {/* 3-Dots Menu - STRICTLY ONLY SHOWN IF USER CAN MODIFY (Author or Admin/Mod) */}
          {canModify && (
            <div className="relative">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {isMenuOpen && (
                <div 
                  className="absolute right-0 top-8 z-30 w-44 bg-[#18182a] border border-white/15 rounded-2xl shadow-2xl p-1.5 space-y-1 animate-in fade-in zoom-in-95 text-xs font-semibold"
                  onMouseLeave={() => setIsMenuOpen(false)}
                >
                  {onEdit && (
                    <button
                      onClick={() => { setIsMenuOpen(false); onEdit(post); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-gray-300 hover:text-white hover:bg-white/10 transition"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-brand-400" />
                      <span>Sửa bài viết</span>
                    </button>
                  )}

                  <button
                    onClick={handleDelete}
                    disabled={isProcessing}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa bài viết</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. Post Title & Content */}
      <div className="space-y-2">
        <Link href={`/fandom/${post.slug}`}>
          <h2 className="text-base sm:text-lg font-bold text-white hover:text-brand-400 transition-colors leading-snug">
            {post.title}
          </h2>
        </Link>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed whitespace-pre-line font-normal">
          {stripHtml(post.content)}
        </p>
      </div>

      {/* 3. Smart Multi-Image Gallery Grid */}
      {allImages.length > 0 && (
        <SmartPostGallery images={allImages} altTitle={post.title} />
      )}

      {/* 4. Linked Story Preview Card */}
      {post.story_title && post.story_slug && (
        <Link
          href={`/truyen/${post.story_slug}`}
          className="flex items-center gap-3.5 p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-brand-500/20 hover:border-brand-500/40 transition-all group"
        >
          <div className="w-12 h-16 rounded-xl overflow-hidden bg-gray-900 shrink-0 relative shadow-md">
            <SmartImage src={post.story_cover} alt={post.story_title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5" /> Bộ truyện liên quan
            </span>
            <h4 className="text-xs font-bold text-white group-hover:text-brand-300 transition-colors truncate">
              {post.story_title}
            </h4>
            <div className="text-[11px] text-gray-400 truncate mt-0.5">
              Tác giả: {post.story_author || 'Chưa rõ'}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-brand-400 group-hover:translate-x-1 transition-all shrink-0 mr-1" />
        </Link>
      )}

      {/* 5. Reactions Summary Bar */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          {totalReactions > 0 ? (
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-1">
                {Object.keys(reactions).filter(k => reactions[k] > 0).slice(0, 3).map((rKey) => {
                  const emo = emojiList.find(e => e.type === rKey);
                  return (
                    <span key={rKey} className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs shadow-sm">
                      {emo?.emoji || '👍'}
                    </span>
                  );
                })}
              </div>
              <span className="text-[11px] font-semibold text-gray-300 ml-1">
                {totalReactions} cảm xúc
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-gray-500">Hãy là người đầu tiên thả cảm xúc</span>
          )}
        </div>

        <Link 
          href={`/fandom/${post.slug}`}
          className="text-[11px] font-medium text-gray-400 hover:text-brand-300 transition flex items-center gap-1"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>{post.real_comment_count || post.comment_count || 0} bình luận</span>
        </Link>
      </div>

      {/* 6. Interactive Action Bar */}
      <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2 relative">
        <div 
          className="relative"
          onMouseEnter={() => setIsReactionPickerOpen(true)}
          onMouseLeave={() => setIsReactionPickerOpen(false)}
        >
          {isReactionPickerOpen && (
            <div className="absolute -top-12 left-0 z-20 flex items-center gap-1.5 p-1.5 rounded-full bg-[#1c1c2e] border border-white/15 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
              {emojiList.map((emo) => (
                <button
                  key={emo.type}
                  onClick={() => handleReact(emo.type)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-base hover:scale-125 transition-transform hover:bg-white/10 active:scale-95"
                  title={emo.name}
                >
                  {emo.emoji}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => handleReact(userReaction ? userReaction : 'like')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition ${
              userReaction
                ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30'
                : 'bg-white/5 hover:bg-white/10 text-gray-300'
            }`}
          >
            <span>{currentEmoji ? currentEmoji.emoji : '👍'}</span>
            <span>{currentEmoji ? currentEmoji.name : 'Thích'}</span>
          </button>
        </div>

        <Link
          href={`/fandom/${post.slug}`}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold transition"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Bình luận</span>
        </Link>

        {/* Edit Button - STRICTLY ONLY SHOWN IF USER CAN MODIFY */}
        {onEdit && canModify && (
          <button
            onClick={() => onEdit(post)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold transition"
            title="Chỉnh sửa bài viết"
          >
            <Edit3 className="w-3.5 h-3.5 text-brand-400" />
            <span className="hidden sm:inline">Sửa</span>
          </button>
        )}
      </div>

    </article>
  );
}