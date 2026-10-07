'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  Search, 
  Plus, 
  Bell, 
  BookOpen, 
  Menu, 
  X,
  Bookmark,
  History,
  ShieldCheck,
  User,
  LogOut,
  ChevronDown,
  FilePlus,
  Settings,
  Sparkles,
  LogIn,
  UserPlus,
  Flag,
  ImagePlus,
  Dices
} from 'lucide-react';
import QuickActionModal from './QuickActionModal';
import AuthModal from './auth/AuthModal';
import { useAuth } from '@/context/AuthContext';
import ThemeToggle from './common/ThemeToggle';
import StoryCaseOpening from './random/StoryCaseOpening';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function Navbar() {
  const router = useRouter();
  const { user, isAuthenticated, logout, openAuthModal, hasRole, authFetch } = useAuth();
  
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const [isCaseOpen, setIsCaseOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    setIsMobileMenuOpen(false);
    router.push(q ? `/kham-pha?q=${encodeURIComponent(q)}` : '/kham-pha');
  };

  // Notification state
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notificationRef = useRef<HTMLDivElement>(null);

  const userMenuRef = useRef<HTMLDivElement>(null);

  // Fetch notifications
  const fetchNotifications = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/notifications`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setNotifications(json.data.notifications || []);
          setUnreadCount(json.data.unread_count || 0);
        }
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications();
      const timer = setInterval(fetchNotifications, 25000);
      return () => clearInterval(timer);
    } else {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [isAuthenticated]);

  // Handle clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setIsNotificationOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = async (notif: any) => {
    if (!notif.is_read) {
      try {
        await authFetch(`${API_BASE_URL}/notifications/${notif.id}/read`, { method: 'PUT' });
        setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n)));
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (e) {}
    }
    setIsNotificationOpen(false);
    if (notif.story_slug && notif.chapter_slug) {
      router.push(`/truyen/${notif.story_slug}/${notif.chapter_slug}`);
    } else if (notif.story_slug) {
      router.push(`/truyen/${notif.story_slug}`);
    } else if (notif.post_slug) {
      router.push(`/fandom/${notif.post_slug}`);
    } else if (notif.group_slug) {
      router.push(`/nhom-dich/${notif.group_slug}`);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await authFetch(`${API_BASE_URL}/notifications/read-all`, { method: 'PUT' });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (e) {}
  };

  const getPrimaryRole = () => {
    if (!user || !user.roles) return 'READER';
    const roles = user.roles.map((r: any) => (typeof r === 'string' ? r : r.role));
    if (roles.includes('admin')) return 'ADMIN';
    if (roles.includes('mod')) return 'MOD';
    if (roles.includes('author')) return 'AUTHOR';
    if (roles.includes('translator')) return 'TRANS';
    return 'READER';
  };

  const getRoleBadgeStyle = (role: string) => {
    switch (role.toUpperCase()) {
      case 'ADMIN':
        return 'bg-red-500/20 text-red-400 border border-red-500/30';
      case 'MOD':
        return 'bg-purple-500/20 text-purple-400 border border-purple-500/30';
      case 'AUTHOR':
        return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
      case 'TRANS':
      case 'TRANSLATOR':
        return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
      default:
        return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    }
  };

  return (
    <>
      <header className="sticky top-0 z-30 w-full glass-strong !border-x-0 !border-t-0 !rounded-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          
          {/* Logo & Brand */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-brand-600 via-brand-500 to-indigo-400 flex items-center justify-center text-snow shadow-lg shadow-brand-500/25 group-hover:scale-105 transition-transform">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="hidden sm:block">
                <span className="text-lg font-extrabold bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">
                  NovelHub
                </span>
                <span className="block text-[10px] text-brand-400 font-semibold tracking-wider uppercase -mt-1">
                  Light Novel & Manga
                </span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-1 text-sm font-medium text-gray-300">
              <Link href="/" className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/5 transition">
                Trang chủ
              </Link>
              <Link href="/kham-pha" className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/5 transition">
                Khám phá
              </Link>
              <Link href="/fandom" className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/5 transition">
                Fandom / Blog
              </Link>
              <Link href="/nhom-dich" className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/5 transition">
                Nhóm dịch
              </Link>
            </nav>
          </div>

          {/* Search Bar */}
          <div className="flex-1 max-w-md hidden sm:block">
            <form onSubmit={handleSearchSubmit} role="search" className="relative">
              <input
                type="text"
                enterKeyHint="search"
                placeholder="Tìm truyện chữ, manga, tác giả, thể loại..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-full bg-black/40 border border-white/10 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition"
              />
              <button type="submit" aria-label="Tìm kiếm" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                <Search className="w-4 h-4" />
              </button>
            </form>
          </div>

          {/* Actions & User Auth Section */}
          <div className="flex items-center gap-2.5">
            <ThemeToggle />

            {/* Random story case (CS2-style) */}
            <button
              onClick={() => setIsCaseOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-snow text-xs font-semibold shadow-md shadow-orange-500/20 hover:scale-105 transition-all"
              title="Mở hòm truyện ngẫu nhiên"
            >
              <Dices className="w-4 h-4" />
              <span className="hidden lg:inline">Random</span>
            </button>

            {/* Quick Action Popup Button (+) */}
            <button
              onClick={() => setIsQuickActionOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-snow text-xs font-semibold shadow-md shadow-brand-500/20 hover:scale-105 transition-all"
              title="Mở menu tiện ích"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden lg:inline">Tiện ích</span>
            </button>

            {/* Notifications Menu (if authenticated) */}
            {isAuthenticated && (
              <div className="relative" ref={notificationRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsNotificationOpen(!isNotificationOpen);
                    setIsUserMenuOpen(false);
                  }}
                  className={`relative p-2 rounded-xl border transition cursor-pointer select-none active:scale-95 ${
                    isNotificationOpen
                      ? 'bg-brand-600/20 border-brand-500/50 text-white'
                      : 'text-gray-300 hover:text-white bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                  title="Thông báo"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 ? (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-[10px] font-bold text-snow flex items-center justify-center ring-2 ring-surface animate-pulse">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  ) : (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-500/40"></span>
                  )}
                </button>

                {/* Notification Dropdown Popover */}
                {isNotificationOpen && (
                  <div className="absolute right-0 mt-3 w-80 sm:w-96 rounded-2xl bg-glass border border-white/15 shadow-2xl shadow-black/80 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="p-3.5 px-4 border-b border-white/10 flex items-center justify-between bg-glass">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-brand-400" />
                        <span className="text-sm font-bold text-white">Thông báo</span>
                        {unreadCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-brand-500/20 border border-brand-500/30 text-[10px] text-brand-300 font-semibold">
                            {unreadCount} mới
                          </span>
                        )}
                      </div>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllAsRead}
                          className="text-[11px] text-brand-400 hover:text-brand-300 font-medium transition cursor-pointer"
                        >
                          Đã đọc tất cả
                        </button>
                      )}
                    </div>

                    <div className="max-h-[380px] overflow-y-auto divide-y divide-white/5 bg-glass">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center bg-glass">
                          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3 text-brand-400">
                            <Bell className="w-6 h-6" />
                          </div>
                          <p className="text-sm font-semibold text-white">Bạn chưa có thông báo nào</p>
                          <p className="text-xs text-gray-400 mt-1">Khi có chương mới hoặc tương tác, thông báo sẽ hiển thị tại đây.</p>
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            onClick={() => handleNotificationClick(n)}
                            className={`p-3.5 px-4 flex items-start gap-3 transition cursor-pointer hover:bg-white/5 ${
                              !n.is_read ? 'bg-brand-500/10' : ''
                            }`}
                          >
                            <div className="relative shrink-0 mt-0.5">
                              {n.story_cover ? (
                                <img
                                  src={n.story_cover}
                                  alt=""
                                  className="w-10 h-14 object-cover rounded-lg border border-white/10 shadow-sm"
                                />
                              ) : (
                                <div className="w-9 h-9 rounded-xl bg-brand-500/15 border border-brand-500/25 flex items-center justify-center text-brand-400">
                                  <Sparkles className="w-4 h-4" />
                                </div>
                              )}
                              {!n.is_read && (
                                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-brand-500 ring-2 ring-surface-2" />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className={`text-xs leading-snug line-clamp-2 ${!n.is_read ? 'font-bold text-white' : 'text-gray-300'}`}>
                                {n.title}
                              </p>
                              <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">
                                {n.message}
                              </p>
                              <span className="text-[10px] text-gray-500 mt-1.5 block">
                                {new Date(n.created_at).toLocaleDateString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  day: '2-digit',
                                  month: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Authenticated User Menu or Login/Register Buttons */}
            {isAuthenticated && user ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-white/5 transition border border-transparent hover:border-white/10"
                >
                  <div className="relative w-8 h-8 rounded-full overflow-hidden bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-snow text-xs font-bold ring-1 ring-white/20">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt={user.username} className="w-full h-full object-cover" />
                    ) : (
                      user.username.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="hidden xl:block text-left">
                    <div className="text-xs font-semibold text-white leading-tight flex items-center gap-1">
                      <span>{user.display_name || user.username}</span>
                      <ChevronDown className="w-3 h-3 text-gray-400" />
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${getRoleBadgeStyle(getPrimaryRole())}`}>
                        {getPrimaryRole()}
                      </span>
                    </div>
                  </div>
                </button>

                {/* Dropdown Menu */}
                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-glass border border-white/10 shadow-2xl py-2 z-50 animate-in fade-in slide-in-from-top-2">
                    <div className="px-4 py-2.5 border-b border-white/10">
                      <p className="text-xs font-semibold text-white">{user.display_name || user.username}</p>
                      <p className="text-[11px] text-gray-400 font-mono truncate">@{user.username} • {user.email}</p>
                    </div>

                    <div className="py-1">
                      <Link
                        href="/tai-khoan"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition"
                      >
                        <User className="w-4 h-4 text-brand-400" />
                        <span>Hồ sơ cá nhân & Cài đặt</span>
                      </Link>
                      <Link
                        href="/bookmark"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition"
                      >
                        <Bookmark className="w-4 h-4 text-amber-400" />
                        <span>Đã lưu & Yêu thích</span>
                      </Link>
                      <Link
                        href="/lich-su"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition"
                      >
                        <History className="w-4 h-4 text-cyan-400" />
                        <span>Lịch sử đọc</span>
                      </Link>
                    </div>

                    {/* Creator actions: any signed-in reader may post (becomes author/translator once published) */}
                    {(
                      <div className="py-1 border-t border-white/10">
                        <div className="px-4 py-1 text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                          Sáng tác & Dịch thuật
                        </div>
                        <Link
                          href="/dang-truyen"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-4 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition"
                        >
                          <FilePlus className="w-4 h-4 text-emerald-400" />
                          <span>Đăng truyện mới</span>
                        </Link>
                        <Link
                          href="/dang-chuong"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-4 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition"
                        >
                          <BookOpen className="w-4 h-4 text-indigo-400" />
                          <span>Đăng chương mới</span>
                        </Link>
                        <Link
                          href="/dang-truyen-tranh"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-4 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition"
                        >
                          <ImagePlus className="w-4 h-4 text-rose-400" />
                          <span>Đăng truyện tranh</span>
                        </Link>
                      </div>
                    )}

                    {/* Moderation */}
                    {hasRole('admin', 'mod') && (
                      <div className="py-1 border-t border-white/10">
                        <Link
                          href="/bao-cao"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-4 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition"
                        >
                          <Flag className="w-4 h-4 text-amber-400" />
                          <span>Báo cáo vi phạm</span>
                        </Link>
                      </div>
                    )}

                    {/* Logout */}
                    <div className="py-1 border-t border-white/10">
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          logout();
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition text-left"
                      >
                        <LogOut className="w-4 h-4 text-red-400" />
                        <span>Đăng xuất</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openAuthModal('login')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/5 transition border border-white/10"
                >
                  <LogIn className="w-4 h-4 text-brand-400" />
                  <span>Đăng nhập</span>
                </button>
                <button
                  onClick={() => openAuthModal('register')}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold shadow-md shadow-brand-500/20 transition"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Đăng ký</span>
                </button>
              </div>
            )}

            {/* Mobile Hamburger */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 rounded-xl text-gray-300 hover:text-white hover:bg-white/5 transition"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 px-4 py-4 space-y-2 animate-in slide-in-from-top-2">
            <form onSubmit={handleSearchSubmit} role="search" className="relative mb-3">
              <input
                type="text"
                enterKeyHint="search"
                placeholder="Tìm truyện chữ, manga..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-brand-500"
              />
              <button type="submit" aria-label="Tìm kiếm" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                <Search className="w-4 h-4" />
              </button>
            </form>
            <Link 
              href="/" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5"
            >
              Trang chủ
            </Link>
            <Link 
              href="/kham-pha" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5"
            >
              Khám phá
            </Link>
            <Link 
              href="/lich-su" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5"
            >
              Lịch sử đọc
            </Link>
            <Link 
              href="/bookmark" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5"
            >
              Đã lưu & Yêu thích
            </Link>
            <Link 
              href="/fandom" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5"
            >
              Fandom / Blog
            </Link>
            <Link 
              href="/nhom-dich" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5"
            >
              Nhóm dịch
            </Link>

            {!isAuthenticated && (
              <div className="pt-2 border-t border-white/10 flex gap-2">
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openAuthModal('login');
                  }}
                  className="flex-1 py-2 rounded-lg bg-white/10 text-white text-xs font-semibold"
                >
                  Đăng nhập
                </button>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openAuthModal('register');
                  }}
                  className="flex-1 py-2 rounded-lg bg-brand-600 text-snow text-xs font-semibold"
                >
                  Đăng ký
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Quick Action Modal Popup */}
      <QuickActionModal 
        isOpen={isQuickActionOpen} 
        onClose={() => setIsQuickActionOpen(false)} 
      />

      <StoryCaseOpening isOpen={isCaseOpen} onClose={() => setIsCaseOpen(false)} />

      {/* Global Authentication Modal */}
      <AuthModal />
    </>
  );
}
