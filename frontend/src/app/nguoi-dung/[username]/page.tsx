'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  Ban,
  FileText,
  MessageCircle,
  MessageSquare,
  Shield,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Unlock,
  Users,
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { useAuth } from '@/context/AuthContext';
import { useConfirmPassword } from '@/components/account/ConfirmPassword';
import { IDENTITY_URL } from '@/lib/session';
import CodeBadge from '@/components/common/CodeBadge';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  admin: { label: 'Admin', className: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  mod: { label: 'Mod', className: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  translator: { label: 'Dịch giả', className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  author: { label: 'Tác giả', className: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  reader: { label: 'Độc giả', className: 'bg-white/10 text-gray-300 border-white/15' },
};

const GROUP_ROLE_LABELS: Record<string, string> = {
  leader: 'Trưởng nhóm',
  mod: 'Quản lý',
  translator: 'Dịch giả',
  editor: 'Biên tập',
  proofreader: 'Hiệu đính',
  raw_provider: 'Raw provider',
  member: 'Thành viên',
};

export default function UserProfilePage() {
  const params = useParams();
  const username = params?.username as string;
  const { user, authFetch } = useAuth();
  const confirmPassword = useConfirmPassword();

  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchProfile = async () => {
    if (!username) return;
    if (!profile) setIsLoading(true);
    try {
      // authFetch: staff get the moderation block, everyone else the public profile
      const res = await authFetch(`${API_BASE_URL}/users/${encodeURIComponent(username)}`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setProfile(json.data);
        setNotFound(false);
        if (json.data.moderation) {
          // The email lives only in the identity service, shown to staff only
          authFetch(`${IDENTITY_URL}/users/${json.data.id}/private`)
            .then((r) => r.json())
            .then((p) => p?.success && setProfile((cur: any) => cur && ({ ...cur, moderation: { ...cur.moderation, email: p.data.email } })))
            .catch(() => {});
        }
      } else {
        setProfile(null);
        setNotFound(true);
      }
    } catch (e) {
      console.error('Failed to load profile:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [username, user?.id]);

  const runAction = async (url: string, method: string, body?: object) => {
    setIsActing(true);
    try {
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => null);
      setFeedback({ ok: res.ok, text: json?.message || (res.ok ? 'Đã cập nhật.' : 'Thao tác thất bại.') });
      return res.ok;
    } catch (e) {
      setFeedback({ ok: false, text: 'Không thể kết nối máy chủ.' });
      return false;
    } finally {
      setIsActing(false);
    }
  };

  // Account actions belong to the identity service and ask for the actor's password again
  const handleBan = async () => {
    const reason = prompt(`Lý do khóa tài khoản ${profile.username}:`, 'Vi phạm điều khoản cộng đồng');
    if (reason === null) return;
    const password = await confirmPassword.ask(`Khóa tài khoản ${profile.username}`, `Lý do: ${reason}`);
    if (!password) return;
    if (await runAction(`${IDENTITY_URL}/users/${profile.id}/ban`, 'POST', { reason, password })) fetchProfile();
  };

  const handleUnban = async () => {
    const password = await confirmPassword.ask(`Mở khóa tài khoản ${profile.username}`);
    if (!password) return;
    if (await runAction(`${IDENTITY_URL}/users/${profile.id}/unban`, 'POST', { password })) fetchProfile();
  };

  const handleRole = async (action: 'grant' | 'revoke') => {
    const title = action === 'grant'
      ? `Cấp quyền Kiểm duyệt viên (Mod) cho ${profile.username}`
      : `Thu hồi quyền Mod của ${profile.username}`;
    const password = await confirmPassword.ask(title);
    if (!password) return;
    if (await runAction(`${IDENTITY_URL}/users/${profile.id}/roles`, 'POST', { role: 'mod', action, password })) fetchProfile();
  };

  const handleDelete = async () => {
    if (!confirm(`Xóa tài khoản ${profile.username}? Tên, email, ảnh và giới thiệu sẽ bị xóa vĩnh viễn và tài khoản không thể đăng nhập lại. Truyện đã đăng vẫn được giữ.`)) return;
    const purge = confirm('Ẩn luôn tất cả bài viết và bình luận của người dùng này?\n\nOK = ẩn hết, Hủy = giữ lại bài viết/bình luận.');
    const password = await confirmPassword.ask(`Xóa tài khoản ${profile.username}`, purge ? 'Kèm ẩn mọi bài viết và bình luận.' : 'Giữ lại bài viết và bình luận.');
    if (!password) return;
    if (await runAction(`${IDENTITY_URL}/users/${profile.id}`, 'DELETE', { purge_content: purge, password })) fetchProfile();
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 space-y-6 animate-pulse">
        <div className="h-48 rounded-3xl bg-white/5" />
        <div className="h-24 rounded-3xl bg-white/5" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-4 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-brand-400" />
        <h2 className="text-xl font-bold text-white">Không tìm thấy người dùng này</h2>
        <Link href="/" className="px-4 py-2 rounded-xl bg-brand-600 text-snow text-xs font-semibold">
          Về trang chủ
        </Link>
      </div>
    );
  }

  const mod = profile.moderation;
  const isSelf = user?.id === profile.id;
  const stats = [
    { label: 'Truyện đã đăng', value: profile.stats.stories_count, icon: BookOpen },
    { label: 'Bài viết', value: profile.stats.posts_count, icon: FileText },
    { label: 'Bình luận', value: profile.stats.comments_count, icon: MessageSquare },
    { label: 'Nhóm dịch', value: profile.stats.groups_count, icon: Users },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 pb-24">
      {confirmPassword.dialog}

      {/* Header */}
      <div className="rounded-3xl overflow-hidden glass-panel border border-white/10 bg-glass shadow-2xl">
        <div className="h-36 sm:h-48 w-full relative bg-gradient-to-r from-brand-900/60 via-indigo-900/40 to-surface">
          {profile.banner_url && (
            <SmartImage src={profile.banner_url} alt={profile.display_name || profile.username} className="w-full h-full object-cover" />
          )}
        </div>

        <div className="p-6 sm:p-8 pt-16 sm:pt-6 relative">
          <div className="absolute -top-12 sm:-top-14 left-6 sm:left-8 w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden border-4 border-surface-2 bg-gray-900 shadow-2xl">
            <SmartImage
              src={profile.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200'}
              alt={profile.display_name || profile.username}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="sm:ml-32 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold text-white">{profile.display_name || profile.username}</h1>
              <CodeBadge code={profile.code} everyone />
              {profile.roles.map((r: string) => ROLE_BADGES[r] && (
                <span key={r} className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${ROLE_BADGES[r].className}`}>
                  {ROLE_BADGES[r].label}
                </span>
              ))}
              {mod?.deleted_at ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border bg-gray-500/20 text-gray-300 border-gray-500/30">Đã xóa</span>
              ) : mod?.is_banned && (
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border bg-rose-600/30 text-rose-200 border-rose-500/40">Đã bị khóa</span>
              )}
            </div>
            <div className="text-xs text-gray-400 flex flex-wrap items-center gap-3">
              <span>@{profile.username}</span>
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3.5 h-3.5" /> Tham gia {new Date(profile.created_at).toLocaleDateString('vi-VN')}
              </span>
              {isSelf && (
                <Link href="/tai-khoan" className="text-brand-400 hover:underline font-semibold">Sửa hồ sơ của bạn</Link>
              )}
              {!isSelf && !mod?.deleted_at && (
                <Link
                  href={`/tin-nhan?u=${encodeURIComponent(profile.username)}`}
                  className="px-3 py-1 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow font-bold flex items-center gap-1.5 transition"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> Nhắn tin
                </Link>
              )}
            </div>
            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line max-w-2xl">
              {profile.bio || 'Người dùng này chưa viết giới thiệu.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-white/10 bg-black/20">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="p-4 text-center">
              <div className="text-lg font-bold text-white flex items-center justify-center gap-1.5">
                <Icon className="w-4 h-4 text-brand-400" /> {value}
              </div>
              <div className="text-[11px] text-gray-400">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Moderation (admin/mod only; the server decides which actions are allowed) */}
      {mod && !isSelf && (
        <div className="p-5 rounded-3xl glass-panel border border-rose-500/30 bg-glass space-y-3">
          <h2 className="text-xs font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
            <Shield className="w-4 h-4" /> Quản trị tài khoản
          </h2>
          <div className="text-xs text-gray-400 space-y-1">
            <div>Email: <span className="text-gray-200">{mod.email}</span></div>
            {mod.is_banned && !mod.deleted_at && (
              <div>
                Bị khóa từ {mod.banned_at ? new Date(mod.banned_at).toLocaleString('vi-VN') : '?'}
                {mod.ban_reason && <> — Lý do: <span className="text-rose-300">{mod.ban_reason}</span></>}
              </div>
            )}
            {mod.deleted_at && <div>Tài khoản đã bị xóa lúc {new Date(mod.deleted_at).toLocaleString('vi-VN')}.</div>}
          </div>

          {feedback && (
            <div className={`p-2.5 rounded-xl text-xs font-semibold ${feedback.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
              {feedback.text}
            </div>
          )}

          {Object.values(mod.can).some(Boolean) ? (
            <div className="flex flex-wrap gap-2">
              {mod.can.ban && (
                <button onClick={handleBan} disabled={isActing} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-snow text-xs font-bold flex items-center gap-1.5 transition">
                  <Ban className="w-3.5 h-3.5" /> Khóa tài khoản
                </button>
              )}
              {mod.can.unban && (
                <button onClick={handleUnban} disabled={isActing} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-snow text-xs font-bold flex items-center gap-1.5 transition">
                  <Unlock className="w-3.5 h-3.5" /> Mở khóa
                </button>
              )}
              {mod.can.grant_mod && (
                <button onClick={() => handleRole('grant')} disabled={isActing} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-snow text-xs font-bold flex items-center gap-1.5 transition">
                  <ShieldCheck className="w-3.5 h-3.5" /> Cấp quyền Mod
                </button>
              )}
              {mod.can.revoke_mod && (
                <button onClick={() => handleRole('revoke')} disabled={isActing} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 disabled:opacity-40 text-gray-200 text-xs font-bold flex items-center gap-1.5 transition">
                  <ShieldOff className="w-3.5 h-3.5" /> Thu hồi quyền Mod
                </button>
              )}
              {mod.can.delete && (
                <button onClick={handleDelete} disabled={isActing} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 disabled:opacity-40 text-gray-300 hover:text-rose-300 text-xs font-bold flex items-center gap-1.5 transition">
                  <Trash2 className="w-3.5 h-3.5" /> Xóa tài khoản
                </button>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Bạn không có quyền quản trị tài khoản này (Admin, Mod khác hoặc tài khoản đã xóa).</p>
          )}
        </div>
      )}

      {/* Groups */}
      {profile.groups.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Users className="w-4 h-4 text-indigo-400" /> Nhóm dịch</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-3">
            {profile.groups.map((g: any) => (
              <Link key={g.slug} href={`/nhom-dich/${g.slug}`} className="p-3 rounded-2xl glass-panel border border-white/10 hover:border-brand-500/40 bg-glass flex items-center gap-3 transition">
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-900 shrink-0">
                  <SmartImage src={g.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'} alt={g.name} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 text-xs">
                  <div className="font-bold text-white truncate">{g.name}</div>
                  <div className="text-[10px] text-gray-400">{GROUP_ROLE_LABELS[g.role] || g.role}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Stories */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><BookOpen className="w-4 h-4 text-brand-400" /> Truyện đã đăng</h2>
        {profile.stories.length === 0 ? (
          <p className="text-xs text-gray-400">Chưa đăng truyện nào.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(150px,calc(50%_-_8px)),1fr))] gap-3">
            {profile.stories.map((s: any) => (
              <Link key={s.id} href={`/truyen/${s.slug}`} className="group space-y-1.5">
                <div className="aspect-[3/4] rounded-xl overflow-hidden bg-gray-900 border border-white/10">
                  <SmartImage src={s.cover_image_url} alt={s.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                </div>
                <div className="text-[11px] font-bold text-white line-clamp-2 group-hover:text-brand-300 transition">{s.title}</div>
                <div className="text-[10px] text-gray-500">{s.total_chapters || 0} chương</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
