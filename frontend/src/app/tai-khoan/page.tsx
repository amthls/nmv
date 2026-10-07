'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import ImageQualityPicker from '@/components/common/ImageQualityPicker';
import { 
  User, 
  Settings, 
  BookOpen, 
  Bookmark, 
  MessageSquare, 
  Users, 
  ShieldCheck, 
  Save, 
  Check, 
  Sparkles, 
  Palette, 
  Type, 
  Sliders, 
  Bell, 
  Globe, 
  Clock,
  Edit3,
  LogIn,
  Lock,
  Shield,
  ShieldAlert,
  Search
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import ImageUploadDropzone from '@/components/common/ImageUploadDropzone';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function UserProfilePage() {
  const { user: authUser, isAuthenticated, isLoading: isAuthLoading, openAuthModal, authFetch, hasRole, refreshProfile } = useAuth();

  const [profile, setProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'reader_settings' | 'admin_roles'>('profile');
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
        alert(json.message || 'C\u1eadp nh\u1eadt quy\u1ec1n th\u1ea5t b\u1ea1i');
      }
    } catch (err: any) {
      alert('L\u1ed7i: ' + err.message);
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
        setFeedback('\u0110\u00e3 c\u1eadp nh\u1eadt th\u00f4ng tin h\u1ed3 s\u01a1 th\u00e0nh c\u00f4ng!');
        fetchProfile();
        refreshProfile(); // navbar name/avatar come from the auth context
        setTimeout(() => setFeedback(null), 3000);
      } else {
        setErrorMsg(json?.message || 'L\u01b0u h\u1ed3 s\u01a1 th\u1ea5t b\u1ea1i.');
      }
    } catch (e: any) {
      setErrorMsg('L\u1ed7i k\u1ebft n\u1ed1i: ' + e.message);
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
        }),
      });

      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setFeedback('\u0110\u00e3 l\u01b0u c\u1ea5u h\u00ecnh tr\u1ea3i nghi\u1ec7m \u0111\u1ecdc truy\u1ec7n m\u1eb7c \u0111\u1ecbnh!');
        fetchProfile();
        setTimeout(() => setFeedback(null), 3000);
      } else {
        setErrorMsg(json?.message || 'L\u01b0u c\u1ea5u h\u00ecnh th\u1ea5t b\u1ea1i.');
      }
    } catch (e: any) {
      setErrorMsg('L\u1ed7i k\u1ebft n\u1ed1i: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 space-y-6 animate-pulse">
        <div className="h-56 rounded-3xl bg-white/5" />
        <div className="h-12 w-1/3 bg-white/5 rounded-2xl" />
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
        <h2 className="text-2xl font-bold text-white mb-2">{'Y\u00eau C\u1ea7u \u0110\u0103ng Nh\u1eadp'}</h2>
        <p className="text-sm text-gray-400 mb-6">
          {'Vui l\u00f2ng \u0111\u0103ng nh\u1eadp \u0111\u1ec3 xem th\u00f4ng tin c\u00e1 nh\u00e2n, c\u00e0i \u0111\u1eb7t giao di\u1ec7n \u0111\u1ecdc truy\u1ec7n v\u00e0 b\u1ea3o m\u1eadt t\u00e0i kho\u1ea3n.'}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => openAuthModal('login')}
            className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm shadow-lg shadow-brand-500/25 transition flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            {'\u0110\u0103ng nh\u1eadp ngay'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-24">
      {/* 1. Header Profile Banner */}
      <div className="rounded-3xl overflow-hidden glass-panel border border-white/10 bg-glass shadow-2xl relative">
        <div className="h-44 sm:h-56 w-full relative bg-gradient-to-r from-brand-900/60 via-indigo-900/40 to-surface">
          {profile?.banner_url && (
            <SmartImage src={profile.banner_url} alt="Profile banner" className="w-full h-full object-cover" />
          )}
        </div>

        <div className="p-6 sm:p-8 relative pt-16 sm:pt-6 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6">
          <div className="absolute -top-14 sm:-top-16 left-6 sm:left-8 w-28 h-28 sm:w-32 sm:h-32 rounded-3xl overflow-hidden border-4 border-surface-2 bg-gray-900 shadow-2xl">
            <SmartImage 
              src={profile?.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200'} 
              alt={profile?.display_name || profile?.username} 
              className="w-full h-full object-cover" 
            />
          </div>

          <div className="sm:ml-36 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
                {profile?.display_name || profile?.username}
              </h1>
              {profile?.roles?.map((r: any) => {
                const roleStr = typeof r === 'string' ? r : r.role;
                return (
                  <span key={roleStr} className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border uppercase ${
                    roleStr === 'admin' 
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' 
                      : roleStr === 'mod'
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                      : 'bg-brand-500/20 text-brand-300 border-brand-500/30'
                  }`}>
                    {roleStr}
                  </span>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 font-mono">@{profile?.username} • {profile?.email}</p>
            {profile?.bio && (
              <p className="text-sm text-gray-300 pt-1 line-clamp-2 max-w-xl">
                {profile.bio}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveTab('profile')}
              className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold shadow-lg shadow-brand-500/20 flex items-center gap-1.5 transition"
            >
              <Edit3 className="w-3.5 h-3.5" />
              {'S\u1eeda h\u1ed3 s\u01a1'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 border-t border-white/5 bg-black/20 divide-x divide-white/5 text-center py-4">
          <div>
            <div className="text-lg font-bold text-white">{profile?.stats?.stories_read || 0}</div>
            <div className="text-[11px] text-gray-400">{'Đ\u00e3 \u0111\u1ecdc'}</div>
          </div>
          <div>
            <div className="text-lg font-bold text-white">{profile?.stats?.favorites_count || 0}</div>
            <div className="text-[11px] text-gray-400">{'Y\u00eau th\u00edch'}</div>
          </div>
          <div>
            <div className="text-lg font-bold text-white">{profile?.stats?.bookmarks_count || 0}</div>
            <div className="text-[11px] text-gray-400">{'D\u1ea5u trang'}</div>
          </div>
          <div>
            <div className="text-lg font-bold text-white">{profile?.stats?.posts_count || 0}</div>
            <div className="text-[11px] text-gray-400">{'B\u00e0i vi\u1ebft'}</div>
          </div>
          <div>
            <div className="text-lg font-bold text-white">{profile?.stats?.comments_count || 0}</div>
            <div className="text-[11px] text-gray-400">{'B\u00ecnh lu\u1eadn'}</div>
          </div>
          <div>
            <div className="text-lg font-bold text-white">{profile?.stats?.groups_count || 0}</div>
            <div className="text-[11px] text-gray-400">{'Nh\u00f3m d\u1ecbch'}</div>
          </div>
        </div>
      </div>

      {/* 2. Navigation Tabs */}
      <div className="flex border-b border-white/10 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('profile')}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition shrink-0 ${
            activeTab === 'profile'
              ? 'border-brand-500 text-brand-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <User className="w-4 h-4" />
          {'Th\u00f4ng tin c\u00e1 nh\u00e2n'}
        </button>
        <button
          onClick={() => setActiveTab('reader_settings')}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition shrink-0 ${
            activeTab === 'reader_settings'
              ? 'border-brand-500 text-brand-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <Sliders className="w-4 h-4" />
          {'C\u00e0i \u0111\u1eb7t \u0111\u1ecdc truy\u1ec7n'}
        </button>

        {isAdmin && (
          <button
            onClick={() => setActiveTab('admin_roles')}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition shrink-0 ${
              activeTab === 'admin_roles'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-rose-400/70 hover:text-rose-300'
            }`}
          >
            <Shield className="w-4 h-4 text-rose-400" />
            {'Ph\u00e2n Quy\u1ec1n Mod & Th\u00e0nh Vi\u00ean (Admin)'}
          </button>
        )}
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

      {/* Tab Content: Profile Edit */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="space-y-6">
          <div className="glass-panel p-6 rounded-3xl border border-white/10 bg-glass space-y-5">
            <h3 className="text-lg font-bold text-white">{'Ch\u1ec9nh s\u1eeda h\u1ed3 s\u01a1'}</h3>
            {profile?.username && (
              <Link href={`/nguoi-dung/${profile.username}`} className="text-xs text-brand-400 hover:underline font-semibold">
                {'Xem trang c\u00f4ng khai c\u1ee7a b\u1ea1n \u2192'}
              </Link>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">{'T\u00ean hi\u1ec3n th\u1ecb'}</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-brand-500"
                placeholder="T\u00ean b\u1ea1n mu\u1ed1n hi\u1ec3n th\u1ecb"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">{'Ti\u1ec3u s\u1eed'}</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className="w-full p-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-brand-500 resize-none"
                placeholder="Gi\u1edbi thi\u1ec7u b\u1ea3n th\u00e2n..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">{'Ảnh \u0111\u1ea1i di\u1ec7n (Avatar)'}</label>
              <ImageUploadDropzone
                images={avatarImages}
                onChange={setAvatarImages}
                maxFiles={1}
                label="T\u1ea3i \u1ea3nh \u0111\u1ea1i di\u1ec7n l\u00ean"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">{'Ảnh b\u00eca (Banner)'}</label>
              <ImageUploadDropzone
                images={bannerImages}
                onChange={setBannerImages}
                maxFiles={1}
                label="T\u1ea3i \u1ea3nh b\u00eca c\u00e1 nh\u00e2n l\u00ean"
              />
            </div>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-sm font-semibold shadow-lg shadow-brand-500/25 flex items-center gap-2 transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? '\u0110ang l\u01b0u...' : 'L\u01b0u th\u00f4ng tin'}
            </button>
          </div>
        </form>
      )}

      {/* Tab Content: Reader Settings */}
      {activeTab === 'reader_settings' && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="glass-panel p-6 rounded-3xl border border-white/10 bg-glass space-y-6">
            <h3 className="text-lg font-bold text-white">{'C\u1ea5u h\u00ecnh tr\u1ea3i nghi\u1ec7m \u0111\u1ecdc'}</h3>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-3">\u0110\u1ed9 ph\u00e2n gi\u1ea3i \u1ea3nh khi \u0111\u1ecdc truy\u1ec7n tranh</label>
              <ImageQualityPicker />
              <p className="mt-2 text-[10.5px] text-gray-500">L\u01b0u ngay tr\u00ean tr\u00ecnh duy\u1ec7t n\u00e0y, kh\u00f4ng c\u1ea7n b\u1ea5m L\u01b0u.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-3">{'Giao di\u1ec7n n\u1ec1n (Theme)'}</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { id: 'dark', name: 'T\u1ed1i ti\u00eau chu\u1ea9n', bg: 'bg-[#0d0d15]', text: 'text-snow' },
                  { id: 'sepia', name: 'V\u00e0ng \u1ea5m (Sepia)', bg: 'bg-[#fbf0d9]', text: 'text-[#5f4b32]' },
                  { id: 'light', name: 'S\u00e1ng', bg: 'bg-snow', text: 'text-ink' },
                  { id: 'midnight', name: 'Xanh \u0111\u00eam', bg: 'bg-[#0b1020]', text: 'text-[#dbeafe]' },
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
                  <span>{'C\u1ee1 ch\u1eef'}: {fontSize}px</span>
                </div>
                <input type="range" min={14} max={32} step={1} value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full accent-brand-500" />
              </div>
              <div>
                <div className="flex justify-between text-xs font-semibold text-gray-300 mb-2">
                  <span>{'Kho\u1ea3ng c\u00e1ch d\u00f2ng'}: {lineHeight}</span>
                </div>
                <input type="range" min={1.2} max={2.4} step={0.1} value={lineHeight} onChange={(e) => setLineHeight(parseFloat(e.target.value))} className="w-full accent-brand-500" />
              </div>
            </div>
            <div className="space-y-3 pt-2 border-t border-white/10">
              <label className="block text-xs font-semibold text-gray-300 pt-4">{'Th\u00f4ng b\u00e1o'}</label>
              {[
                {
                  checked: notifyChapters, set: setNotifyChapters,
                  title: 'Ch\u01b0\u01a1ng m\u1edbi',
                  desc: 'Khi truy\u1ec7n b\u1ea1n theo d\u00f5i c\u00f3 ch\u01b0\u01a1ng m\u1edbi',
                },
                {
                  checked: notifyGroupEvents, set: setNotifyGroupEvents,
                  title: 'Ho\u1ea1t \u0111\u1ed9ng nh\u00f3m d\u1ecbch',
                  desc: 'Y\u00eau c\u1ea7u gia nh\u1eadp, k\u1ebft qu\u1ea3 duy\u1ec7t, \u0111\u01b0\u1ee3c th\u00eam v\u00e0o nh\u00f3m, nh\u00f3m \u0111\u01b0\u1ee3c duy\u1ec7t ho\u1eb7c b\u1ecb t\u1eeb ch\u1ed1i',
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
              {isSaving ? '\u0110ang l\u01b0u...' : 'L\u01b0u c\u1ea5u h\u00ecnh \u0111\u1ecdc'}
            </button>
          </div>
        </form>
      )}

      {/* Tab Content: Admin Role Assignment */}
      {isAdmin && activeTab === 'admin_roles' && (
        <div className="space-y-6">
          <div className="glass-panel p-6 rounded-3xl border border-rose-500/30 bg-glass space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Shield className="w-5 h-5 text-rose-400" /> {'Ph\u00e2n Quy\u1ec1n & Qu\u1ea3n L\u00fd Th\u00e0nh Vi\u00ean'}
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  {'Ch\u1ee9c n\u0103ng d\u00e0nh cho Admin: C\u1ea5p ho\u1eb7c thu h\u1ed3i quy\u1ec1n Moderator (Mod), D\u1ecbch gi\u1ea3 ho\u1eb7c T\u00e1c gi\u1ea3 cho c\u00e1c t\u00e0i kho\u1ea3n ng\u01b0\u1eddi d\u00f9ng.'}
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  placeholder="T\u00ecm theo t\u00ean, username..."
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
                {'\u0110ang t\u1ea3i danh s\u00e1ch ng\u01b0\u1eddi d\u00f9ng...'}
              </div>
            ) : adminUsers.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400">
                {'Kh\u00f4ng t\u00ecm th\u1ea5y ng\u01b0\u1eddi d\u00f9ng n\u00e0o ph\u00f9 h\u1ee3p v\u1edbi t\u1eeb kh\u00f3a.'}
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                {adminUsers.map((u) => {
                  const roles: string[] = u.roles || [];
                  const isUserAdmin = roles.includes('admin');
                  const isUserMod = roles.includes('mod');
                  const isUserTranslator = roles.includes('translator');
                  const isUserAuthor = roles.includes('author');

                  return (
                    <div 
                      key={u.id}
                      className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full overflow-hidden bg-gray-900 border border-white/10 shrink-0">
                          <SmartImage 
                            src={u.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'} 
                            alt={u.display_name || u.username} 
                            className="w-full h-full object-cover" 
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{u.display_name || u.username}</span>
                            <Link href={`/nguoi-dung/${u.username}`} className="text-xs text-gray-400 hover:text-brand-400 hover:underline">(@{u.username})</Link>
                            {u.deleted_at ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-gray-500/20 text-gray-300">{'\u0110\u00e3 x\u00f3a'}</span>
                            ) : u.is_banned && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-rose-600/30 text-rose-200">{'\u0110\u00e3 b\u1ecb kh\u00f3a'}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">{u.email}</div>
                          
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {roles.map((r) => (
                              <span key={r} className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                r === 'admin' 
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' 
                                  : r === 'mod'
                                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                  : 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                              }`}>
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 self-end md:self-auto">
                        {isUserAdmin ? (
                          <span className="text-xs font-semibold text-rose-300 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                            {'Qu\u1ea3n tr\u1ecb vi\u00ean t\u1ed1i cao (Admin)'}
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
                              <span>{isUserMod ? 'Thu h\u1ed3i quy\u1ec1n Mod' : 'C\u1ea5p quy\u1ec1n Mod'}</span>
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
                              <span>{isUserTranslator ? 'B\u1ecf D\u1ecbch Gi\u1ea3' : '+ D\u1ecbch Gi\u1ea3'}</span>
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
                              <span>{isUserAuthor ? 'B\u1ecf T\u00e1c Gi\u1ea3' : '+ T\u00e1c Gi\u1ea3'}</span>
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