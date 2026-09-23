'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Sparkles, FileEdit, Save, Check, AlertCircle } from 'lucide-react';
import SmartStorySearch from './SmartStorySearch';
import ImageUploadDropzone from '@/components/common/ImageUploadDropzone';
import { useAuth } from '@/context/AuthContext';
import RichTextEditor from '@/components/common/RichTextEditor';
import { hasRichContent } from '@/lib/richText';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editPostData?: any | null;
}

export default function CreatePostModal({
  isOpen,
  onClose,
  onSuccess,
  editPostData,
}: CreatePostModalProps) {
  const { user, isAuthenticated, authFetch, openAuthModal, hasRole } = useAuth();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync edit mode initial data
  useEffect(() => {
    if (editPostData) {
      const isAuthor = isAuthenticated && user && user.id === editPostData.user_id;
      const isAdminOrMod = hasRole('admin', 'mod');
      if (!isAuthor && !isAdminOrMod) {
        onClose();
        return;
      }
      setTitle(editPostData.title || '');
      setContent(editPostData.content || '');
      setSelectedStoryId(editPostData.story_id || '');
      
      const loadedImages = editPostData.images && Array.isArray(editPostData.images) && editPostData.images.length > 0
        ? editPostData.images
        : (editPostData.cover_image_url ? [editPostData.cover_image_url] : []);
      
      setImages(loadedImages);
    } else {
      setTitle('');
      setContent('');
      setImages([]);
      setSelectedStoryId('');
    }
    setErrorMsg(null);
  }, [editPostData, isOpen]);

  if (!isOpen || !mounted) return null;

  const handleSaveOrPublish = async (isDraft: boolean) => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }

    if (!title.trim() || !hasRichContent(content) || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const endpoint = editPostData ? `${API_BASE_URL}/posts/${editPostData.id}` : `${API_BASE_URL}/posts`;
      const method = editPostData ? 'PUT' : 'POST';

      const res = await authFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          cover_image_url: images.length > 0 ? images[0] : null,
          images: images,
          story_id: selectedStoryId || null,
          is_draft: isDraft,
        }),
      });

      const json = await res.json();

      if (res.ok && json.success) {
        setFeedbackMsg(json.message || 'Thao tác thành công');
        setTimeout(() => {
          setFeedbackMsg(null);
          onSuccess();
          onClose();
        }, 1000);
      } else {
        setErrorMsg(json.message || 'Đã xảy ra lỗi khi lưu bài viết.');
      }
    } catch (err: any) {
      console.error('Failed to save post:', err);
      setErrorMsg('Lỗi kết nối mạng: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div 
        className="w-full max-w-2xl bg-[#141422] border border-white/15 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30">
              {editPostData ? <FileEdit className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {editPostData ? 'Chỉnh Sửa Bài Viết' : 'Tạo Bài Viết / Thảo Luận Mới'}
              </h3>
              <p className="text-[11px] text-gray-400">
                Tải ảnh từ máy tính (kéo thả hoặc chọn nhiều ảnh) và gắn liên kết truyện thông minh
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Alert */}
        {feedbackMsg && (
          <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{feedbackMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form Body */}
        <div className="space-y-4">
          
          {/* Title */}
          <div>
            <input
              type="text"
              placeholder="Tiêu đề bài viết (ví dụ: Cảm nghĩ về tập mới ra mắt...)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 font-semibold transition"
              required
            />
          </div>

          {/* Smart Story Search Dropdown */}
          <SmartStorySearch
            selectedStoryId={selectedStoryId}
            onSelectStory={(story) => setSelectedStoryId(story ? story.id : '')}
            initialStory={
              editPostData && editPostData.story_id && editPostData.story_title
                ? {
                    id: editPostData.story_id,
                    title: editPostData.story_title,
                    slug: editPostData.story_slug,
                    cover_image_url: editPostData.story_cover,
                    story_type: editPostData.story_type,
                    author_name: editPostData.story_author,
                    total_chapters: 0,
                  }
                : null
            }
          />

          {/* Content */}
          <div>
            <RichTextEditor
              value={content}
              onChange={setContent}
              placeholder="Bạn đang suy nghĩ gì? Hãy chia sẻ cùng cộng đồng NovelHub..."
              minHeight={180}
            />
          </div>

          {/* Local Image Upload Dropzone */}
          <ImageUploadDropzone
            images={images}
            onChange={setImages}
            maxFiles={10}
            label="Tải ảnh từ máy tính (Kéo thả hoặc chọn nhiều ảnh)"
          />

          {/* Action Toolbar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-white/10">
            <span className="text-[11px] text-gray-500">
              * Hỗ trợ tải nhiều ảnh cùng lúc và tự động sắp xếp bố cục đẹp mắt
            </span>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              {/* Save Draft Button */}
              <button
                type="button"
                onClick={() => handleSaveOrPublish(true)}
                disabled={!title.trim() || !hasRichContent(content) || isSubmitting}
                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40 text-gray-200 hover:text-white font-bold text-xs border border-white/15 flex items-center gap-1.5 transition"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Lưu Nháp</span>
              </button>

              {/* Publish Button */}
              <button
                type="button"
                onClick={() => handleSaveOrPublish(false)}
                disabled={!title.trim() || !hasRichContent(content) || isSubmitting}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 disabled:opacity-40 text-white font-bold text-xs shadow-lg shadow-brand-500/25 flex items-center gap-2 transition hover:scale-105"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Đang gửi...' : (editPostData ? 'Cập Nhật & Gửi' : 'Đăng Bài Viết')}</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>,
    document.body
  );
}
