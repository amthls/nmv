'use client';

import React, { useEffect, useState } from 'react';
import { Gauge, Wifi, WifiOff, Monitor } from 'lucide-react';
import { AutoQualityInfo, IMAGE_QUALITY_OPTIONS, detectAutoQuality, useImageQuality } from '@/lib/imageQuality';

/** Image resolution choice for manga pages / illustrations, with what "Tự động" picks on this device. */
export default function ImageQualityPicker({ compact = false }: { compact?: boolean }) {
  const [quality, setQuality] = useImageQuality();
  const [auto, setAuto] = useState<AutoQualityInfo | null>(null);

  useEffect(() => {
    const update = () => setAuto(detectAutoQuality());
    update();
    window.addEventListener('resize', update);
    const conn = (navigator as any).connection;
    conn?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      conn?.removeEventListener?.('change', update);
    };
  }, []);

  const current = IMAGE_QUALITY_OPTIONS.find((q) => q.id === quality);

  return (
    <div className="space-y-2">
      <div className={`grid gap-1.5 ${compact ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-6'}`}>
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
              {q.id === 'auto' ? (auto ? `${auto.width}px` : '…') : q.width ? `${q.width}px` : 'không nén'}
            </span>
          </button>
        ))}
      </div>

      <p className="text-[11px] text-gray-400">{current?.hint}. Áp dụng cho trang truyện tranh, ảnh minh họa và ảnh trong bài viết.</p>

      {auto && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/5 px-2.5 py-2 text-[10.5px] text-gray-400">
          <span className="flex items-center gap-1 font-semibold text-gray-300">
            <Gauge className="w-3.5 h-3.5 text-brand-400" /> Máy của bạn:
          </span>
          <span className="flex items-center gap-1">
            <Monitor className="w-3 h-3" /> màn hình {auto.screenWidth}px × {auto.pixelRatio.toFixed(auto.pixelRatio % 1 ? 1 : 0)}
          </span>
          <span className="flex items-center gap-1">
            {auto.slowNetwork || auto.saveData ? <WifiOff className="w-3 h-3 text-amber-400" /> : <Wifi className="w-3 h-3" />}
            {auto.saveData ? 'đang bật tiết kiệm dữ liệu' : auto.slowNetwork ? 'mạng chậm' : 'mạng ổn định'}
          </span>
          <span>→ “Tự động” dùng <b className="text-gray-200">{auto.width}px</b></span>
        </div>
      )}
    </div>
  );
}
