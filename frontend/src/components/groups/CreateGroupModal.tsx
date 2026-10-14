'use client';

import React, { useState } from 'react';
import { X, Users, Sparkles, Shield, Send, Check } from 'lucide-react';
import ImageUploadDropzone from '@/components/common/ImageUploadDropzone';
import RichTextEditor from '@/components/common/RichTextEditor';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (group?: any) => void;
  /** Có group thì là chế độ sửa hồ sơ (PUT /groups/:id); mount lại modal mỗi lần mở để điền sẵn. */
  group?: any;
}

export default function CreateGroupModal({ isOpen, onClose, onSuccess, group }: CreateGroupModalProps) {
  const { authFetch } = useAuth();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [name, setName] = useState<string>(group?.name ?? '');
  const [description, setDescription] = useState<string>(group?.description ?? '');
  const [websiteUrl, setWebsiteUrl] = useState<string>(group?.website_url ?? '');
  const [discordUrl, setDiscordUrl] = useState<string>(group?.discord_url ?? '');
  const [rules, setRules] = useState<string>(group?.rules ?? '');
  const [avatarImages, setAvatarImages] = useState<string[]>(group?.avatar_url ? [group.avatar_url] : []);
  const [bannerImages, setBannerImages] = useState<string[]>(group?.banner_url ? [group.banner_url] : []);
  const isEdit = Boolean(group);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const next: Record<string, string | null> = {
        name: name.trim(),
        description: description.trim() || null,
        website_url: websiteUrl.trim() || null,
        discord_url: discordUrl.trim() || null,
        rules: rules.trim() || null,
        avatar_url: avatarImages.length > 0 ? avatarImages[0] : null,
        banner_url: bannerImages.length > 0 ? bannerImages[0] : null,
      };
      // Sửa: chỉ gửi trường đã đổi (ô xóa trắng thành null)
      const payload = isEdit
        ? Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== ((group[k] as string | null | undefined)?.trim?.() || null)))
        : next;
      if (isEdit && Object.keys(payload).length === 0) {
        onClose();
        return;
      }
      const res = await authFetch(isEdit ? `${API_BASE_URL}/groups/${group.id}` : `${API_BASE_URL}/groups`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (res.ok) {
        setFeedbackMsg(json?.message || (isEdit ? 'Đã lưu hồ sơ nhóm' : 'Tạo nhóm dịch thành công'));
        setTimeout(() => {
          setFeedbackMsg(null);
          setName(''); setDescription(''); setWebsiteUrl(''); setDiscordUrl(''); setRules('');
          setAvatarImages([]); setBannerImages([]);
          onSuccess(json?.data);
          onClose();
        }, 1200);
      } else {
        setErrorMsg(json?.message || (isEdit ? 'Không thể lưu hồ sơ nhóm. Vui lòng thử lại.' : 'Không thể tạo nhóm dịch. Vui lòng thử lại.'));
      }
    } catch (err) {
      console.error('Failed to create group:', err);
      setErrorMsg('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in">
      <div 
        className="w-full max-w-2xl bg-glass border border-white/15 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">{isEdit ? 'Sửa hồ sơ nhóm' : 'Thành Lập Nhóm Dịch Mới'}</h3>
              <p className="text-[11px] text-gray-400">
                {isEdit ? 'Chỉ các trường bạn đổi mới được lưu' : 'Nhóm hiển thị công khai ngay, bạn là Trưởng nhóm'}
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
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Group Name */}
          <div>
            <label className="text-xs font-bold text-gray-300 mb-1 block">Tên Nhóm Dịch *</label>
            <input
              type="text"
              placeholder="e.g. Neko Translations, Hako Scanlation Team..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 font-semibold transition"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-bold text-gray-300 mb-1 block">Giới Thiệu Nhóm</label>
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Giới thiệu về tôn chỉ hoạt động, thể loại dịch chính..."
              minHeight={110}
            />
          </div>

          {/* Links (Discord / Website) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-300 mb-1 block">Discord Nhóm (Link)</label>
              <input
                type="text"
                placeholder="https://discord.gg/..."
                value={discordUrl}
                onChange={(e) => setDiscordUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-300 mb-1 block">Website / Fanpage</label>
              <input
                type="text"
                placeholder="https://facebook.com/... hoặc website"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition"
              />
            </div>
          </div>

          {/* Group Rules */}
          <div>
            <label className="text-xs font-bold text-gray-300 mb-1 block">Nội Quy & Tiêu Chuẩn Dịch</label>
            <RichTextEditor
              value={rules}
              onChange={setRules}
              placeholder="Nội quy dành cho các thành viên trong nhóm..."
              minHeight={110}
            />
          </div>

          {/* Local Upload Avatar Dropzone */}
          <ImageUploadDropzone
            images={avatarImages}
            onChange={setAvatarImages}
            maxFiles={1}
            label="Ảnh đại diện nhóm (Avatar)"
          />

          {/* Local Upload Banner Dropzone */}
          <ImageUploadDropzone
            images={bannerImages}
            onChange={setBannerImages}
            maxFiles={1}
            label="Ảnh bìa nhóm (Banner)"
          />

          {/* Action Toolbar */}
          <div className="flex items-center justify-between pt-3 border-t border-white/10">
            <span className="text-[11px] text-gray-400">
              {isEdit ? 'Đường dẫn (slug) của nhóm không đổi' : <>* Bạn sẽ tự động trở thành <strong>Trưởng nhóm (Leader)</strong> của nhóm này</>}
            </span>

            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 disabled:opacity-40 text-snow font-bold text-xs shadow-lg shadow-brand-500/25 flex items-center gap-2 transition hover:scale-105"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isEdit ? (isSubmitting ? 'Đang lưu...' : 'Lưu') : (isSubmitting ? 'Đang tạo...' : 'Tạo Nhóm Dịch')}</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
