'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, Loader2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { AlbumSummary, readJson } from '@/lib/albums';
import { LIBRARY_URL } from '@/lib/apiJson';

interface CopyAlbumModalProps {
  /** the album to copy; null keeps the modal closed */
  album: { id: string; name: string; story_count: number } | null;
  /** share key, when the album is private and was opened through its link */
  shareKey?: string | null;
  onClose: () => void;
  /** after a successful copy */
  onCopied?: () => void;
}

/** Copy someone's album: into a brand new album of mine, or merged into one I already have. */
export default function CopyAlbumModal({ album, shareKey, onClose, onCopied }: CopyAlbumModalProps) {
  const { authFetch } = useAuth();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('');
  const [targetId, setTargetId] = useState('');
  const [myAlbums, setMyAlbums] = useState<AlbumSummary[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ album_id: string; message: string } | null>(null);

  useEffect(() => {
    if (!album) return;
    setName(album.name);
    setMode('new');
    setError(null);
    setDone(null);
    authFetch(`${LIBRARY_URL}/albums/me`)
      .then(readJson)
      .then((json) => {
        const list: AlbumSummary[] = json.data.filter((a: AlbumSummary) => a.id !== album.id);
        setMyAlbums(list);
        setTargetId(list[0]?.id || '');
      })
      .catch(() => setMyAlbums([]));
  }, [album?.id]);

  if (!album) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      const res = await authFetch(`${LIBRARY_URL}/albums/${album.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'new'
          ? { name: name.trim(), key: shareKey || undefined }
          : { target_album_id: targetId, key: shareKey || undefined }),
      });
      const json = await readJson(res);
      setDone({ album_id: json.data.album_id, message: json.message });
      onCopied?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-glass border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Sao chép album"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white">Sao chép album</h3>
            <p className="text-xs text-gray-400 truncate">"{album.name}" · {album.story_count} truyện</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="space-y-4 text-center py-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <p className="text-sm text-white">{done.message}</p>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold">
                Đóng
              </button>
              <Link
                href={`/album/${done.album_id}`}
                onClick={onClose}
                className="flex-1 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold"
              >
                Xem album của tôi
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="flex items-start gap-2.5 p-3 rounded-xl border border-white/10 hover:bg-white/5 cursor-pointer">
              <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} className="mt-0.5 accent-brand-500" />
              <span className="flex-1 space-y-2">
                <span className="block text-sm font-semibold text-white">Tạo album mới</span>
                {mode === 'new' && (
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    placeholder="Tên album"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-brand-500"
                  />
                )}
              </span>
            </label>

            <label className={`flex items-start gap-2.5 p-3 rounded-xl border border-white/10 ${myAlbums.length ? 'hover:bg-white/5 cursor-pointer' : 'opacity-50'}`}>
              <input
                type="radio"
                checked={mode === 'existing'}
                disabled={myAlbums.length === 0}
                onChange={() => setMode('existing')}
                className="mt-0.5 accent-brand-500"
              />
              <span className="flex-1 space-y-2">
                <span className="block text-sm font-semibold text-white">Gộp vào album có sẵn của tôi</span>
                <span className="block text-[11px] text-gray-400">Truyện đã có trong album sẽ không bị thêm trùng.</span>
                {mode === 'existing' && (
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none"
                  >
                    {myAlbums.map((a) => (
                      <option key={a.id} value={a.id} className="bg-glass text-white">
                        {a.name} ({a.story_count} truyện)
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </label>

            {error && <p className="text-xs text-rose-400">{error}</p>}

            <button
              type="submit"
              disabled={isBusy || (mode === 'new' ? !name.trim() : !targetId)}
              className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
              Sao chép
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
