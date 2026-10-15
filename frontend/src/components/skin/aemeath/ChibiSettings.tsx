'use client';

import { useSkin } from '@/lib/theme';
import SkinChibi from './SkinChibi';
import { CHIBI_ARTS, CHIBI_BADGES, CHIBI_STICKERS, useChibiPrefs, type StickerPref, type ChibiArt, type ChibiBadge, type ChibiSticker } from './chibiPrefs';

/** Trang tài khoản: chọn chibi trợ lý hoặc tắt chibi. Chỉ hiện khi skin Aemeath bật. */
export default function ChibiSettings() {
  const { skin } = useSkin();
  const { sticker, enabled, setSticker, setEnabled } = useChibiPrefs();
  if (skin !== 'aemeath') return null;
  const choices: { id: StickerPref; label: string }[] = [{ id: 'random', label: 'Ngẫu nhiên' }, ...CHIBI_STICKERS, ...CHIBI_BADGES, ...CHIBI_ARTS];
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-300 mb-3">Trợ lý chibi Aemeath</label>
      <label className="flex cursor-pointer items-center justify-between gap-4 text-xs font-semibold text-gray-300 mb-3">
        <span>Hiện chibi trên web</span>
        <input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-10 shrink-0 cursor-pointer accent-brand-500" />
      </label>
      {enabled && (
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-8 gap-2" role="radiogroup" aria-label="Chibi trợ lý">
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={sticker === c.id}
              onClick={() => setSticker(c.id)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition ${
                sticker === c.id ? 'border-brand-400 bg-brand-500/15 text-white' : 'border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.07]'
              }`}
            >
              {c.id === 'random' ? <span className="h-14 flex items-center text-2xl">🎲</span> : CHIBI_ARTS.some((a) => a.id === c.id) ? <SkinChibi art={c.id as ChibiArt} size={56} /> : CHIBI_BADGES.some((b) => b.id === c.id) ? <SkinChibi badge={c.id as ChibiBadge} size={56} /> : <SkinChibi sticker={c.id as ChibiSticker} size={56} animate={false} />}
              {c.label}
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10.5px] text-gray-500">Chibi nhỏ ở vài chỗ (truyện, thông báo, trang trống, cuối chương). Lưu ngay trên trình duyệt này.</p>
    </div>
  );
}
