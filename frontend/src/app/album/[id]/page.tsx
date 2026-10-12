'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  CheckCircle2,
  Copy,
  Globe,
  Library,
  Link2,
  Lock,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import CopyAlbumModal from '@/components/album/CopyAlbumModal';
import { useAuth } from '@/context/AuthContext';
import { AlbumDetail, albumShareUrl, copyText, readJson } from '@/lib/albums';
import CodeBadge from '@/components/common/CodeBadge';
import { LIBRARY_URL } from '@/lib/apiJson';

const btn = 'px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50';

function AlbumPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const albumId = params?.id as string;
  const shareKey = searchParams?.get('key') || null;
  const { isAuthenticated, isLoading: isAuthLoading, authFetch, openAuthModal } = useAuth();

  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isCopyOpen, setIsCopyOpen] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetcher = isAuthenticated ? authFetch : fetch;
      const url = `${LIBRARY_URL}/albums/${albumId}${shareKey ? `?key=${encodeURIComponent(shareKey)}` : ''}`;
      const json = await readJson(await fetcher(url, { credentials: 'include' }));
      setAlbum(json.data);
    } catch (e: any) {
      setError(e.message);
      setAlbum(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthLoading && albumId) load();
  }, [albumId, shareKey, isAuthenticated, isAuthLoading]);

  const send = async (path: string, init: RequestInit) => {
    setIsBusy(true);
    try {
      return await readJson(await authFetch(`${LIBRARY_URL}/albums/${albumId}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      }));
    } catch (e: any) {
      showToast(e.message);
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const json = await send('', { method: 'PUT', body: JSON.stringify({ name: editName, description: editDesc }) });
    if (!json || !album) return;
    setAlbum({ ...album, ...json.data });
    setIsEditing(false);
    showToast(json.message);
  };

  const togglePublic = async () => {
    if (!album) return;
    const json = await send('', { method: 'PUT', body: JSON.stringify({ is_public: !album.is_public }) });
    if (!json) return;
    setAlbum({ ...album, ...json.data });
    showToast(json.data.is_public
      ? 'Album đã công khai: hiện dưới các truyện trong album, ai cũng xem được.'
      : 'Album đã chuyển riêng tư: chỉ người có link chia sẻ mới xem được.');
  };

  const shareLink = async () => {
    if (!album) return;
    // visitors pass on the same key they opened the album with
    const url = albumShareUrl(album.is_owner ? album : { ...album, share_token: shareKey || undefined });
    if (await copyText(url)) showToast('Đã sao chép link chia sẻ album.');
    else window.prompt('Sao chép link album:', url);
  };

  const resetLink = async () => {
    if (!album || !confirm('Tạo link chia sẻ mới? Link riêng tư cũ sẽ không mở được album nữa.')) return;
    const json = await send('/share-link/reset', { method: 'POST' });
    if (!json) return;
    setAlbum({ ...album, share_token: json.data.share_token });
    showToast(json.message);
  };

  const deleteAlbum = async () => {
    if (!album || !confirm(`Xóa album "${album.name}"? Các truyện vẫn còn trong những album khác của bạn.`)) return;
    const json = await send('', { method: 'DELETE' });
    if (json) router.push('/bookmark');
  };

  const removeStory = async (storyId: string, title: string) => {
    if (!album || !confirm(`Bỏ "${title}" khỏi album?`)) return;
    const json = await send(`/stories/${storyId}`, { method: 'DELETE' });
    if (!json) return;
    setAlbum({ ...album, stories: album.stories.filter((s) => s.id !== storyId), story_count: album.story_count - 1 });
  };

  const toggleSave = async () => {
    if (!album) return;
    if (!isAuthenticated) return openAuthModal('login');
    const json = await send('/save', { method: 'POST', body: JSON.stringify({ key: shareKey || undefined }) });
    if (!json) return;
    const saved = json.action === 'added';
    setAlbum({ ...album, is_saved: saved, save_count: Math.max(0, album.save_count + (saved ? 1 : -1)) });
    showToast(json.message);
  };

  if (isLoading || isAuthLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-8 animate-pulse">
        <div className="h-56 bg-white/5 rounded-3xl" />
        <div className="h-64 bg-white/5 rounded-3xl" />
      </div>
    );
  }

  if (!album) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-brand-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">{error || 'Không tìm thấy album'}</h2>
        {!isAuthenticated && (
          <p className="text-xs text-gray-400">Nếu đây là album của bạn, hãy đăng nhập để xem.</p>
        )}
        <Link href="/bookmark" className="inline-block px-4 py-2 rounded-xl bg-brand-600 text-snow text-xs font-semibold">
          Về Album của tôi
        </Link>
      </div>
    );
  }

  const covers = album.stories.slice(0, 4);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-24">
      {/* Header */}
      <div className="rounded-3xl p-5 sm:p-8 glass-panel border border-brand-500/20 bg-gradient-to-r from-brand-900/30 via-indigo-900/20 to-surface shadow-xl flex flex-col md:flex-row gap-6">
        <div className="w-40 h-40 sm:w-48 sm:h-48 shrink-0 mx-auto md:mx-0 rounded-2xl overflow-hidden bg-gray-900 ring-1 ring-white/15">
          {covers.length > 0 ? (
            <div className={`grid h-full w-full gap-0.5 ${covers.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${covers.length > 2 ? 'grid-rows-2' : 'grid-rows-1'}`}>
              {covers.map((s, i) => (
                <SmartImage
                  key={s.id}
                  src={s.cover_image_url || undefined}
                  alt={s.title}
                  className={`w-full h-full min-h-0 object-cover ${covers.length === 3 && i === 0 ? 'row-span-2' : ''}`}
                />
              ))}
            </div>
          ) : (
            <div className="h-full w-full flex items-center justify-center text-gray-500"><Library className="w-10 h-10" /></div>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border font-bold ${
              album.is_public ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-white/5 border-white/15 text-gray-300'
            }`}>
              {album.is_public ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              {album.is_public ? 'Công khai' : 'Riêng tư · chỉ ai có link'}
            </span>
            <span className="text-gray-400">{album.story_count} truyện · {album.save_count} người lưu</span>
          </div>

          {isEditing ? (
            <form onSubmit={saveEdit} className="space-y-2 max-w-xl">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={100}
                autoFocus
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-lg font-bold text-white focus:outline-none focus:border-brand-500"
              />
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Mô tả album (không bắt buộc)"
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
              />
              <div className="flex gap-2">
                <button type="submit" disabled={isBusy || !editName.trim()} className={`${btn} bg-brand-600 hover:bg-brand-500 text-snow`}>Lưu</button>
                <button type="button" onClick={() => setIsEditing(false)} className={`${btn} bg-white/5 hover:bg-white/10 text-gray-300`}>
                  <X className="w-3.5 h-3.5" /> Hủy
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white break-words">{album.name}</h1>
                <CodeBadge code={album.code} />
              </div>
              {album.description && <p className="text-sm text-gray-300 whitespace-pre-line">{album.description}</p>}
            </>
          )}

          <p className="text-xs text-gray-400">
            Album của{' '}
            <Link href={`/nguoi-dung/${album.owner_username}`} className="font-semibold text-gray-200 hover:text-brand-300">
              {album.owner_name || album.owner_username}
            </Link>
            {album.copied_from && album.copied_from_name && (
              <> · sao chép từ <Link href={`/album/${album.copied_from}`} className="text-brand-300 hover:underline">{album.copied_from_name}</Link></>
            )}
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {album.is_owner ? (
              <>
                <button onClick={shareLink} className={`${btn} bg-brand-600 hover:bg-brand-500 text-snow`}>
                  <Link2 className="w-3.5 h-3.5" /> Chia sẻ link
                </button>
                <button onClick={togglePublic} disabled={isBusy} className={`${btn} bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10`}>
                  {album.is_public ? <Lock className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
                  {album.is_public ? 'Chuyển riêng tư' : 'Công khai'}
                </button>
                <button
                  onClick={() => { setEditName(album.name); setEditDesc(album.description || ''); setIsEditing(true); }}
                  className={`${btn} bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10`}
                >
                  <Pencil className="w-3.5 h-3.5" /> Đổi tên
                </button>
                {!album.is_public && (
                  <button onClick={resetLink} disabled={isBusy} className={`${btn} bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10`} title="Link cũ sẽ hết hiệu lực">
                    <RefreshCw className="w-3.5 h-3.5" /> Đổi link
                  </button>
                )}
                <button onClick={deleteAlbum} disabled={isBusy} className={`${btn} bg-rose-600/15 hover:bg-rose-600/25 text-rose-300 border border-rose-500/30`}>
                  <Trash2 className="w-3.5 h-3.5" /> Xóa album
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={toggleSave}
                  disabled={isBusy}
                  className={`${btn} ${album.is_saved ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-brand-600 hover:bg-brand-500 text-snow'}`}
                >
                  {album.is_saved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
                  {album.is_saved ? 'Đã lưu album' : 'Lưu album'}
                </button>
                <button
                  onClick={() => (isAuthenticated ? setIsCopyOpen(true) : openAuthModal('login'))}
                  className={`${btn} bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10`}
                >
                  <Copy className="w-3.5 h-3.5" /> Sao chép vào album của tôi
                </button>
                <button onClick={shareLink} className={`${btn} bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10`}>
                  <Link2 className="w-3.5 h-3.5" /> Sao chép link
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Stories */}
      {album.stories.length === 0 ? (
        <div className="text-center py-16 glass-panel rounded-3xl border border-white/10 space-y-3">
          <BookOpen className="w-10 h-10 text-brand-400 mx-auto" />
          <p className="text-sm text-gray-300">Album chưa có truyện nào.</p>
          {album.is_owner && (
            <p className="text-xs text-gray-400">Mở một truyện bất kỳ và bấm "Lưu vào album" để thêm.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(150px,calc(50%_-_8px)),1fr))] gap-4">
          {album.stories.map((s) => (
            <div key={s.id} className="group relative rounded-2xl overflow-hidden glass-panel border border-white/10 hover:border-brand-500/40 transition">
              <Link href={`/truyen/${s.slug}`} className="block">
                <div className="aspect-[3/4] bg-gray-900 overflow-hidden">
                  <SmartImage src={s.cover_image_url || undefined} alt={s.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                </div>
                <div className="p-3 space-y-0.5">
                  <h4 className="text-xs font-bold text-white line-clamp-2 group-hover:text-brand-300">{s.title}</h4>
                  <p className="text-[11px] text-gray-400 truncate">{s.author_name || 'Chưa rõ tác giả'}</p>
                  <p className="text-[10px] text-gray-500">{s.total_chapters || 0} chương</p>
                </div>
              </Link>
              {album.is_owner && (
                <button
                  onClick={() => removeStory(s.id, s.title)}
                  disabled={isBusy}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 text-gray-300 hover:text-rose-400 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition"
                  title="Bỏ khỏi album"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <CopyAlbumModal album={isCopyOpen ? album : null} shareKey={shareKey} onClose={() => setIsCopyOpen(false)} />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-zinc-900/95 border border-white/20 text-white shadow-2xl backdrop-blur-md">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{toast}</span>
        </div>
      )}
    </div>
  );
}

export default function AlbumPage() {
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-4 py-12"><div className="h-56 bg-white/5 rounded-3xl animate-pulse" /></div>}>
      <AlbumPageInner />
    </Suspense>
  );
}
