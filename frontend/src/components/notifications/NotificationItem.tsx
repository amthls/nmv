'use client';

import { BookOpen, FolderKanban, Megaphone, MessageSquare, ShieldAlert, Sparkles, Users } from 'lucide-react';

/** One row of GET /api/msg/notifications (messaging service, Plan/messaging.md E3). */
export interface Notification {
  id: string;
  type: string; // 'broadcast' = a site-wide announcement
  category: 'read' | 'interaction' | 'group' | 'workspace' | 'moderation' | 'system';
  title: string;
  message: string | null;
  link: string | null;
  image: string | null;
  actors: { id: string; name: string }[];
  actor_count: number;
  count: number;
  is_seen: boolean;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}

export const NOTIFICATION_URL = '/api/msg/notifications';

const ICONS = {
  read: BookOpen, interaction: MessageSquare, group: Users, workspace: FolderKanban, moderation: ShieldAlert, system: Sparkles,
};

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function NotificationItem({ n, onOpen, compact }: { n: Notification; onOpen: (n: Notification) => void; compact?: boolean }) {
  const Icon = n.type === 'broadcast' ? Megaphone : ICONS[n.category] || Sparkles;
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={`w-full text-left ${compact ? 'p-3.5 px-4' : 'p-4'} flex items-start gap-3 transition hover:bg-white/5 ${
        !n.is_read ? 'bg-brand-500/10' : ''
      } ${n.type === 'broadcast' ? 'border-l-2 border-amber-400/70' : ''}`}
    >
      <div className="relative shrink-0 mt-0.5">
        {n.image ? (
          <img src={n.image} alt="" className="w-10 h-14 object-cover rounded-lg border border-white/10 shadow-sm" />
        ) : (
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${
            n.type === 'broadcast' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' : 'bg-brand-500/15 border-brand-500/25 text-brand-400'
          }`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
        {!n.is_read && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-brand-500 ring-2 ring-surface-2" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`${compact ? 'text-xs' : 'text-sm'} leading-snug line-clamp-2 ${!n.is_read ? 'font-bold text-white' : 'text-gray-300'}`}>
          {n.title}
        </p>
        {n.message && <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-gray-400 mt-1 line-clamp-2`}>{n.message}</p>}
        <span className="text-[10px] text-gray-500 mt-1.5 flex items-center gap-1.5">
          {timeAgo(n.updated_at)}
          {n.count > 1 && <span className="px-1.5 rounded bg-white/5 text-gray-400">{n.count} lần</span>}
        </span>
      </div>
    </button>
  );
}
