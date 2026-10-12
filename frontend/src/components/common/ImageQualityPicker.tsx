'use client';

import React from 'react';
import { IMAGE_QUALITY_OPTIONS, useImageQuality } from '@/lib/imageQuality';

/** Image resolution choice for manga pages / illustrations. */
export default function ImageQualityPicker({ compact = false }: { compact?: boolean }) {
  const [quality, setQuality] = useImageQuality();
  const current = IMAGE_QUALITY_OPTIONS.find((q) => q.id === quality);

  return (
    <div className="space-y-2">
      <div className={`grid gap-1.5 ${compact ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-5'}`}>
        {IMAGE_QUALITY_OPTIONS.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => setQuality(q.id)}
            title={q.hint}
            className={`py-2 px-1 rounded-lg text-[11px] font-semibold border transition leading-tight ${
              quality === q.id
                ? 'bg-brand-600 border-brand-500 text-snow'
                : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
            }`}
          >
            <span className="block">{q.label}</span>
            <span className={`block text-[9.5px] font-normal ${quality === q.id ? 'text-snow/80' : 'text-gray-500'}`}>
              {q.width ? `${q.width}px` : 'không nén'}
            </span>
          </button>
        ))}
      </div>

      <p className="text-[11px] text-gray-400">{current?.hint}. Áp dụng cho trang truyện tranh, ảnh minh họa và ảnh trong bài viết.</p>

    </div>
  );
}
