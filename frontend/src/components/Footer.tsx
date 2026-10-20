'use client';

import React from 'react';
import Link from '@/components/common/Link';
import { BookOpen, Heart } from 'lucide-react';
import { SkinIcon } from '@/components/skin/aemeath/icons';


export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-glass text-gray-400 py-10 mt-12 lg:mt-20 pb-safe">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-snow font-bold">
              <SkinIcon lucide={BookOpen} ae="bookOpen" className="w-4 h-4" />
            </div>
            <span className="text-lg font-bold text-white">NovelHub</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Nền tảng đọc Light Novel và Manga trực tuyến hiện đại, hỗ trợ truyện chữ, truyện tranh, quản lý nhóm dịch và cộng đồng fandom.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white mb-3">Khám phá</h4>
          <ul className="space-y-2 text-xs">
            <li><Link href="/kham-pha?type=novel&sort=updated" className="hover:text-brand-400 transition">Light Novel mới</Link></li>
            <li><Link href="/kham-pha?type=manga&sort=views" className="hover:text-brand-400 transition">Manga hot</Link></li>
            <li><Link href="/nhieu-nguoi-xem" className="hover:text-brand-400 transition">Bảng xếp hạng</Link></li>
            <li><Link href="/kham-pha" className="hover:text-brand-400 transition">Tất cả thể loại</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white mb-3">Cộng đồng & Dịch giả</h4>
          <ul className="space-y-2 text-xs">
            <li><Link href="/nhom-dich" className="hover:text-brand-400 transition">Danh sách nhóm dịch</Link></li>
            <li><Link href="/dang-truyen" className="hover:text-brand-400 transition">Đăng tải truyện</Link></li>
            <li><Link href="/fandom" className="hover:text-brand-400 transition">Fandom / Blog</Link></li>
            <li><Link href="/thong-tin#noi-quy" className="hover:text-brand-400 transition">Nội quy cộng đồng</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white mb-3">Hỗ trợ & Điều khoản</h4>
          <ul className="space-y-2 text-xs">
            <li><Link href="/thong-tin#dieu-khoan" className="hover:text-brand-400 transition">Điều khoản sử dụng</Link></li>
            <li><Link href="/thong-tin#chinh-sach" className="hover:text-brand-400 transition">Chính sách bảo mật</Link></li>
            <li><Link href="/bao-cao" className="hover:text-brand-400 transition">Báo cáo vi phạm</Link></li>
            <li><Link href="/thong-tin#lien-he" className="hover:text-brand-400 transition">Liên hệ quản trị</Link></li>
          </ul>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 mt-8 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between text-xs text-gray-500 gap-2">
        <div>© 2026 NovelHub Platform. All rights reserved.</div>
        <div className="flex items-center gap-1">
          Built with <SkinIcon lucide={Heart} ae="heart" className="w-3.5 h-3.5 text-rose-500 fill-rose-500" /> for Novel & Manga lovers
        </div>
      </div>
    </footer>
  );
}
