'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  MessageSquare, 
  Send, 
  Heart, 
  Reply, 
  CornerDownRight, 
  ShieldCheck, 
  Sparkles, 
  Smile, 
  X,
  User,
  Clock,
  Pencil,
  Trash2
} from 'lucide-react';
import ReportButton from '@/components/common/ReportButton';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export interface CommentItem {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  roles?: string[];
  content: string;
  like_count: number;
  reply_count: number;
  created_at: string;
  is_edited?: boolean;
  replies?: CommentItem[];
}

interface CommentSectionProps {
  targetType: 'story' | 'chapter' | 'post';
  targetId: string;
  title?: string;
}

export default function CommentSection({
  targetType,
  targetId,
  title = 'Bình Luận & Thảo Luận',
}: CommentSectionProps) {
  const { user, hasRole, authFetch } = useAuth();
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [replyTarget, setReplyTarget] = useState<{ id: string; name: string } | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [likedMap, setLikedMap] = useState<{ [key: string]: boolean }>({});

  const fetchComments = useCallback(async () => {
    if (!targetId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/comments?target_type=${targetType}&target_id=${targetId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setComments(json.data || []);
        }
      }
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    } finally {
      setIsLoading(false);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSubmitComment = async (parentId?: string, contentText?: string) => {
    const textToSend = contentText || (parentId ? replyText : newComment);
    if (!textToSend || !textToSend.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          parent_id: parentId || null,
          content: textToSend.trim(),
        }),
      });

      if (res.ok) {
        if (parentId) {
          setReplyText('');
          setReplyTarget(null);
        } else {
          setNewComment('');
        }
        await fetchComments();
      }
    } catch (err) {
      console.error('Failed to submit comment:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleLike = async (commentId: string) => {
    try {
      const res = await authFetch(`${API_BASE_URL}/comments/${commentId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setLikedMap(prev => ({ ...prev, [commentId]: json.liked }));
          setComments(prev => updateCommentLikes(prev, commentId, json.like_count));
        }
      }
    } catch (err) {}
  };

  const startEdit = (comment: CommentItem) => {
    setActionError(null);
    setEditingId(comment.id);
    setEditText(comment.content);
  };

  const handleSaveEdit = async (commentId: string) => {
    if (!editText.trim()) return;
    setActionError(null);
    try {
      const res = await authFetch(`${API_BASE_URL}/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText.trim() }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setEditingId(null);
        await fetchComments();
      } else {
        setActionError(json.message || 'Sửa bình luận thất bại.');
      }
    } catch (err: any) {
      setActionError('Lỗi kết nối: ' + err.message);
    }
  };

  const handleDeleteComment = async (commentId: string, hasReplies: boolean) => {
    const warn = hasReplies ? 'Bình luận này có trả lời, các trả lời cũng sẽ bị xóa. ' : '';
    if (!confirm(`${warn}Bạn có chắc muốn xóa bình luận này?`)) return;
    setActionError(null);
    try {
      const res = await authFetch(`${API_BASE_URL}/comments/${commentId}`, { method: 'DELETE' });
      const json = await res.json();
      if (res.ok && json.success) {
        await fetchComments();
      } else {
        setActionError(json.message || 'Xóa bình luận thất bại.');
      }
    } catch (err: any) {
      setActionError('Lỗi kết nối: ' + err.message);
    }
  };

  const updateCommentLikes = (list: CommentItem[], id: string, newCount: number): CommentItem[] => {
    return list.map(c => {
      if (c.id === id) {
        return { ...c, like_count: newCount };
      }
      if (c.replies && c.replies.length > 0) {
        return { ...c, replies: updateCommentLikes(c.replies, id, newCount) };
      }
      return c;
    });
  };

  const formatTimeAgo = (dateStr: string) => {
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
      return <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase">Admin</span>;
    }
    if (roles.includes('mod')) {
      return <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase">Mod</span>;
    }
    if (roles.includes('translator')) {
      return <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase">Dịch Giả</span>;
    }
    return <span className="px-1.5 py-0.2 rounded text-[9px] font-medium bg-white/10 text-gray-400">Thành viên</span>;
  };

  const renderCommentItem = (comment: CommentItem, isReply = false) => {
    const isLiked = likedMap[comment.id];
    const isMine = Boolean(user && user.id === comment.user_id);
    const canDelete = isMine || hasRole('admin', 'mod');
    const isEditing = editingId === comment.id;

    return (
      <div key={comment.id} className={`space-y-3 ${isReply ? 'ml-6 sm:ml-10 pt-3 border-l-2 border-brand-500/20 pl-4' : 'pt-4 border-t border-white/5'}`}>
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-600/30 border border-brand-500/30 shrink-0 flex items-center justify-center">
            {comment.avatar_url ? (
              <img src={comment.avatar_url} alt={comment.display_name} className="w-full h-full object-cover" />
            ) : (
              <User className="w-4 h-4 text-brand-300" />
            )}
          </div>

          {/* Comment Bubble */}
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-white hover:text-brand-400 transition cursor-pointer">
                {comment.display_name || comment.username}
              </span>
              {getRoleBadge(comment.roles)}
              <span className="text-[10px] text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTimeAgo(comment.created_at)}
                {comment.is_edited && <span className="italic">(đã chỉnh sửa)</span>}
              </span>
            </div>

            {/* Content text */}
            {isEditing ? (
              <div className="pt-1 space-y-2">
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full p-3 rounded-xl bg-[#141422] border border-white/10 text-xs text-white focus:outline-none focus:border-brand-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveEdit(comment.id)}
                    disabled={!editText.trim()}
                    className="px-3.5 h-8 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-[11px] font-bold transition"
                  >
                    Lưu
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3.5 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-bold transition"
                  >
                    Hủy
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-line break-words pt-0.5">
                {comment.content}
              </p>
            )}

            {/* Actions (Like, Reply) */}
            <div className="flex items-center gap-4 pt-1.5 text-[11px] text-gray-400">
              <button
                onClick={() => handleToggleLike(comment.id)}
                className={`flex items-center gap-1 transition ${
                  isLiked ? 'text-rose-400 font-bold' : 'hover:text-rose-400'
                }`}
              >
                <Heart className={`w-3.5 h-3.5 ${isLiked ? 'fill-rose-400 text-rose-400' : ''}`} />
                <span>{comment.like_count > 0 ? comment.like_count : 'Thích'}</span>
              </button>

              <button
                onClick={() => setReplyTarget({ id: comment.id, name: comment.display_name || comment.username })}
                className="flex items-center gap-1 hover:text-brand-400 transition"
              >
                <Reply className="w-3.5 h-3.5" />
                <span>Trả lời</span>
              </button>

              {isMine && !isEditing && (
                <button onClick={() => startEdit(comment)} className="flex items-center gap-1 hover:text-cyan-400 transition">
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Sửa</span>
                </button>
              )}

              {canDelete && (
                <button
                  onClick={() => handleDeleteComment(comment.id, Boolean(comment.replies && comment.replies.length))}
                  className="flex items-center gap-1 hover:text-rose-400 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Xóa</span>
                </button>
              )}

              {!isMine && <ReportButton targetType="comment" targetId={comment.id} variant="icon" />}
            </div>

            {/* Inline Reply Input */}
            {replyTarget?.id === comment.id && (
              <div className="pt-3 space-y-2 animate-in fade-in">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span className="flex items-center gap-1">
                    <CornerDownRight className="w-3 h-3 text-brand-400" />
                    Đang trả lời <strong className="text-brand-300">@{replyTarget.name}</strong>
                  </span>
                  <button 
                    onClick={() => setReplyTarget(null)}
                    className="text-gray-500 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={`Trả lời @${replyTarget.name}...`}
                    className="flex-1 h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment(comment.id)}
                  />
                  <button
                    onClick={() => handleSubmitComment(comment.id)}
                    disabled={!replyText.trim() || isSubmitting}
                    className="px-3.5 h-9 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Nested Replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="space-y-3">
            {comment.replies.map(rep => renderCommentItem(rep, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="p-6 sm:p-8 rounded-3xl glass-panel border border-white/10 space-y-6">
      
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-brand-600/20 text-brand-400 border border-brand-500/20">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">{title}</h3>
            <p className="text-[11px] text-gray-400">{comments.length} bình luận đóng góp</p>
          </div>
        </div>

        <div className="text-xs text-gray-400 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-brand-400" />
          <span>Văn minh & Lịch sự</span>
        </div>
      </div>

      {/* Main Comment Box */}
      <div className="space-y-3">
        <div className="relative">
          <textarea
            rows={3}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Chia sẻ cảm nghĩ, dự đoán cốt truyện hoặc gửi lời động viên tới nhóm dịch..."
            className="w-full p-3.5 rounded-2xl bg-[#141422] border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 resize-none transition"
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="text-[11px] text-gray-500">
            {newComment.length} / 1000 ký tự
          </div>

          <button
            onClick={() => handleSubmitComment()}
            disabled={!newComment.trim() || isSubmitting}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 disabled:opacity-40 text-white font-bold text-xs shadow-lg shadow-brand-500/25 flex items-center gap-2 transition"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Gửi Bình Luận</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold">
          {actionError}
        </div>
      )}

      {/* Comments List */}
      <div className="space-y-4 pt-2">
        {isLoading ? (
          <div className="space-y-4 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-white/5" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/5 rounded w-1/4" />
                  <div className="h-4 bg-white/5 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <div className="p-8 text-center text-xs text-gray-500 space-y-1">
            <MessageSquare className="w-6 h-6 text-gray-600 mx-auto mb-2" />
            <div>Chưa có bình luận nào.</div>
            <div>Hãy là người đầu tiên để lại cảm nghĩ của bạn!</div>
          </div>
        ) : (
          comments.map(c => renderCommentItem(c))
        )}
      </div>

    </section>
  );
}
