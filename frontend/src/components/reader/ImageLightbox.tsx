'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';

/** Full-size viewer for chapter illustrations: fit to screen, click (or the button) for actual size,
 *  ← → between the chapter's illustrations, Esc or the backdrop to close. */
export default function ImageLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: { src: string; alt?: string }[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(false);
  const img = images[index];

  useEffect(() => setZoom(false), [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
    };
  }, [index, images.length, onClose, onIndex]);

  if (!img) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true" aria-label="Xem ảnh minh họa">
      <div className="flex items-center justify-between px-4 h-12 text-snow text-xs shrink-0">
        <span className="opacity-70">{images.length > 1 ? `${index + 1} / ${images.length}` : 'Ảnh minh họa'}{img.alt ? ` · ${img.alt}` : ''}</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((z) => !z)} className="p-2 rounded-lg hover:bg-white/10" title={zoom ? 'Vừa màn hình' : 'Cỡ thật'}>
            {zoom ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
          </button>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" title="Đóng (Esc)"><X className="w-5 h-5" /></button>
        </div>
      </div>
      <div className={`relative flex-1 min-h-0 ${zoom ? 'overflow-auto' : 'flex items-center justify-center'}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.src}
          alt={img.alt || ''}
          onClick={() => setZoom((z) => !z)}
          className={zoom ? 'max-w-none mx-auto cursor-zoom-out' : 'max-w-[96vw] max-h-full object-contain cursor-zoom-in'}
        />
        {index > 0 && (
          <button type="button" onClick={() => onIndex(index - 1)} className="fixed left-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/70 text-snow" aria-label="Ảnh trước"><ChevronLeft className="w-6 h-6" /></button>
        )}
        {index < images.length - 1 && (
          <button type="button" onClick={() => onIndex(index + 1)} className="fixed right-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/70 text-snow" aria-label="Ảnh sau"><ChevronRight className="w-6 h-6" /></button>
        )}
      </div>
    </div>
  );
}
