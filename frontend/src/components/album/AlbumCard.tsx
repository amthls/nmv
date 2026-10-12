'use client';

import React from 'react';
import Link from '@/components/common/Link';
import { Bookmark, Globe, Library, Lock } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { AlbumSummary, albumPath } from '@/lib/albums';

interface AlbumCardProps {
  album: AlbumSummary;
  /** show "của <owner>" (albums of other users) */
  showOwner?: boolean;
  /** label above the covers, e.g. "Còn có" when the preview leaves out the current story */
  previewLabel?: string;
  /** buttons under the card (save / copy / share ...) */
  actions?: React.ReactNode;
  /** owner only: the public/private badge becomes a toggle */
  onToggleVisibility?: () => void;
}

/** Album tile: a 2x2 mosaic of the newest covers, name, owner and counts. */
export default function AlbumCard({ album, showOwner, previewLabel, actions, onToggleVisibility }: AlbumCardProps) {
  const href = albumPath(album);
  const covers = album.preview || [];

  return (
    <div className="group rounded-2xl overflow-hidden glass-panel border border-white/10 bg-glass hover:border-brand-500/40 transition flex flex-col">
      <Link href={href} className="block relative aspect-[4/3] overflow-hidden bg-gray-900">
        {covers.length > 0 ? (
          <div className={`absolute inset-0 grid gap-0.5 ${covers.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${covers.length > 2 ? 'grid-rows-2' : 'grid-rows-1'}`}>
            {covers.slice(0, 4).map((s, i) => (
              <SmartImage
                key={s.id}
                src={s.cover_image_url || undefined}
                alt={s.title}
                title={s.title}
                className={`w-full h-full min-h-0 object-cover ${covers.length === 3 && i === 0 ? 'row-span-2' : ''}`}
              />
            ))}
          </div>
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-gray-500">
            <Library className="w-8 h-8" />
            <span className="text-[11px]">{previewLabel ? 'Không có truyện nào khác' : 'Album trống'}</span>
          </div>
        )}
        {previewLabel && covers.length > 0 && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/70 text-[10px] font-semibold text-white">
            {previewLabel}
          </span>
        )}
        {onToggleVisibility && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleVisibility(); }}
            title={album.is_public ? 'Đang công khai: bấm để chuyển riêng tư' : 'Đang riêng tư: bấm để công khai'}
            className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur transition ${
              album.is_public
                ? 'bg-emerald-500/85 text-snow hover:bg-emerald-500'
                : 'bg-black/70 text-gray-200 hover:bg-black/85'
            }`}
          >
            {album.is_public ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
            {album.is_public ? 'Công khai' : 'Riêng tư'}
          </button>
        )}
        <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/70 text-[10px] font-bold text-white">
          {album.story_count} truyện
        </span>
      </Link>

      <div className="p-3.5 space-y-1.5 flex-1 flex flex-col">
        {/* Title always reserves two lines so the rows below line up across cards */}
        <Link href={href} className="flex items-start gap-1.5 min-h-[2.5rem]">
          {album.is_public
            ? <Globe className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" aria-label="Công khai" />
            : <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-500" aria-label="Riêng tư" />}
          <h4 className="text-sm font-bold leading-5 text-white group-hover:text-brand-300 transition line-clamp-2">{album.name}</h4>
        </Link>
        <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
          {showOwner ? (
            <Link href={`/nguoi-dung/${album.owner_username}`} className="truncate hover:text-white">
              của <span className="font-semibold text-gray-300">{album.owner_name || album.owner_username}</span>
            </Link>
          ) : <span />}
          <span className="flex items-center gap-1 shrink-0" title="Số người đã lưu album">
            <Bookmark className="w-3 h-3" /> {album.save_count}
          </span>
        </div>
        {actions && <div className="pt-2 mt-auto flex flex-wrap gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}
