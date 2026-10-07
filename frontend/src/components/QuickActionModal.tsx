'use client';

import React from 'react';
import Link from 'next/link';
import { 
  History, 
  Users, 
  Bookmark, 
  UploadCloud, 
  ShieldCheck, 
  Settings, 
  BookOpen, 
  MessageSquare,
  Sparkles,
  FileText,
  X 
} from 'lucide-react';

interface QuickActionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickActionModal({ isOpen, onClose }: QuickActionModalProps) {
  if (!isOpen) return null;

  const actions = [
    {
      icon: ShieldCheck,
      title: 'Nhóm dịch & Workspace',
      desc: 'Quản lý nhóm, phân quyền thành viên, chat nội bộ',
      href: '/nhom-dich',
      color: 'from-rose-500/20 to-rose-600/10 text-rose-400 border-rose-500/30',
    },
    {
      icon: UploadCloud,
      title: 'Đăng bộ truyện mới',
      desc: 'Xuất bản Light Novel & Manga mới lên nền tảng',
      href: '/dang-truyen',
      color: 'from-indigo-500/20 to-indigo-600/10 text-indigo-400 border-indigo-500/30',
    },
    {
      icon: FileText,
      title: 'Đăng & Soạn chương theo dòng',
      desc: 'Chèn chú thích dịch giả & ảnh minh họa tại dòng',
      href: '/dang-chuong',
      color: 'from-amber-500/20 to-amber-600/10 text-amber-400 border-amber-500/30',
    },
    {
      icon: FileText,
      title: 'Đăng truyện tranh',
      desc: 'Kéo thả cả chương: ảnh, thư mục, ZIP/CBZ',
      href: '/dang-truyen-tranh',
      color: 'from-rose-500/20 to-rose-600/10 text-rose-400 border-rose-500/30',
    },
    {
      icon: MessageSquare,
      title: 'Fandom / Diễn đàn',
      desc: 'Đăng bài viết, chia sẻ ảnh từ máy tính, thảo luận',
      href: '/fandom',
      color: 'from-cyan-500/20 to-cyan-600/10 text-cyan-400 border-cyan-500/30',
    },
    {
      icon: History,
      title: 'Lịch sử đọc',
      desc: 'Xem lại các chương & mốc thời gian đã đọc',
      href: '/lich-su',
      color: 'from-blue-500/20 to-blue-600/10 text-blue-400 border-blue-500/30',
    },
    {
      icon: Bookmark,
      title: 'Đã lưu / Bookmark',
      desc: 'Đánh dấu chương và đoạn đọc dở',
      href: '/bookmark',
      color: 'from-purple-500/20 to-purple-600/10 text-purple-400 border-purple-500/30',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-2xl bg-glass border border-white/10 rounded-2xl p-6 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-brand-500/20 text-brand-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Menu Tiện Ích Nhanh</h2>
              <p className="text-xs text-gray-400">Truy cập nhanh tất cả tính năng của nền tảng</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {actions.map((action, idx) => {
            const Icon = action.icon;
            return (
              <Link
                key={idx}
                href={action.href}
                onClick={onClose}
                className="group flex items-start gap-3.5 p-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 transition-all hover:scale-[1.02]"
              >
                <div className={`p-2.5 rounded-xl bg-gradient-to-br ${action.color} border shadow-inner shrink-0 group-hover:scale-110 transition-transform`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-white group-hover:text-brand-400 transition-colors">
                    {action.title}
                  </h3>
                  <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">
                    {action.desc}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
