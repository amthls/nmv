export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export type PostCategory = 'discussion' | 'review' | 'fanart' | 'theory' | 'news' | 'question';

export const CATEGORIES: { id: PostCategory; label: string; emoji: string; cls: string }[] = [
  { id: 'discussion', label: 'Thảo luận', emoji: '💬', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  { id: 'review', label: 'Review', emoji: '⭐', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { id: 'fanart', label: 'Fanart', emoji: '🎨', cls: 'bg-pink-500/15 text-pink-300 border-pink-500/30' },
  { id: 'theory', label: 'Giả thuyết', emoji: '🔮', cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  { id: 'news', label: 'Tin tức', emoji: '📰', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  { id: 'question', label: 'Hỏi đáp', emoji: '❓', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
];
export const categoryOf = (id?: string | null) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];

export const REACTIONS = [
  { type: 'like', emoji: '👍', name: 'Thích' },
  { type: 'love', emoji: '❤️', name: 'Yêu thích' },
  { type: 'haha', emoji: '😆', name: 'Haha' },
  { type: 'wow', emoji: '😮', name: 'Wow' },
  { type: 'sad', emoji: '😢', name: 'Buồn' },
  { type: 'angry', emoji: '😡', name: 'Phẫn nộ' },
] as const;

export const ROLE_BADGES: Record<string, { label: string; cls: string }> = {
  admin: { label: 'Admin', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  mod: { label: 'Mod', cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  translator: { label: 'Dịch giả', cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  author: { label: 'Tác giả', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
};
/** The most notable role of a member, for the small badge next to their name. */
export const topRole = (roles?: string[]) => ['admin', 'mod', 'translator', 'author'].find((r) => roles?.includes(r));

export function timeAgo(dateStr?: string | null) {
  if (!dateStr) return 'Vừa xong';
  const sec = Math.max(0, (Date.now() - new Date(dateStr).getTime()) / 1000);
  if (sec < 60) return 'Vừa xong';
  if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} giờ trước`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)} ngày trước`;
  return new Date(dateStr).toLocaleDateString('vi-VN');
}

export async function readJson(res: Response) {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.message || `HTTP ${res.status}`);
  return json;
}
