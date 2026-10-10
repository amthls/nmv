'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  Search, 
  LayoutGrid,
  Bell, 
  BookOpen, 
  Menu, 
  X,
  Bookmark,
  History,
  ShieldCheck,
  User,
  LogOut,
  FilePlus,
  Settings,
  Sparkles,
  LogIn,
  Flag,
  EyeOff,
  Dices,
  MessageCircle,
  FileText,
} from 'lucide-react';
import QuickActionModal from './QuickActionModal';
import AuthModal from './auth/AuthModal';
import { useAuth } from '@/context/AuthContext';
import { useRealtime } from '@/lib/realtime';
import ThemeToggle from './common/ThemeToggle';
import StoryCaseOpening from './random/StoryCaseOpening';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

// The logo already links home, so the bar only lists the other sections
const NAV_LINKS = [
  { href: '/kham-pha', label: 'Khám phá' },
  { href: '/fandom', label: 'Fandom' },
  { href: '/nhom-dich', label: 'Nhóm dịch' },
];

// One look for every icon action in the bar: borderless, same size
const ICON_BUTTON =
  'relative w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.04] border border-white/[0.08] text-gray-300 hover:text-white hover:bg-white/[0.09] hover:border-white/20 hover:-translate-y-px transition';
const BADGE =
  'absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-[9px] font-bold text-snow flex items-center justify-center ring-2 ring-surface';

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { user, isAuthenticated, logout, openAuthModal, hasRole, authFetch } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd + K jumps to search (the bar field on wide screens, the explore page otherwise)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const input = searchInputRef.current;
      if (input && input.offsetParent !== null) input.focus();
      else router.push('/kham-pha');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
  
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
  const [unreadMessages, setUnreadMessages] = useState(0);
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
    try {
      const res = await authFetch(`${API_BASE_URL}/messages`);
      const json = await res.json();
      if (res.ok && json.success) setUnreadMessages(json.data.unread_count || 0);
    } catch (e) {}
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications();
      const timer = setInterval(fetchNotifications, 120000); // fallback; pushes arrive over the socket
      return () => clearInterval(timer);
    } else {
      setNotifications([]);
      setUnreadCount(0);
      setUnreadMessages(0);
    }
  }, [isAuthenticated]);

  useRealtime('notification', () => fetchNotifications());
  useRealtime('dm', () => fetchNotifications());

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
    if (notif.reference_type === 'draft' && notif.reference_id) {
      router.push(`/ws/de-xuat/${notif.reference_id}`); // a workspace proposal
    } else if (notif.reference_type === 'draft_edit' && notif.reference_id) {
      router.push(`/dang-chuong?draft=${notif.reference_id}`);
    } else if (notif.reference_type === 'ws_story' && notif.story_slug) {
      router.push(`/ws/truyen/${notif.story_slug}`); // a workspace task
    } else if (notif.story_slug && notif.chapter_slug) {
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
      {/* Full-width bar; inner width matches the listing pages (max-w-[1600px]) */}
      <header className="sticky top-0 z-30 w-full glass-strong !border-x-0 !border-t-0 !rounded-none">
        {/* Accent line along the bottom edge */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-fuchsia-500/70 to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-brand-500/0 via-brand-400/80 to-cyan-400/0 blur-[2px]" />
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-2 sm:gap-3 lg:gap-5">

          {/* Logo & Brand (also the way back to the home page) */}
          <Link href="/" className="flex items-center gap-3 shrink-0 group" aria-label="NovelHub - Trang chủ">
            <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 via-cyan-500 to-emerald-400 flex items-center justify-center text-snow shadow-sm shadow-cyan-500/30 group-hover:rotate-[-8deg] group-hover:scale-105 transition-transform">
              <BookOpen className="w-4 h-4" strokeWidth={2.4} />
            </div>
            <span className="hidden sm:block leading-none">
              <span className="block text-lg font-bold tracking-tight text-white">
                Novel<span className="bg-gradient-to-r from-brand-400 via-fuchsia-400 to-cyan-300 bg-clip-text text-transparent">Hub</span>
              </span>
            </span>
          </Link>

          {/* Desktop Navigation Links: the current section gets a bright gradient pill */}
          <nav className="hidden lg:flex items-center gap-0.5 text-sm font-medium">
            {NAV_LINKS.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`px-3 py-1 rounded-md transition ${
                    active
                      ? 'bg-gradient-to-r from-brand-600 via-brand-500 to-fuchsia-500 text-snow shadow-md shadow-fuchsia-500/20'
                      : 'text-gray-300 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Search Bar (Ctrl/Cmd + K focuses it) */}
          <form onSubmit={handleSearchSubmit} role="search" className="relative flex-1 max-w-md ml-auto hidden lg:block group">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand-400 transition pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              enterKeyHint="search"
              aria-label="Tìm kiếm"
              placeholder="Tìm truyện, tác giả..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-10 pr-16 rounded-lg bg-white/[0.06] border border-white/10 text-sm text-white placeholder-gray-400 focus:outline-none focus:bg-white/[0.1] focus:border-brand-400 focus:ring-2 focus:ring-brand-500/30 transition"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md border border-white/10 bg-white/[0.05] text-[10px] font-semibold text-gray-400 pointer-events-none group-focus-within:opacity-0 transition">
              Ctrl K
            </kbd>
          </form>

          {/* Actions & User Auth Section */}
          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto lg:ml-0">
            <Link href="/kham-pha" className={`${ICON_BUTTON} lg:hidden`} title="Tìm kiếm" aria-label="Tìm kiếm">
              <Search className="w-[18px] h-[18px]" />
            </Link>

            <ThemeToggle className="hidden sm:block" />

            {/* Random story case (CS2-style) */}
            <button
              onClick={() => setIsCaseOpen(true)}
              className={`${ICON_BUTTON} hidden sm:flex`}
              title="Mở hòm truyện ngẫu nhiên"
              aria-label="Mở hòm truyện ngẫu nhiên"
            >
              <Dices className="w-[18px] h-[18px] text-amber-400" />
            </button>

            {/* Messages (if authenticated) */}
            {isAuthenticated && (
              <Link href="/tin-nhan" className={ICON_BUTTON} title="Tin nhắn" aria-label="Tin nhắn">
                <MessageCircle className="w-[18px] h-[18px] text-sky-400" />
                {unreadMessages > 0 && (
                  <span className={BADGE}>{unreadMessages > 9 ? '9+' : unreadMessages}</span>
                )}
              </Link>
            )}

            {isAuthenticated && (
              <div className="relative" ref={notificationRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsNotificationOpen(!isNotificationOpen);
                    setIsUserMenuOpen(false);
                  }}
                  className={`${ICON_BUTTON} select-none active:scale-95 ${isNotificationOpen ? 'bg-white/10 text-white' : ''}`}
                  title="Thông báo"
                  aria-label="Thông báo"
                >
                  <Bell className="w-[18px] h-[18px] text-rose-400" />
                  {unreadCount > 0 && (
                    <span className={BADGE}>{unreadCount > 9 ? '9+' : unreadCount}</span>
                  )}
                </button>

                {/* Notification Dropdown Popover */}
                {isNotificationOpen && (
                  <div className="absolute right-0 mt-3 w-80 sm:w-96 rounded-2xl glass-menu overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="p-3.5 px-4 border-b border-white/10 flex items-center justify-between">
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

                    <div className="max-h-[380px] overflow-y-auto divide-y divide-white/5">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center">
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


            {/* Utilities menu: apps-grid icon, the one accent-colored button */}
            <button
              onClick={() => setIsQuickActionOpen(true)}
              className="group w-9 h-9 rounded-lg bg-gradient-to-br from-fuchsia-500 via-brand-500 to-cyan-400 text-snow flex items-center justify-center shadow-md shadow-fuchsia-500/30 hover:brightness-110 hover:-translate-y-px transition"
              title="Tiện ích"
              aria-label="Mở menu tiện ích"
            >
              <LayoutGrid className="w-[18px] h-[18px] group-hover:rotate-90 transition-transform duration-300" strokeWidth={2.2} />
            </button>

            {/* Authenticated User Menu or Login/Register Buttons */}
            {isAuthenticated && user ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="block p-[2px] rounded-full bg-gradient-to-br from-brand-400 via-fuchsia-400 to-cyan-300 hover:scale-105 transition"
                  title={user.display_name || user.username}
                  aria-label="Menu tài khoản"
                >
                  <div className="relative w-8 h-8 rounded-full overflow-hidden bg-gradient-to-tr from-brand-600 to-cyan-500 flex items-center justify-center text-snow text-sm font-bold ring-2 ring-surface-2">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt={user.username} className="w-full h-full object-cover" />
                    ) : (
                      user.username.slice(0, 2).toUpperCase()
                    )}
                  </div>
                </button>

                {/* Dropdown Menu */}
                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-60 rounded-2xl glass-menu py-2 z-50 animate-in fade-in slide-in-from-top-2">
                    <div className="px-4 py-2.5 border-b border-white/10">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-white truncate">{user.display_name || user.username}</p>
                        <span className={`text-[9px] px-1.5 rounded font-semibold shrink-0 ${getRoleBadgeStyle(getPrimaryRole())}`}>
                          {getPrimaryRole()}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 font-mono truncate">@{user.username}</p>
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
                        <span>Album & Bookmark</span>
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
                          href="/ws"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-4 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition"
                        >
                          <FileText className="w-4 h-4 text-amber-400" />
                          <span>Workspace (nháp của tôi)</span>
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
                        <Link
                          href="/da-go"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-4 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition"
                        >
                          <EyeOff className="w-4 h-4 text-rose-400" />
                          <span>Nội dung đã gỡ</span>
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
              <button
                onClick={() => openAuthModal('login')}
                className="flex items-center gap-2 h-9 px-3.5 rounded-lg text-sm font-medium text-gray-100 hover:text-white bg-white/[0.06] border border-white/10 hover:bg-white/10 transition"
              >
                <LogIn className="w-4 h-4" />
                <span>Đăng nhập</span>
              </button>
            )}

            {/* Mobile Hamburger */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className={`${ICON_BUTTON} lg:hidden`}
              aria-label="Menu"
            >
              {isMobileMenuOpen ? <X className="w-[18px] h-[18px]" /> : <Menu className="w-[18px] h-[18px]" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <div className="lg:hidden border-t border-white/10 px-4 py-4 space-y-1 animate-in slide-in-from-top-2">
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
            {[{ href: '/', label: 'Trang chủ' }, ...NAV_LINKS, { href: '/lich-su', label: 'Lịch sử đọc' }, { href: '/bookmark', label: 'Album & Bookmark' }].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5"
              >
                {label}
              </Link>
            ))}

            {/* Hidden from the bar on small screens */}
            <div className="sm:hidden pt-2 mt-2 border-t border-white/10 flex items-center gap-2">
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsCaseOpen(true);
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 text-sm text-gray-200"
              >
                <Dices className="w-4 h-4" /> Hòm truyện ngẫu nhiên
              </button>
              <ThemeToggle />
            </div>

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
