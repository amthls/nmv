'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import ImageQualityPicker from '@/components/common/ImageQualityPicker';
import {
  User,
  BookOpen,
  Bookmark,
  MessageSquare,
  Users,
  Save,
  Check,
  Sliders,
  Clock,
  Edit3,
  LogIn,
  Lock,
  Shield,
  ShieldAlert,
  Search,
  LayoutDashboard,
  KeyRound,
  Calendar,
  Mail,
  BadgeCheck,
  AtSign,
  Heart,
  Library,
  ThumbsUp,
  UserPlus,
  PenSquare,
  FileText,
  ExternalLink,
  ArrowRight,
  Tag,
  History,
  Newspaper,
  Eye,
  Hourglass,
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import ImageUploadDropzone from '@/components/common/ImageUploadDropzone';
import AlbumCard from '@/components/album/AlbumCard';
import RecommenderPanel from '@/components/admin/RecommenderPanel';
import BackupPanel from '@/components/admin/BackupPanel';
import SecurityTab from '@/components/account/SecurityTab';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200';

type Tab = 'overview' | 'profile' | 'reader_settings' | 'security' | 'admin_roles';

const ROLE_INFO: Record<string, { label: string; cls: string }> = {
  admin: { label: 'Quản trị viên', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
  mod: { label: 'Điều hành viên', cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
  translator: { label: 'Dịch giả', cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  author: { label: 'Tác giả', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  reader: { label: 'Độc giả', cls: 'bg-brand-500/20 text-brand-300 border-brand-500/30' },
};
const roleInfo = (r: string) => ROLE_INFO[r] || { label: r, cls: 'bg-white/10 text-gray-300 border-white/20' };

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  approved: { label: 'Đã duyệt', cls: 'bg-emerald-500/20 text-emerald-300' },
  pending: { label: 'Chờ duyệt', cls: 'bg-amber-500/20 text-amber-300' },
  rejected: { label: 'Bị từ chối', cls: 'bg-rose-500/20 text-rose-300' },
};

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const fmtNumber = (n?: number | string | null) => Number(n || 0).toLocaleString('vi-VN');

function timeAgo(d?: string | null) {
  if (!d) return 'chưa có';
  const sec = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (sec < 60) return 'vừa xong';
  if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} giờ trước`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)} ngày trước`;
  if (sec < 86400 * 365) return `${Math.floor(sec / (86400 * 30))} tháng trước`;
  return `${Math.floor(sec / (86400 * 365))} năm trước`;
}

function fmtReadingTime(minutes: number) {
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

function StatCard({ icon: Icon, value, label, sub, color, href }: {
  icon: any; value: string; label: string; sub?: string; color: string; href?: string;
}) {
  const body = (
    <div className="h-full p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-white/20 hover:bg-white/[0.06] transition flex items-start gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-extrabold text-white leading-tight">{value}</div>
        <div className="text-xs font-semibold text-gray-300">{label}</div>
        {sub && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

function Panel({ title, icon: Icon, action, children }: {
  title: string; icon: any; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="glass-panel p-5 sm:p-6 rounded-3xl border border-white/10 bg-glass space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Icon className="w-[18px] h-[18px] text-brand-400" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
      <Icon className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs font-semibold text-gray-100 text-right break-all">{children}</span>
      </div>
    </div>
  );
}

const seeAll = (href: string, text = 'Xem tất cả') => (
  <Link href={href} className="text-xs font-semibold text-brand-400 hover:text-brand-300 flex items-center gap-1 shrink-0">
    {text} <ArrowRight className="w-3.5 h-3.5" />
  </Link>
);

export default function UserProfilePage() {
  const { isAuthenticated, isLoading: isAuthLoading, openAuthModal, authFetch, hasRole, refreshProfile } = useAuth();

  const [profile, setProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isLoading, setIsLoading] = useState(true);

  // Edit Profile Form State
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarImages, setAvatarImages] = useState<string[]>([]);
  const [bannerImages, setBannerImages] = useState<string[]>([]);

  // Reader Settings State
  const [theme, setTheme] = useState('dark');
  const [fontFamily, setFontFamily] = useState('Noto Serif');
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [readingMode, setReadingMode] = useState('scroll');
  const [notifyChapters, setNotifyChapters] = useState(true);
  const [notifyGroupEvents, setNotifyGroupEvents] = useState(true);
  const [notifyReplies, setNotifyReplies] = useState(true);
  const [notifyPostComments, setNotifyPostComments] = useState(true);
  const [notifyPostReactions, setNotifyPostReactions] = useState(true);

  // Admin User & Role Management State
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);
  const [roleActionFeedback, setRoleActionFeedback] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAdmin = hasRole('admin');

  const fetchProfile = async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/profile/me`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          const u = json.data;
          setProfile(u);
          setDisplayName(u.display_name || '');
          setBio(u.bio || '');
          setAvatarImages(u.avatar_url ? [u.avatar_url] : []);
          setBannerImages(u.banner_url ? [u.banner_url] : []);

          if (u.settings) {
            setTheme(u.settings.theme || 'dark');
            setFontFamily(u.settings.font_family || 'Noto Serif');
            setFontSize(u.settings.font_size || 18);
            setLineHeight(parseFloat(u.settings.line_height) || 1.8);
            setReadingMode(u.settings.reading_mode || 'scroll');
            setNotifyChapters(u.settings.notify_chapter_update ?? true);
            setNotifyGroupEvents(u.settings.notify_group_events ?? true);
            setNotifyReplies(u.settings.notify_comments ?? true);
            setNotifyPostComments(u.settings.notify_post_comments ?? true);
            setNotifyPostReactions(u.settings.notify_post_reactions ?? true);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load profile:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAdminUsers = async (query = '') => {
    if (!isAdmin) return;
    setAdminLoading(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/users/admin/all?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setAdminUsers(json.data || []);
        }
      }
    } catch (e) {
      console.error('Failed to load admin user list:', e);
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchProfile();
    } else {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAdmin && activeTab === 'admin_roles') {
      fetchAdminUsers(adminSearch);
    }
  }, [isAdmin, activeTab]);

  const handleRoleToggle = async (targetUserId: string, roleName: string, currentHasRole: boolean) => {
    try {
      const action = currentHasRole ? 'revoke' : 'grant';
      const res = await authFetch(`${API_BASE_URL}/users/${targetUserId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleName, action }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setRoleActionFeedback(json.message);
        setTimeout(() => setRoleActionFeedback(null), 3000);
        setAdminUsers(prev => prev.map(u => {
          if (u.id === targetUserId) {
            const currentRoles: string[] = u.roles || [];
            const newRoles = currentHasRole
              ? currentRoles.filter(r => r !== roleName)
              : [...currentRoles, roleName];
            return { ...u, roles: newRoles };
          }
          return u;
        }));
      } else {
        alert(json.message || 'Cập nhật quyền thất bại');
      }
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setFeedback(null);
    setErrorMsg(null);
    try {
      const res = await authFetch(`${API_BASE_URL}/profile/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName.trim(),
          bio: bio.trim(),
          avatar_url: avatarImages.length > 0 ? avatarImages[0] : null,
          banner_url: bannerImages.length > 0 ? bannerImages[0] : null,
        }),
      });

      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setFeedback('Đã cập nhật thông tin hồ sơ thành công!');
        fetchProfile();
        refreshProfile(); // navbar name/avatar come from the auth context
        setTimeout(() => setFeedback(null), 3000);
      } else {
        setErrorMsg(json?.message || 'Lưu hồ sơ thất bại.');
      }
    } catch (e: any) {
      setErrorMsg('Lỗi kết nối: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setFeedback(null);
    setErrorMsg(null);
    try {
      const res = await authFetch(`${API_BASE_URL}/profile/me/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme,
          font_family: fontFamily,
          font_size: fontSize,
          line_height: lineHeight,
          reading_mode: readingMode,
          notify_chapter_update: notifyChapters,
          notify_group_events: notifyGroupEvents,
          notify_comments: notifyReplies,
          notify_post_comments: notifyPostComments,
          notify_post_reactions: notifyPostReactions,
        }),
      });

      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setFeedback('Đã lưu cấu hình trải nghiệm đọc truyện mặc định!');
        fetchProfile();
        setTimeout(() => setFeedback(null), 3000);
      } else {
        setErrorMsg(json?.message || 'Lưu cấu hình thất bại.');
      }
    } catch (e: any) {
      setErrorMsg('Lỗi kết nối: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || (isAuthenticated && isLoading && !profile)) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-6 animate-pulse">
        <div className="h-72 rounded-3xl bg-white/5" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-white/5" />)}
        </div>
        <div className="h-64 rounded-3xl bg-white/5" />
      </div>
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
          Vui lòng đăng nhập để xem thông tin cá nhân, cài đặt giao diện đọc truyện và bảo mật tài khoản.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => openAuthModal('login')}
            className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm shadow-lg shadow-brand-500/25 transition flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            Đăng nhập ngay
          </button>
        </div>
      </div>
    );
  }

  const stats = profile?.stats || {};
  const roles: string[] = (profile?.roles || []).map((r: any) => (typeof r === 'string' ? r : r.role));
  const daysJoined = profile?.created_at ? Math.max(1, Math.floor((Date.now() - new Date(profile.created_at).getTime()) / 86400000)) : 0;
  const isCreator = (stats.stories_uploaded || 0) > 0 || (stats.chapters_uploaded || 0) > 0;

  const tabs: { id: Tab; label: string; icon: any; admin?: boolean }[] = [
    { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'profile', label: 'Chỉnh sửa hồ sơ', icon: User },
    { id: 'reader_settings', label: 'Cài đặt đọc truyện', icon: Sliders },
    { id: 'security', label: 'Bảo mật', icon: KeyRound },
    ...(isAdmin ? [{ id: 'admin_roles' as Tab, label: 'Phân quyền (Admin)', icon: Shield, admin: true }] : []),
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 pb-24">
      {/* 1. Profile header */}
      <div className="rounded-3xl overflow-hidden glass-panel border border-white/10 bg-glass shadow-2xl">
        <div className="h-40 sm:h-52 w-full relative bg-gradient-to-br from-brand-700/60 via-indigo-800/50 to-rose-800/40">
          {profile?.banner_url && (
            <SmartImage src={profile.banner_url} alt="Ảnh bìa" className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        </div>

        <div className="px-5 sm:px-8 pb-6 relative">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-6 -mt-14 sm:-mt-16">
            <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-3xl overflow-hidden border-4 border-surface-2 bg-gray-900 shadow-2xl shrink-0 relative z-10">
              <SmartImage
                src={profile?.avatar_url || DEFAULT_AVATAR}
                alt={profile?.display_name || profile?.username}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="flex-1 min-w-0 space-y-2 sm:pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white break-words">
                  {profile?.display_name || profile?.username}
                </h1>
                {roles.map((r) => (
                  <span key={r} className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${roleInfo(r).cls}`}>
                    {roleInfo(r).label}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                <span className="flex items-center gap-1"><AtSign className="w-3.5 h-3.5" />{profile?.username}</span>
                <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />Tham gia {fmtDate(profile?.created_at)} · {fmtNumber(daysJoined)} ngày</span>
                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Hoạt động {timeAgo(profile?.last_login_at)}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 sm:pb-1">
              {profile?.username && (
                <Link
                  href={`/nguoi-dung/${profile.username}`}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-gray-200 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Trang công khai
                </Link>
              )}
              <button
                onClick={() => setActiveTab('profile')}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold shadow-lg shadow-brand-500/20 flex items-center gap-1.5 transition"
              >
                <Edit3 className="w-3.5 h-3.5" /> Sửa hồ sơ
              </button>
            </div>
          </div>

          <p className={`mt-4 text-sm leading-relaxed max-w-3xl whitespace-pre-line ${profile?.bio ? 'text-gray-300' : 'text-gray-500 italic'}`}>
            {profile?.bio || 'Bạn chưa viết giới thiệu. Bấm "Sửa hồ sơ" để thêm vài dòng về sở thích đọc truyện của mình.'}
          </p>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <span className="text-gray-400"><b className="text-white">{fmtNumber(stats.followers_count)}</b> người theo dõi</span>
            <span className="text-gray-400"><b className="text-white">{fmtNumber(stats.following_count)}</b> đang theo dõi</span>
            <span className="text-gray-400"><b className="text-white">{fmtNumber(stats.album_saves_received)}</b> lượt lưu album của bạn</span>
          </div>
        </div>
      </div>

      {/* 2. Tabs */}
      <div className="flex gap-1.5 p-1 rounded-2xl bg-white/5 border border-white/10 overflow-x-auto w-full sm:w-fit">
        {tabs.map(({ id, label, icon: Icon, admin }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
              activeTab === id
                ? admin ? 'bg-rose-600 text-snow shadow-md' : 'bg-brand-600 text-snow shadow-md shadow-brand-500/25'
                : admin ? 'text-rose-300/80 hover:text-rose-200' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {feedback && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2">
          <Check className="w-4 h-4" />
          {feedback}
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard icon={BookOpen} color="bg-brand-500/15 text-brand-300" value={fmtNumber(stats.stories_read)} label="Truyện đã đọc" sub={`${fmtNumber(stats.chapters_read)} chương`} href="/lich-su" />
            <StatCard icon={Hourglass} color="bg-cyan-500/15 text-cyan-300" value={fmtReadingTime(stats.reading_minutes || 0)} label="Thời gian đọc" sub="Tổng thời gian trên trang đọc" />
            <StatCard icon={Library} color="bg-violet-500/15 text-violet-300" value={fmtNumber(stats.albums_count)} label="Album" sub={`Đã lưu ${fmtNumber(stats.saved_albums_count)} album khác`} href="/bookmark" />
            <StatCard icon={Heart} color="bg-rose-500/15 text-rose-300" value={fmtNumber(stats.favorites_count)} label="Đang theo dõi" sub="Truyện nhận thông báo chương mới" href="/bookmark" />
            <StatCard icon={Bookmark} color="bg-amber-500/15 text-amber-300" value={fmtNumber(stats.bookmarks_count)} label="Đoạn bookmark" sub="Đoạn văn đã ghim" href="/bookmark" />
            <StatCard icon={MessageSquare} color="bg-emerald-500/15 text-emerald-300" value={fmtNumber(stats.comments_count)} label="Bình luận" sub={`${fmtNumber(stats.comment_likes_received)} lượt thích nhận được`} />
            <StatCard icon={Users} color="bg-yellow-500/15 text-yellow-300" value={fmtNumber(stats.followers_count)} label="Người theo dõi" sub={`Bạn theo dõi ${fmtNumber(stats.following_count)} người`} />
            <StatCard icon={Newspaper} color="bg-sky-500/15 text-sky-300" value={fmtNumber(stats.posts_count)} label="Bài viết Fandom" sub={`Thành viên ${fmtNumber(stats.groups_count)} nhóm dịch`} href="/fandom" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: activity */}
            <div className="lg:col-span-2 space-y-6">
              <Panel title="Đọc gần đây" icon={History} action={seeAll('/lich-su', 'Lịch sử đọc')}>
                {(profile?.recent_reads || []).length === 0 ? (
                  <div className="py-6 text-center text-xs text-gray-400 space-y-3">
                    <p>Bạn chưa đọc truyện nào.</p>
                    <Link href="/kham-pha" className="inline-block px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold">Khám phá truyện</Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {profile.recent_reads.map((r: any) => (
                      <div key={r.story_id} className="group flex gap-3 p-2.5 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-brand-500/30 transition">
                        <Link href={`/truyen/${r.slug}`} className="w-14 h-20 rounded-xl overflow-hidden bg-gray-900 shrink-0">
                          <SmartImage src={r.cover_image_url} alt={r.title} className="w-full h-full object-cover" />
                        </Link>
                        <div className="min-w-0 flex-1 flex flex-col justify-between">
                          <div>
                            <Link href={`/truyen/${r.slug}`} className="text-sm font-bold text-white line-clamp-1 group-hover:text-brand-300">{r.title}</Link>
                            <p className="text-[11px] text-gray-400 line-clamp-1">
                              Chương {Number(r.chapter_number)}{r.total_chapters ? ` / ${r.total_chapters}` : ''} · {timeAgo(r.read_at)}
                            </p>
                          </div>
                          <Link
                            href={`/truyen/${r.slug}/${r.chapter_slug}`}
                            className="self-start text-[11px] font-bold text-emerald-300 hover:text-emerald-200 flex items-center gap-1"
                          >
                            Đọc tiếp <ArrowRight className="w-3 h-3" />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Album của tôi" icon={Library} action={seeAll('/bookmark')}>
                {(profile?.albums || []).length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-400">
                    Chưa có album. Mở một truyện và bấm "Lưu vào album" để bắt đầu.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {profile.albums.map((a: any) => <AlbumCard key={a.id} album={a} />)}
                  </div>
                )}
              </Panel>

              {isCreator && (
                <Panel title="Truyện tôi đã đăng" icon={PenSquare} action={seeAll('/dang-truyen', 'Đăng truyện mới')}>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400 -mt-1">
                    <span><b className="text-white">{fmtNumber(stats.stories_uploaded)}</b> bộ truyện</span>
                    <span><b className="text-white">{fmtNumber(stats.chapters_uploaded)}</b> chương đã đăng</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                    {(profile?.my_stories || []).map((s: any) => (
                      <Link key={s.id} href={`/truyen/${s.slug}`} className="group space-y-1.5">
                        <div className="aspect-[3/4] rounded-xl overflow-hidden bg-gray-900 relative border border-white/10">
                          <SmartImage src={s.cover_image_url} alt={s.title} className="w-full h-full object-cover group-hover:scale-105 transition" />
                          {s.approval_status && s.approval_status !== 'approved' && STATUS_INFO[s.approval_status] && (
                            <span className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${STATUS_INFO[s.approval_status].cls}`}>
                              {STATUS_INFO[s.approval_status].label}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-semibold text-gray-200 line-clamp-2 group-hover:text-brand-300">{s.title}</p>
                        <p className="text-[10px] text-gray-500 flex items-center gap-1">
                          <Eye className="w-3 h-3" />{fmtNumber(s.total_views)} · {s.total_chapters || 0} ch.
                        </p>
                      </Link>
                    ))}
                  </div>
                </Panel>
              )}
            </div>

            {/* Right: account info */}
            <div className="space-y-6">
              <Panel title="Thông tin tài khoản" icon={User}>
                <div>
                  <InfoRow icon={AtSign} label="Tên đăng nhập">@{profile?.username}</InfoRow>
                  <InfoRow icon={Mail} label="Email">
                    <span className="inline-flex items-center gap-1.5">
                      {profile?.email}
                      {profile?.email_verified
                        ? <BadgeCheck className="w-4 h-4 text-emerald-400" aria-label="Đã xác minh" />
                        : <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px]">Chưa xác minh</span>}
                    </span>
                  </InfoRow>
                  <InfoRow icon={Calendar} label="Ngày tham gia">{fmtDate(profile?.created_at)}</InfoRow>
                  <InfoRow icon={Clock} label="Đăng nhập gần nhất">
                    {profile?.last_login_at ? new Date(profile.last_login_at).toLocaleString('vi-VN') : '—'}
                  </InfoRow>
                  <InfoRow icon={Shield} label="Vai trò">{roles.map((r) => roleInfo(r).label).join(', ') || 'Độc giả'}</InfoRow>
                  <InfoRow icon={UserPlus} label="Theo dõi">
                    {fmtNumber(stats.followers_count)} người theo dõi · {fmtNumber(stats.following_count)} đang theo dõi
                  </InfoRow>
                  <InfoRow icon={ThumbsUp} label="Album được lưu">{fmtNumber(stats.album_saves_received)} lượt</InfoRow>
                </div>
              </Panel>

              <Panel title="Thể loại hay đọc" icon={Tag}>
                {(profile?.top_tags || []).length === 0 ? (
                  <p className="text-xs text-gray-400">Đọc thêm vài truyện để biết gu của bạn.</p>
                ) : (
                  <div className="space-y-2">
                    {profile.top_tags.map((t: any) => {
                      const max = profile.top_tags[0].n || 1;
                      return (
                        <Link key={t.slug} href={`/kham-pha?tags=${t.slug}`} className="block group">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-semibold text-gray-200 group-hover:text-brand-300">{t.name}</span>
                            <span className="text-gray-500">{t.n} truyện</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-indigo-400" style={{ width: `${Math.max(8, (t.n / max) * 100)}%` }} />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Panel>

              <Panel title="Nhóm dịch" icon={Users} action={seeAll('/nhom-dich', 'Tất cả nhóm')}>
                {(profile?.groups || []).length === 0 ? (
                  <p className="text-xs text-gray-400">Bạn chưa tham gia nhóm dịch nào.</p>
                ) : (
                  <div className="space-y-2">
                    {profile.groups.map((g: any) => (
                      <Link key={g.slug} href={`/nhom-dich/${g.slug}`} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition">
                        <div className="w-9 h-9 rounded-lg overflow-hidden bg-gray-900 shrink-0 border border-white/10">
                          <SmartImage src={g.avatar_url || DEFAULT_AVATAR} alt={g.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">{g.name}</p>
                          <p className="text-[11px] text-gray-500">Tham gia {fmtDate(g.joined_at)}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${g.role === 'leader' ? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-gray-300'}`}>
                          {g.role === 'leader' ? 'Trưởng nhóm' : 'Thành viên'}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Lối tắt" icon={FileText}>
                <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
                  {[
                    { href: '/lich-su', label: 'Lịch sử đọc', icon: History },
                    { href: '/bookmark', label: 'Album & Bookmark', icon: Library },
                    { href: '/dang-truyen', label: 'Đăng truyện', icon: PenSquare },
                    { href: '/dang-chuong', label: 'Đăng chương', icon: BookOpen },
                  ].map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} className="p-3 rounded-xl bg-white/[0.04] border border-white/10 hover:border-brand-500/40 text-gray-200 hover:text-white flex items-center gap-2 transition">
                      <Icon className="w-4 h-4 text-brand-400" /> {label}
                    </Link>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Profile Edit */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 glass-panel p-6 rounded-3xl border border-white/10 bg-glass space-y-5">
            <h3 className="text-lg font-bold text-white">Chỉnh sửa hồ sơ</h3>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">Tên hiển thị</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={100}
                className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-brand-500"
                placeholder="Tên bạn muốn hiển thị"
              />
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <label className="text-xs font-semibold text-gray-300">Giới thiệu</label>
                <span className="text-[11px] text-gray-500">{bio.length} ký tự</span>
              </div>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                className="w-full p-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-brand-500 resize-none"
                placeholder="Giới thiệu bản thân, thể loại yêu thích..."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5">Ảnh đại diện (Avatar)</label>
                <ImageUploadDropzone images={avatarImages} onChange={setAvatarImages} maxFiles={1} label="Tải ảnh đại diện lên" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5">Ảnh bìa (Banner)</label>
                <ImageUploadDropzone images={bannerImages} onChange={setBannerImages} maxFiles={1} label="Tải ảnh bìa cá nhân lên" />
              </div>
            </div>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-sm font-semibold shadow-lg shadow-brand-500/25 flex items-center gap-2 transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Đang lưu...' : 'Lưu thông tin'}
            </button>
          </div>

          {/* Live preview of the public card */}
          <div className="glass-panel rounded-3xl border border-white/10 bg-glass overflow-hidden self-start">
            <div className="h-24 bg-gradient-to-br from-brand-700/60 via-indigo-800/50 to-rose-800/40">
              {bannerImages[0] && <SmartImage src={bannerImages[0]} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="p-5 -mt-10 space-y-2">
              <div className="w-16 h-16 rounded-2xl overflow-hidden border-4 border-surface-2 bg-gray-900">
                <SmartImage src={avatarImages[0] || DEFAULT_AVATAR} alt="" className="w-full h-full object-cover" />
              </div>
              <p className="text-sm font-bold text-white">{displayName.trim() || profile?.username}</p>
              <p className="text-[11px] text-gray-500">@{profile?.username}</p>
              <p className="text-xs text-gray-300 line-clamp-4 whitespace-pre-line">{bio.trim() || 'Chưa có giới thiệu.'}</p>
              <p className="pt-2 text-[10px] uppercase tracking-wider text-gray-500 font-bold">Xem trước trang công khai</p>
            </div>
          </div>
        </form>
      )}

      {/* Tab: Reader Settings */}
      {activeTab === 'reader_settings' && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="glass-panel p-6 rounded-3xl border border-white/10 bg-glass space-y-6">
            <h3 className="text-lg font-bold text-white">Cấu hình trải nghiệm đọc</h3>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-3">Độ phân giải ảnh khi đọc truyện tranh</label>
              <ImageQualityPicker />
              <p className="mt-2 text-[10.5px] text-gray-500">Lưu ngay trên trình duyệt này, không cần bấm Lưu.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-3">Giao diện nền (Theme)</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { id: 'dark', name: 'Tối tiêu chuẩn', bg: 'bg-[#0d0d15]', text: 'text-snow' },
                  { id: 'sepia', name: 'Vàng ấm (Sepia)', bg: 'bg-[#fbf0d9]', text: 'text-[#5f4b32]' },
                  { id: 'light', name: 'Sáng', bg: 'bg-snow', text: 'text-ink' },
                  { id: 'midnight', name: 'Xanh đêm', bg: 'bg-[#0b1020]', text: 'text-[#dbeafe]' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    className={`p-3 rounded-2xl border flex flex-col items-center gap-2 transition ${
                      theme === t.id ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className={`w-full h-10 rounded-xl ${t.bg} flex items-center justify-center font-bold text-xs border border-white/10 ${t.text}`}>
                      Aa
                    </div>
                    <span className="text-xs text-gray-300 font-medium">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <div className="flex justify-between text-xs font-semibold text-gray-300 mb-2">
                  <span>Cỡ chữ: {fontSize}px</span>
                </div>
                <input type="range" min={14} max={32} step={1} value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full accent-brand-500" />
              </div>
              <div>
                <div className="flex justify-between text-xs font-semibold text-gray-300 mb-2">
                  <span>Khoảng cách dòng: {lineHeight}</span>
                </div>
                <input type="range" min={1.2} max={2.4} step={0.1} value={lineHeight} onChange={(e) => setLineHeight(parseFloat(e.target.value))} className="w-full accent-brand-500" />
              </div>
            </div>
            <div
              className="p-4 rounded-2xl border border-white/10 bg-black/20 text-gray-200"
              style={{ fontSize, lineHeight, fontFamily }}
            >
              Xem trước: Gió đêm thổi qua khung cửa, ánh trăng rọi xuống trang sách còn dang dở.
            </div>
            <div className="space-y-3 pt-2 border-t border-white/10">
              <label className="block text-xs font-semibold text-gray-300 pt-4">Thông báo</label>
              <p className="text-[11px] text-gray-500 -mt-1">Muốn tắt thông báo của riêng một bài viết Fandom, bấm biểu tượng chuông trên bài viết đó.</p>
              {[
                {
                  checked: notifyChapters, set: setNotifyChapters,
                  title: 'Chương mới',
                  desc: 'Khi truyện bạn theo dõi có chương mới',
                },
                {
                  checked: notifyReplies, set: setNotifyReplies,
                  title: 'Trả lời bình luận của tôi',
                  desc: 'Khi có người trả lời bình luận của bạn (trong chương truyện, trang truyện hoặc bài viết Fandom)',
                },
                {
                  checked: notifyPostComments, set: setNotifyPostComments,
                  title: 'Bình luận trên bài viết của tôi',
                  desc: 'Khi có người bình luận bài viết Fandom của bạn',
                },
                {
                  checked: notifyPostReactions, set: setNotifyPostReactions,
                  title: 'Cảm xúc trên bài viết của tôi',
                  desc: 'Khi có người thả cảm xúc vào bài viết Fandom của bạn',
                },
                {
                  checked: notifyGroupEvents, set: setNotifyGroupEvents,
                  title: 'Hoạt động nhóm dịch',
                  desc: 'Yêu cầu gia nhập, kết quả duyệt, được thêm vào nhóm, nhóm được duyệt hoặc bị từ chối',
                },
              ].map((opt) => (
                <label key={opt.title} className="flex items-start gap-3 p-3 rounded-2xl bg-white/5 border border-white/10 cursor-pointer hover:border-white/20 transition">
                  <input
                    type="checkbox"
                    checked={opt.checked}
                    onChange={(e) => opt.set(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-brand-500"
                  />
                  <span className="text-xs">
                    <span className="block font-semibold text-white">{opt.title}</span>
                    <span className="text-gray-400">{opt.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-sm font-semibold shadow-lg shadow-brand-500/25 flex items-center gap-2 transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Đang lưu...' : 'Lưu cấu hình đọc'}
            </button>
          </div>
        </form>
      )}

      {activeTab === 'security' && <SecurityTab />}

      {/* Tab: Admin Role Assignment */}
      {isAdmin && activeTab === 'admin_roles' && (
        <div className="space-y-6">
          <BackupPanel />
          <RecommenderPanel />
          <div className="glass-panel p-6 rounded-3xl border border-rose-500/30 bg-glass space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Shield className="w-5 h-5 text-rose-400" /> Phân Quyền & Quản Lý Thành Viên
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Chức năng dành cho Admin: Cấp hoặc thu hồi quyền Moderator (Mod), Dịch giả hoặc Tác giả cho các tài khoản người dùng.
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  placeholder="Tìm theo tên, username..."
                  value={adminSearch}
                  onChange={(e) => setAdminSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      fetchAdminUsers(adminSearch);
                    }
                  }}
                  className="w-full h-10 pl-9 pr-3 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-rose-500"
                />
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {roleActionFeedback && (
              <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>{roleActionFeedback}</span>
              </div>
            )}

            {adminLoading ? (
              <div className="py-12 text-center text-xs text-gray-400 animate-pulse">
                Đang tải danh sách người dùng...
              </div>
            ) : adminUsers.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400">
                Không tìm thấy người dùng nào phù hợp với từ khóa.
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                {adminUsers.map((u) => {
                  const userRoles: string[] = u.roles || [];
                  const isUserAdmin = userRoles.includes('admin');
                  const isUserMod = userRoles.includes('mod');
                  const isUserTranslator = userRoles.includes('translator');
                  const isUserAuthor = userRoles.includes('author');

                  return (
                    <div
                      key={u.id}
                      className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full overflow-hidden bg-gray-900 border border-white/10 shrink-0">
                          <SmartImage
                            src={u.avatar_url || DEFAULT_AVATAR}
                            alt={u.display_name || u.username}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{u.display_name || u.username}</span>
                            <Link href={`/nguoi-dung/${u.username}`} className="text-xs text-gray-400 hover:text-brand-400 hover:underline">(@{u.username})</Link>
                            {u.deleted_at ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-gray-500/20 text-gray-300">Đã xóa</span>
                            ) : u.is_banned && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-rose-600/30 text-rose-200">Đã bị khóa</span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">{u.email}</div>

                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {userRoles.map((r) => (
                              <span key={r} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${roleInfo(r).cls}`}>
                                {roleInfo(r).label}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 self-end md:self-auto">
                        {isUserAdmin ? (
                          <span className="text-xs font-semibold text-rose-300 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                            Quản trị viên tối cao (Admin)
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRoleToggle(u.id, 'mod', isUserMod)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                                isUserMod
                                  ? 'bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40'
                                  : 'bg-indigo-600 hover:bg-indigo-500 text-snow shadow-md shadow-indigo-600/20'
                              }`}
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>{isUserMod ? 'Thu hồi quyền Mod' : 'Cấp quyền Mod'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRoleToggle(u.id, 'translator', isUserTranslator)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                                isUserTranslator
                                  ? 'bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 border border-cyan-500/40'
                                  : 'bg-white/10 hover:bg-white/15 text-gray-200'
                              }`}
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                              <span>{isUserTranslator ? 'Bỏ Dịch Giả' : '+ Dịch Giả'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRoleToggle(u.id, 'author', isUserAuthor)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                                isUserAuthor
                                  ? 'bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 border border-amber-500/40'
                                  : 'bg-white/10 hover:bg-white/15 text-gray-200'
                              }`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>{isUserAuthor ? 'Bỏ Tác Giả' : '+ Tác Giả'}</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
