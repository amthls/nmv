'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BookOpen, ArrowLeft, Lock, LogIn } from 'lucide-react';
import StoryForm from '@/components/story/StoryForm';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';

function CreateStoryContent() {
  const searchParams = useSearchParams();
  const preselectedGroupId = searchParams?.get('group_id') || '';
  const { isAuthenticated, isLoading: isAuthLoading, openAuthModal } = useAuth();

  if (isAuthLoading) {
    return (
      <PageLoader label="Đang kiểm tra quyền đăng truyện..." />
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
          Bạn cần đăng nhập tài khoản để xuất bản tác phẩm và quản lý quyền chủ thầu bộ truyện.
        </p>
        <button
          onClick={() => openAuthModal('login')}
          className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm shadow-lg shadow-brand-500/25 transition flex items-center justify-center gap-2 mx-auto"
        >
          <LogIn className="w-4 h-4" />
          Đăng nhập ngay
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 pb-24">

      <div>
        <Link
          href="/nhom-dich"
          className="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại Nhóm Dịch</span>
        </Link>
      </div>

      <div className="p-6 sm:p-8 rounded-3xl border border-brand-500/20 bg-[#141420] bg-gradient-to-r from-brand-950/60 via-[#161626] to-[#0F0F17] space-y-2 shadow-xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-bold">
          <BookOpen className="w-3.5 h-3.5 text-brand-400" /> Hệ Thống Xuất Bản Tác Phẩm Mới
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
          Đăng Bộ Truyện Mới Lên NovelHub
        </h1>
        <p className="text-xs sm:text-sm text-gray-300">
          Tạo bộ truyện mới, thiết lập nhóm dịch quản lý, tải ảnh bìa sắc nét và phân loại thể loại chi tiết!
        </p>
      </div>

      <StoryForm mode="create" preselectedGroupId={preselectedGroupId} />
    </div>
  );
}

export default function CreateStoryPage() {
  return (
    <Suspense fallback={<PageLoader label="Đang tải biểu mẫu..." />}>
      <CreateStoryContent />
    </Suspense>
  );
}
