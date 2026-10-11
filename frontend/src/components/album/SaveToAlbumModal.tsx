'use client';

import React, { useEffect, useState } from 'react';
import { Check, Globe, Loader2, Lock, Plus, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { AlbumSummary, readJson } from '@/lib/albums';
import { LIBRARY_URL } from '@/lib/apiJson';

interface SaveToAlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  storyId: string;
  storyTitle: string;
  /** called after any change, with the number of my albums now holding the story */
  onChange?: (savedIn: number, message: string) => void;
}

/** Pick which of my albums hold this story (any number of them), or make a new album for it. */
export default function SaveToAlbumModal({ isOpen, onClose, storyId, storyTitle, onChange }: SaveToAlbumModalProps) {
  const { authFetch } = useAuth();
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPublic, setNewPublic] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setIsLoading(true);
    authFetch(`${LIBRARY_URL}/albums/me?story_id=${storyId}`)
      .then(readJson)
      .then((json) => setAlbums(json.data))
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [isOpen, storyId]);

  if (!isOpen) return null;

  const report = (next: AlbumSummary[], message: string) => {
    setAlbums(next);
    onChange?.(next.filter((a) => a.has_story).length, message);
  };

  const toggle = async (album: AlbumSummary) => {
    if (busyId) return;
    setBusyId(album.id);
    setError(null);
    try {
      const res = album.has_story
        ? await authFetch(`${LIBRARY_URL}/albums/${album.id}/stories/${storyId}`, { method: 'DELETE' })
        : await authFetch(`${LIBRARY_URL}/albums/${album.id}/stories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ story_id: storyId }),
          });
      const json = await readJson(res);
      report(
        albums.map((a) => a.id === album.id
          ? { ...a, has_story: !album.has_story, story_count: a.story_count + (album.has_story ? -1 : 1) }
          : a),
        json.message
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const res = await authFetch(`${LIBRARY_URL}/albums`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), is_public: newPublic, story_id: storyId }),
      });
      const json = await readJson(res);
      const created: AlbumSummary = {
        owner_id: '', owner_username: '', owner_name: null, owner_avatar: null, save_count: 0, preview: [],
        ...json.data, story_count: 1, has_story: true,
      };
      report([created, ...albums], `Đã tạo album "${created.name}" và lưu truyện vào đó.`);
      setNewName('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-glass border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Lưu vào album"
      >
        <div className="p-5 pb-3 flex items-start justify-between gap-3 border-b border-white/10">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white">Lưu vào album</h3>
            <p className="text-xs text-gray-400 truncate">{storyTitle}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="py-10 flex justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : albums.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-400">Bạn chưa có album nào. Tạo album đầu tiên ở bên dưới.</p>
          ) : (
            <ul className="space-y-1">
              {albums.map((album) => (
                <li key={album.id}>
                  <button
                    type="button"
                    onClick={() => toggle(album)}
                    disabled={busyId !== null}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 text-left transition disabled:opacity-60"
                  >
                    <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition ${
                      album.has_story ? 'bg-brand-600 border-brand-500 text-snow' : 'border-white/25'
                    }`}>
                      {busyId === album.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : album.has_story && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-white truncate">{album.name}</span>
                      <span className="block text-[11px] text-gray-400">{album.story_count} truyện</span>
                    </span>
                    {album.is_public
                      ? <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-label="Công khai" />
                      : <Lock className="w-3.5 h-3.5 text-gray-500 shrink-0" aria-label="Riêng tư" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="px-5 pb-2 text-xs text-rose-400">{error}</p>}

        <form onSubmit={create} className="p-4 border-t border-white/10 space-y-2">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              placeholder="Tên album mới..."
              className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={!newName.trim() || isCreating}
              className="px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center gap-1 disabled:opacity-50"
            >
              {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Tạo
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={newPublic} onChange={(e) => setNewPublic(e.target.checked)} className="accent-brand-500" />
            Công khai (người khác thấy album này dưới các truyện trong album)
          </label>
        </form>
      </div>
    </div>
  );
}
