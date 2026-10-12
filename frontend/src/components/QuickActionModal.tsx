'use client';

import React, { useEffect } from 'react';
import Link from '@/components/common/Link';
import { History, Bookmark, UploadCloud, ShieldCheck, MessageSquare, FileText, LayoutGrid, X } from 'lucide-react';

interface QuickActionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Colors avoid indigo/purple/violet: the theme maps those to the brand blue, so every tile would look alike
const ACTIONS = [
  { icon: UploadCloud, title: 'Đăng bộ truyện mới', desc: 'Xuất bản Light Novel & Manga mới', href: '/dang-truyen', color: 'bg-emerald-500 shadow-emerald-500/30' },
  { icon: FileText, title: 'Đăng chương mới', desc: 'Soạn văn bản hoặc kéo thả ảnh, ZIP/CBZ', href: '/dang-chuong', color: 'bg-orange-500 shadow-orange-500/30' },
  { icon: ShieldCheck, title: 'Nhóm dịch & Workspace', desc: 'Quản lý nhóm, phân quyền, chat nội bộ', href: '/nhom-dich', color: 'bg-sky-500 shadow-sky-500/30' },
  { icon: MessageSquare, title: 'Fandom / Diễn đàn', desc: 'Đăng bài, chia sẻ ảnh, thảo luận', href: '/fandom', color: 'bg-fuchsia-500 shadow-fuchsia-500/30' },
  { icon: History, title: 'Lịch sử đọc', desc: 'Xem lại các chương đã đọc', href: '/lich-su', color: 'bg-amber-500 shadow-amber-500/30' },
  { icon: Bookmark, title: 'Đã lưu / Bookmark', desc: 'Album và chỗ đang đọc dở', href: '/bookmark', color: 'bg-teal-500 shadow-teal-500/30' },
];

export default function QuickActionModal({ isOpen, onClose }: QuickActionModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-action-title"
        className="relative w-full max-w-4xl bg-surface-2 border border-white/10 rounded-2xl p-5 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-cyan-500 text-snow flex items-center justify-center">
              <LayoutGrid className="w-[18px] h-[18px]" />
            </div>
            <div>
              <h2 id="quick-action-title" className="text-base font-bold text-white">Tiện ích</h2>
              <p className="text-xs text-gray-400">Truy cập nhanh các tính năng hay dùng</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Grid: compact rows, three per line on wide screens */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {ACTIONS.map(({ icon: Icon, title, desc, href, color }) => (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className="group flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/15 transition"
            >
              <div className={`w-10 h-10 shrink-0 rounded-xl ${color} text-snow flex items-center justify-center shadow-md group-hover:scale-110 transition-transform`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white group-hover:text-brand-400 transition-colors truncate">{title}</h3>
                <p className="text-xs text-gray-400 truncate mt-0.5">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
