'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { 
  ArrowLeft, 
  Clock, 
  User, 
  BookOpen, 
  Share2, 
  ChevronRight, 
  AlertCircle,
  Trash2,
  Edit3,
  X,
  Check,
  MoreVertical
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import SmartPostGallery from '@/components/fandom/SmartPostGallery';
import CommentSection from '@/components/comments/CommentSection';
import ReportButton from '@/components/common/ReportButton';
import { useAuth } from '@/context/AuthContext';
import RichTextEditor from '@/components/common/RichTextEditor';
import RichContent from '@/components/common/RichContent';
import { hasRichContent } from '@/lib/richText';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;
  const { user, isAuthenticated, hasRole, authFetch, openAuthModal } = useAuth();

  const [post, setPost] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reactions, setReactions] = useState<{ [key: string]: number }>({});
  const [userReaction, setUserReaction] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Edit post state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const emojiList = [
    { type: 'like', emoji: '👍', name: 'Thích' },
    { type: 'love', emoji: '❤️', name: 'Yêu thích' },
    { type: 'haha', emoji: '😆', name: 'Haha' },
    { type: 'wow', emoji: '😮', name: 'Wow' },
    { type: 'sad', emoji: '😢', name: 'Buồn' },
    { type: 'angry', emoji: '😡', name: 'Phẫn nộ' },
  ];

  useEffect(() => {
    async function fetchPost() {
      if (!slug) return;
      setIsLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/posts/${slug}`, { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setPost(json.data);
            setReactions(json.data.reaction_summary || {});
            setEditTitle(json.data.title || '');
            setEditContent(json.data.content || '');
          }
        }
      } catch (e) {
        console.error('Failed to load post detail:', e);
      } finally {
        setIsLoading(false);
      }
    }
    fetchPost();
  }, [slug]);

  const isAuthor = Boolean(user && post && user.id === post.user_id);
  const isAdminOrMod = hasRole('admin', 'mod');
  const canModify = isAuthor || isAdminOrMod;

  const handleReact = async (reactionType: string) => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!post) return;
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
        }
      }
    } catch (e) {
      console.error('Failed to react:', e);
    }
  };

  const handleShare = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim() || !hasRichContent(editContent)) {
      alert('Vui lòng nhập đầy đủ tiêu đề và nội dung bài viết.');
      return;
    }
    setIsSaving(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/posts/${post.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          content: editContent.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPost((prev: any) => ({
          ...prev,
          title: editTitle.trim(),
          content: editContent.trim(),
        }));
        setIsEditing(false);
      } else {
        alert(data.message || 'Chỉnh sửa bài viết thất bại.');
      }
    } catch (err: any) {
      alert('Lỗi kết nối máy chủ: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePost = async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa bài viết này? Hành động này không thể hoàn tác.')) {
      return;
    }
    setIsDeleting(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/posts/${post.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert('Đã xóa bài viết thành công!');
        router.push('/fandom');
      } else {
        alert(data.message || 'Xóa bài viết thất bại.');
      }
    } catch (err: any) {
      alert('Lỗi kết nối: ' + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-6 animate-pulse">
        <div className="h-6 bg-white/5 rounded w-1/4" />
        <div className="h-10 bg-white/5 rounded-2xl w-3/4" />
        <div className="h-48 bg-white/5 rounded-3xl" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-4 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-brand-400" />
        <h2 className="text-xl font-bold text-white">Không tìm thấy bài viết này</h2>
        <Link href="/fandom" className="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold">
          Quay lại Fandom
        </Link>
      </div>
    );
  }

  const allImages: string[] = post.images && Array.isArray(post.images) && post.images.length > 0
    ? post.images
    : (post.cover_image_url ? [post.cover_image_url] : []);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 pb-24">
      
      {/* Back Button */}
      <div>
        <Link
          href="/fandom"
          className="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại Diễn Đàn Fandom</span>
        </Link>
      </div>

      {/* Main Post Article Card */}
      <article className="rounded-3xl glass-panel border border-white/10 p-6 sm:p-8 space-y-6 bg-[#12121e]/90 shadow-2xl relative">
        
        {/* Author Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-brand-600/30 border border-brand-500/30 shrink-0 flex items-center justify-center">
              {post.author_avatar ? (
                <SmartImage src={post.author_avatar} alt={post.author_name} className="w-full h-full object-cover" />
              ) : (
                <User className="w-6 h-6 text-brand-300" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Link href={`/nguoi-dung/${post.author_username}`} className="text-sm font-bold text-white hover:text-brand-400 transition">{post.author_name || post.author_username}</Link>
                {post.author_roles?.includes('admin') && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase">Admin</span>
                )}
                {post.author_roles?.includes('mod') && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase">Mod</span>
                )}
                {post.author_roles?.includes('translator') && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase">Dịch Giả</span>
                )}
              </div>
              <div className="text-xs text-gray-400 flex items-center gap-1.5 mt-0.5">
                <Clock className="w-3.5 h-3.5" />
                <span>{new Date(post.published_at).toLocaleDateString('vi-VN')} lúc {new Date(post.published_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition relative"
              title="Chia sẻ bài viết"
            >
              <Share2 className="w-4 h-4" />
              {copied && (
                <span className="absolute -top-7 right-0 text-[10px] px-2 py-0.5 rounded-md bg-brand-600 text-white font-bold whitespace-nowrap shadow-md">
                  Đã sao chép!
                </span>
              )}
            </button>

            {!isAuthor && post?.id && (
              <ReportButton
                targetType="post"
                targetId={post.id}
                className="p-2 rounded-xl text-gray-400 hover:text-amber-400 hover:bg-white/5 transition flex items-center gap-1.5 text-xs font-semibold"
              />
            )}

            {/* Menu Actions (Only for Author or Admin/Mod) */}
            {canModify && (
              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition"
                  title="Tùy chọn bài viết"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {showMenu && (
                  <div className="absolute right-0 mt-1 w-44 rounded-xl bg-[#1c1c2e] border border-white/10 shadow-xl py-1 z-20">
                    <button
                      onClick={() => {
                        setIsEditing(true);
                        setShowMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-brand-600/20 hover:text-brand-300 flex items-center gap-2"
                    >
                      <Edit3 className="w-3.5 h-3.5" /> Chỉnh sửa bài viết
                    </button>
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        handleDeletePost();
                      }}
                      disabled={isDeleting}
                      className="w-full text-left px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> {isDeleting ? 'Đang xóa...' : 'Xóa bài viết'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Title & Body or Edit Mode */}
        {isEditing ? (
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1">Tiêu đề bài viết:</label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1">Nội dung bài viết:</label>
              <RichTextEditor value={editContent} onChange={setEditContent} minHeight={200} />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setIsEditing(false)}
                className="px-3.5 py-1.5 rounded-xl bg-white/10 text-gray-300 text-xs font-semibold hover:bg-white/15 transition flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> Hủy
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="px-4 py-1.5 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-500 transition flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" /> {isSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Title */}
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">
              {post.title}
            </h1>

            {/* Linked Story Banner */}
            {post.story_title && post.story_slug && (
              <Link
                href={`/truyen/${post.story_slug}`}
                className="flex items-center gap-4 p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-brand-500/30 transition-all group"
              >
                <div className="w-14 h-20 rounded-xl overflow-hidden bg-gray-900 shrink-0 shadow-md">
                  <SmartImage src={post.story_cover} alt={post.story_title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" /> Bộ truyện liên quan
                  </span>
                  <h3 className="text-sm font-bold text-white group-hover:text-brand-300 transition-colors truncate mt-0.5">
                    {post.story_title}
                  </h3>
                  <div className="text-xs text-gray-400 truncate mt-0.5">
                    Nhấn để xem chi tiết tác phẩm
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-brand-400 group-hover:translate-x-1 transition-all shrink-0 mr-2" />
              </Link>
            )}

            {/* Body Content */}
            <RichContent content={post.content} className="text-sm sm:text-base text-gray-200" />

            {/* Smart Multi-Image Gallery Grid */}
            {allImages.length > 0 && (
              <SmartPostGallery images={allImages} altTitle={post.title} />
            )}
          </>
        )}

        {/* Reactions Section */}
        <div className="pt-6 border-t border-white/10 space-y-3">
          <div className="text-xs text-gray-400 font-semibold">Cảm xúc bài viết:</div>
          <div className="flex flex-wrap items-center gap-2">
            {emojiList.map((emo) => {
              const count = reactions[emo.type] || 0;
              const isSelected = userReaction === emo.type;

              return (
                <button
                  key={emo.type}
                  onClick={() => handleReact(emo.type)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition hover:scale-105 active:scale-95 ${
                    isSelected
                      ? 'bg-brand-600/30 border-brand-500 text-brand-300 shadow-md shadow-brand-500/20'
                      : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  <span className="text-sm">{emo.emoji}</span>
                  <span>{emo.name}</span>
                  {count > 0 && <span className="font-bold text-[11px] opacity-80">({count})</span>}
                </button>
              );
            })}
          </div>
        </div>

      </article>

      {/* Thread Comments Section */}
      <div className="mt-12">
        <CommentSection
          targetType="post"
          targetId={post.id}
          title="Bình Luận Thảo Luận"
        />
      </div>

    </div>
  );
}