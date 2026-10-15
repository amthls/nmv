'use client';

import dynamic from 'next/dynamic';
import { useSkin } from '@/lib/theme';
import { CHIBI_BADGES, pickSticker, useChibiPrefs, type ChibiBadge, type ChibiMood, type ChibiPose, type ChibiSticker } from './chibiPrefs';

// Tải lazy: chỉ khi skin Aemeath bật và chibi chưa bị tắt thì mới kéo mã chibi.
const AeChibi = dynamic(() => import('./chibi').then((m) => m.AeChibi), { ssr: false });
const AeBadge = dynamic(() => import('./chibi').then((m) => m.AeBadge), { ssr: false });

interface Props {
  pose?: ChibiPose;
  mood?: ChibiMood;
  /** Chỗ "trang trí" (không gắn cảm xúc cụ thể): dùng sticker người dùng chọn / ngẫu nhiên ổn định theo seed. */
  free?: boolean;
  sticker?: ChibiSticker;
  /** Huy hiệu tròn: dùng thẳng, hoặc (cùng free) làm mặc định nếu người dùng chọn huy hiệu làm trợ lý. */
  badge?: ChibiBadge;
  seed?: string;
  size?: number;
  animate?: boolean;
  className?: string;
}

/** Hook chung: skin Aemeath và chibi đang bật? */
export function useChibiOn() {
  const { skin } = useSkin();
  const prefs = useChibiPrefs();
  return { on: skin === 'aemeath' && prefs.enabled, prefs };
}

/** Chibi Aemeath; skin mặc định (hoặc đã tắt chibi) thì không render và không tải gì. */
export default function SkinChibi({ pose = 'hi', mood = 'happy', free, sticker, badge, seed = '', size = 96, animate = true, className = '' }: Props) {
  const { on, prefs } = useChibiOn();
  if (!on) return null;
  const b = badge ?? (free && CHIBI_BADGES.some((x) => x.id === prefs.sticker) ? (prefs.sticker as ChibiBadge) : undefined);
  if (b) {
    return (
      <span className={`inline-block pointer-events-none select-none ${className}`} aria-hidden="true">
        <AeBadge name={b} size={Math.min(size, 96)} />
      </span>
    );
  }
  const s = sticker ?? (free ? pickSticker(prefs.sticker, seed) : undefined);
  return (
    <span className={`inline-block pointer-events-none select-none ${className}`} aria-hidden="true">
      <AeChibi sticker={s} mood={mood} pose={pose} size={size} animate={animate} />
    </span>
  );
}

/** Chibi + bong bóng thoại ngắn, dùng cho trạng thái trống/không tìm thấy. Không render gì ngoài skin Aemeath. */
export function ChibiSay({ line, size = 88, className = '', plane, ...rest }: Props & { line: string; plane?: boolean }) {
  const { on } = useChibiOn();
  if (!on) return null;
  return (
    <div className={`sk-chibi-say ${className}`}>
      {plane ? (
        // Thẻ minh hoạ giữ nguyên dòng bản quyền Kuro Games ở đáy ảnh
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/backgrounds/aemeath/chibi/plane.webp" alt="" aria-hidden width={178} height={200} loading="lazy" className="rounded-2xl shadow-lg" />
      ) : (
        <SkinChibi size={size} {...rest} />
      )}
      <p className="sk-chibi-say__bubble">{line}</p>
    </div>
  );
}
