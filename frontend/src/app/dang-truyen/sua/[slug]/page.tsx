'use client';

import React, { useEffect, useState } from 'react';
import BackLink from '@/components/common/BackLink';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Pencil, ArrowLeft, Lock, LogIn, ShieldAlert } from 'lucide-react';
import StoryForm, { StoryFormInitialValues } from '@/components/story/StoryForm';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function EditStoryPage() {
  const params = useParams();
  const slug = (params?.slug as string) || '';
  const { isAuthenticated, isLoading: isAuthLoading, openAuthModal, authFetch } = useAuth();

  const [story, setStory] = useState<StoryFormInitialValues | null>(null);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [isLoadingStory, setIsLoadingStory] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug || !isAuthenticated) return;

    async function fetchStory() {
      setIsLoadingStory(true);
      try {
        const res = await authFetch(`${API_BASE_URL}/stories/${slug}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const json = await res.json();
        if (json.success && json.data) {
          setStory(json.data);
          setCanManage(Boolean(json.data.can_manage));
        } else {
          setNotFound(true);
        }
      } catch (e) {
        setNotFound(true);
      } finally {
        setIsLoadingStory(false);
      }
    }
    fetchStory();
  }, [slug, isAuthenticated]);

  if (isAuthLoading) {
    return (
      <PageLoader label="Đang kiểm tra quyền chỉnh sửa..." />
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 rounded-3xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center mx-auto mb-5 shadow-xl">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Yêu Cầu Đăng Nhập</h2>
        <p className="text-sm text-gray-400 mb-6">
          Bạn cần đăng nhập để chỉnh sửa thông tin truyện.
        </p>
        <button
          onClick={() => openAuthModal('login')}
          className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm shadow-lg shadow-brand-500/25 transition flex items-center justify-center gap-2 mx-auto"
        >
          <LogIn className="w-4 h-4" />
          Đăng nhập ngay
        </button>
      </div>
    );
  }

  if (isLoadingStory) {
    return (
      <PageLoader label="Đang tải thông tin truyện..." />
    );
  }

  if (notFound) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center text-gray-300 text-sm">
        Không tìm thấy truyện này.
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-5 shadow-xl">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Không Có Quyền Chỉnh Sửa</h2>
        <p className="text-sm text-gray-400 mb-6">
          Chỉ chủ thầu, thành viên nhóm dịch phụ trách, cộng tác viên được chỉ định, hoặc Admin/Mod mới có thể chỉnh sửa truyện này.
        </p>
        <BackLink
          href={`/truyen/${slug}`}
          className="px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm transition inline-flex items-center justify-center gap-2 mx-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          Quay lại trang truyện
        </BackLink>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 pb-24">
      <div>
        <BackLink
          href={`/truyen/${slug}`}
          className="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại trang truyện</span>
        </BackLink>
      </div>

      <div className="p-6 sm:p-8 rounded-3xl border border-brand-500/20 bg-glass bg-gradient-to-r from-brand-950/60 via-surface-2 to-surface space-y-2 shadow-xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-bold">
          <Pencil className="w-3.5 h-3.5 text-brand-400" /> Chỉnh Sửa Thông Tin Truyện
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
          {story?.title}
        </h1>
        <p className="text-xs sm:text-sm text-gray-300">
          Cập nhật tên, tóm tắt, ảnh bìa, banner, tình trạng và thể loại của tác phẩm.
        </p>
      </div>

      {story && <StoryForm mode="edit" initialValues={story} />}
    </div>
  );
}
