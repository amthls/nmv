'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from '@/components/common/Link';
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
import { SkinIcon } from '@/components/skin/aemeath/icons';
import AuthModal from './auth/AuthModal';
import { useAuth } from '@/context/AuthContext';
import SearchBox from '@/components/SearchBox';
import { useRealtime } from '@/lib/realtime';
import ThemeToggle from './common/ThemeToggle';
import SkinPicker from './common/SkinPicker';
import StoryCaseOpening from './random/StoryCaseOpening';
import { ChibiSay } from '@/components/skin/aemeath/SkinChibi';
import { CHIBI_LINES } from '@/components/skin/aemeath/chibiLines';
import NotificationItem, { Notification, NOTIFICATION_URL } from './notifications/NotificationItem';

const BELL_TABS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'unread', label: 'Chưa đọc' },
  { id: 'group', label: 'Nhóm dịch' },
  { id: 'workspace', label: 'Workspace' },
] as const;

// The logo already links home, so the bar only lists the other sections
const NAV_LINKS = [
  { href: '/kham-pha', label: 'Khám phá' },
  { href: '/fandom', label: 'Fandom' },
  { href: '/nhom-dich', label: 'Nhóm dịch' },
];

// One look for every icon action in the bar: borderless, same size
const ICON_BUTTON =
  'relative w-11 h-11 lg:w-9 lg:h-9 rounded-lg flex items-center justify-center bg-white/[0.04] border border-white/[0.08] text-gray-300 hover:text-white hover:bg-white/[0.09] hover:border-white/20 hover:-translate-y-px transition';
const BADGE =
  'absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-[9px] font-bold text-snow flex items-center justify-center ring-2 ring-surface';

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { user, isAuthenticated, logout, openAuthModal, hasRole, authFetch } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false); // phones: slide away while scrolling down

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
  
  // Hide the bar on scroll down, bring it back on scroll up (phones only; CSS ignores it from lg)
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setHeaderHidden(y > last && y > 80);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const [isCaseOpen, setIsCaseOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false); // search suggestions showing

  // Notification state (messaging service): the badge counts what arrived since the bell was last opened
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unseenCount, setUnseenCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bellTab, setBellTab] = useState<(typeof BELL_TABS)[number]['id']>('all');
  const [unreadMessages, setUnreadMessages] = useState(0);
  const notificationRef = useRef<HTMLDivElement>(null);

  const userMenuRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async (tab = bellTab) => {
    if (!isAuthenticated) return;
    try {
      const q = tab === 'unread' ? '&unread=1' : tab === 'all' ? '' : `&category=${tab}`;
      const res = await authFetch(`${NOTIFICATION_URL}?limit=15${q}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setNotifications(json.data.notifications || []);
        setUnseenCount(json.data.unseen_count || 0);
        setUnreadCount(json.data.unread_count || 0);
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e);
    }
  };

  const fetchUnreadMessages = async () => {
    try {
      const res = await authFetch(`/api/msg/messages`);
      const json = await res.json();
      if (res.ok && json.success) setUnreadMessages(json.data.unread_count || 0);
    } catch (e) {}
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications();
      fetchUnreadMessages();
      const timer = setInterval(() => { fetchNotifications(); fetchUnreadMessages(); }, 120000); // fallback; pushes arrive over the socket
      return () => clearInterval(timer);
    } else {
      setNotifications([]);
      setUnseenCount(0);
      setUnreadCount(0);
      setUnreadMessages(0);
    }
  }, [isAuthenticated]);

  useRealtime('notification', () => fetchNotifications());
  useRealtime('dm', () => fetchUnreadMessages());

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

  const toggleBell = () => {
    const opening = !isNotificationOpen;
    setIsNotificationOpen(opening);
    setIsUserMenuOpen(false);
    if (opening && unseenCount > 0) {
      setUnseenCount(0); // opened = seen; each item stays unread until clicked
      authFetch(`${NOTIFICATION_URL}/seen`, { method: 'POST' }).catch(() => {});
    }
  };

  const switchBellTab = (tab: typeof bellTab) => {
    setBellTab(tab);
    fetchNotifications(tab);
  };

  const handleNotificationClick = async (notif: Notification) => {
    if (!notif.is_read) {
      setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      authFetch(`${NOTIFICATION_URL}/${notif.id}/read`, { method: 'PUT' }).catch(() => {});
    }
    setIsNotificationOpen(false);
    router.push(notif.link || '/thong-bao');
  };

  const handleMarkAllAsRead = async () => {
    try {
      await authFetch(`${NOTIFICATION_URL}/read-all`, { method: 'PUT' });
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

  const menuOpen = isUserMenuOpen || isNotificationOpen || isQuickActionOpen || isMobileMenuOpen || isSearchOpen || isMobileSearchOpen;
  return (
    <>
      {/* Full-width bar; inner width matches the listing pages (max-w-[1600px]) */}
      <header className={`sticky top-0 ${menuOpen ? 'z-50' : 'z-30'} ${headerHidden && !menuOpen ? '-translate-y-full lg:translate-y-0' : ''} transition-transform duration-200 w-full glass-strong !border-x-0 !border-t-0 !rounded-none`}>
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
          <SearchBox
            inputRef={searchInputRef}
            onOpenChange={setIsSearchOpen}
            className="flex-1 max-w-md ml-auto hidden lg:block"
            inputClassName="w-full h-9 pl-10 pr-16 rounded-lg bg-white/[0.06] border border-white/10 text-sm text-white placeholder-gray-400 focus:outline-none focus:bg-white/[0.1] focus:border-brand-400 focus:ring-2 focus:ring-brand-500/30 transition"
            hint={
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md border border-white/10 bg-white/[0.05] text-[10px] font-semibold text-gray-400 pointer-events-none group-focus-within:opacity-0 transition">
                Ctrl K
              </kbd>
            }
          />

          {/* Actions & User Auth Section */}
          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto lg:ml-0">
            <button
              type="button"
              onClick={() => {
                setIsMobileSearchOpen((v) => !v);
                setIsMobileMenuOpen(false);
                setTimeout(() => mobileSearchRef.current?.focus(), 0);
              }}
              className={`${ICON_BUTTON} lg:hidden`}
              title="Tìm kiếm"
              aria-label="Tìm kiếm"
              aria-expanded={isMobileSearchOpen}
            >
              <SkinIcon lucide={Search} ae="search" className="w-[18px] h-[18px]" />
            </button>

            <ThemeToggle className="hidden sm:block" />
            <SkinPicker className="hidden sm:block" />

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
                  onClick={toggleBell}
                  className={`${ICON_BUTTON} select-none active:scale-95 ${isNotificationOpen ? 'bg-white/10 text-white' : ''}`}
                  title="Thông báo"
                  aria-label={unseenCount > 0 ? `Thông báo (${unseenCount} mới)` : 'Thông báo'}
                  aria-expanded={isNotificationOpen}
                >
                  <Bell className="w-[18px] h-[18px] text-rose-400" />
                  {unseenCount > 0 && (
                    <span className={BADGE}>{unseenCount > 9 ? '9+' : unseenCount}</span>
                  )}
                </button>

                {/* Notification Dropdown Popover */}
                {isNotificationOpen && (
                  <div className="absolute right-0 mt-3 w-80 sm:w-96 rounded-2xl glass-menu overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="p-3.5 px-4 pb-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-brand-400" />
                        <span className="text-sm font-bold text-white">Thông báo</span>
                        {unreadCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-brand-500/20 border border-brand-500/30 text-[10px] text-brand-300 font-semibold">
                            {unreadCount} chưa đọc
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
                    <div className="px-3 pb-2.5 flex gap-1 border-b border-white/10" role="tablist">
                      {BELL_TABS.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="tab"
                          aria-selected={bellTab === t.id}
                          onClick={() => switchBellTab(t.id)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${
                            bellTab === t.id ? 'bg-white text-surface' : 'text-gray-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    <div className="max-h-[380px] overflow-y-auto divide-y divide-white/5">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center">
                          <ChibiSay pose="sit" mood="sleepy" size={72} line={CHIBI_LINES.notifyEmpty[0]} />
                          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3 text-brand-400 [html.skin-aemeath_&]:hidden">
                            <Bell className="w-6 h-6" />
                          </div>
                          <p className="text-sm font-semibold text-white">
                            {bellTab === 'all' ? 'Bạn chưa có thông báo nào' : 'Không có thông báo nào ở đây'}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">Khi có chương mới hoặc tương tác, thông báo sẽ hiển thị tại đây.</p>
                        </div>
                      ) : (
                        notifications.map((n) => <NotificationItem key={n.id} n={n} onOpen={handleNotificationClick} compact />)
                      )}
                    </div>
                    <Link
                      href="/thong-bao"
                      onClick={() => setIsNotificationOpen(false)}
                      className="block text-center text-xs font-semibold text-brand-400 hover:text-brand-300 py-2.5 border-t border-white/10 hover:bg-white/5 transition"
                    >
                      Xem tất cả và cài đặt
                    </Link>
                  </div>
                )}
              </div>
            )}


            {/* Utilities menu: apps-grid icon, the one accent-colored button */}
            <button
              onClick={() => setIsQuickActionOpen(true)}
              className="group w-11 h-11 lg:w-9 lg:h-9 rounded-lg bg-gradient-to-br from-fuchsia-500 via-brand-500 to-cyan-400 text-snow flex items-center justify-center shadow-md shadow-fuchsia-500/30 hover:brightness-110 hover:-translate-y-px transition"
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
                  className="block p-[6px] lg:p-[2px] rounded-full bg-gradient-to-br from-brand-400 via-fuchsia-400 to-cyan-300 hover:scale-105 transition"
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
                className="flex items-center gap-2 h-11 lg:h-9 px-3.5 rounded-lg text-sm font-medium text-gray-100 hover:text-white bg-white/[0.06] border border-white/10 hover:bg-white/10 transition"
              >
                <LogIn className="w-4 h-4" />
                <span>Đăng nhập</span>
              </button>
            )}

            {/* Mobile Hamburger */}
            <button
              onClick={() => { setIsMobileMenuOpen(!isMobileMenuOpen); setIsMobileSearchOpen(false); }}
              className={`${ICON_BUTTON} lg:hidden`}
              aria-label="Menu"
            >
              {isMobileMenuOpen ? <X className="w-[18px] h-[18px]" /> : <Menu className="w-[18px] h-[18px]" />}
            </button>
          </div>
        </div>

        {/* Phone search: full-width row under the bar */}
        {isMobileSearchOpen && (
          <div className="lg:hidden border-t border-white/10 px-4 py-3">
            <SearchBox
              inputRef={mobileSearchRef}
              placeholder="Tìm truyện, tác giả..."
              onNavigate={() => setIsMobileSearchOpen(false)}
              inputClassName="w-full h-11 pl-10 pr-3 rounded-lg bg-white/5 border border-white/10 text-base text-white placeholder-gray-400 focus:outline-none focus:border-brand-500"
            />
          </div>
        )}

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <div className="lg:hidden border-t border-white/10 px-4 py-4 space-y-1 animate-in slide-in-from-top-2">
            {[...NAV_LINKS.filter((l) => l.href !== '/kham-pha'), { href: '/lich-su', label: 'Lịch sử đọc' }].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center min-h-11 px-3 rounded-lg text-base text-gray-300 hover:text-white hover:bg-white/5"
              >
                {label}
              </Link>
            ))}

            {/* Hidden from the bar on small screens */}
            <div className="pt-2 mt-2 border-t border-white/10 flex items-center gap-2 lg:hidden">
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsCaseOpen(true);
                }}
                className="flex-1 flex items-center justify-center gap-2 min-h-11 rounded-lg bg-white/5 text-sm text-gray-200"
              >
                <Dices className="w-4 h-4" /> Hòm truyện ngẫu nhiên
              </button>
              <ThemeToggle />
              <SkinPicker />
            </div>

            {!isAuthenticated && (
              <div className="pt-2 border-t border-white/10 flex gap-2">
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openAuthModal('login');
                  }}
                  className="flex-1 min-h-11 rounded-lg bg-white/10 text-white text-sm font-semibold"
                >
                  Đăng nhập
                </button>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openAuthModal('register');
                  }}
                  className="flex-1 min-h-11 rounded-lg bg-brand-600 text-snow text-sm font-semibold"
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
