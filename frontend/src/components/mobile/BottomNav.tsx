'use client';

import React, { useEffect, useState } from 'react';
import Link from '@/components/common/Link';
import { usePathname } from 'next/navigation';
import { Home, Compass, Bookmark, Bell, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRealtime } from '@/lib/realtime';
import { NOTIFICATION_URL } from '@/components/notifications/NotificationItem';

const ITEMS = [
  { href: '/', label: 'Trang chủ', icon: Home },
  { href: '/kham-pha', label: 'Khám phá', icon: Compass },
  { href: '/bookmark', label: 'Tủ truyện', icon: Bookmark },
  { href: '/thong-bao', label: 'Thông báo', icon: Bell },
] as const;

const ITEM = 'relative flex-1 min-h-11 flex flex-col items-center justify-center gap-0.5 text-xs transition active:scale-95';

// The chapter reader has its own bars, the story page has its own sticky action bar, and the workspace is a desktop-style tool
const isHiddenPath = (p: string) => /^\/truyen\/[^/]+\/?/.test(p) || p === '/ws' || p.startsWith('/ws/');

export default function BottomNav() {
  const pathname = usePathname() || '/';
  const { isAuthenticated, openAuthModal, authFetch } = useAuth();
  const [unread, setUnread] = useState(0);
  const hidden = isHiddenPath(pathname);

  // tells globals.css to drop --bottom-nav-h and the body padding where the nav is not shown
  useEffect(() => {
    document.documentElement.classList.toggle('no-bnav', hidden);
    return () => document.documentElement.classList.remove('no-bnav');
  }, [hidden]);

  const fetchUnread = async () => {
    if (!isAuthenticated) return setUnread(0);
    try {
      const res = await authFetch(`${NOTIFICATION_URL}?limit=1`);
      const json = await res.json();
      if (res.ok && json.success) setUnread(json.data.unread_count || 0);
    } catch {}
  };

  useEffect(() => {
    fetchUnread();
    if (!isAuthenticated) return;
    const timer = setInterval(fetchUnread, 120000);
    return () => clearInterval(timer);
  }, [isAuthenticated, pathname === '/thong-bao']);

  useRealtime('notification', () => fetchUnread());

  if (hidden) return null;

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));
  const tone = (active: boolean) => (active ? 'text-brand-400 font-semibold' : 'text-gray-400');

  return (
    <nav
      aria-label="Điều hướng chính"
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 glass-strong !border-x-0 !border-b-0 !rounded-none pb-safe"
    >
      <div className="h-16 flex items-stretch px-1">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`${ITEM} ${tone(active)}`}>
              <span className="relative">
                <Icon className="w-6 h-6" />
                {href === '/thong-bao' && unread > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-[10px] font-bold text-snow flex items-center justify-center ring-2 ring-surface">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </span>
              {label}
            </Link>
          );
        })}
        {isAuthenticated ? (
          <Link href="/tai-khoan" aria-current={isActive('/tai-khoan') ? 'page' : undefined} className={`${ITEM} ${tone(isActive('/tai-khoan'))}`}>
            <User className="w-6 h-6" />
            Tôi
          </Link>
        ) : (
          <button type="button" onClick={() => openAuthModal('login')} className={`${ITEM} ${tone(false)}`}>
            <User className="w-6 h-6" />
            Tôi
          </button>
        )}
      </div>
    </nav>
  );
}
