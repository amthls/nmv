'use client';

import dynamic from 'next/dynamic';
import { useSkin } from '@/lib/theme';
import { pickSticker, useChibiPrefs, type ChibiMood, type ChibiPose, type ChibiSticker } from './chibiPrefs';

// Tải lazy: chỉ khi skin Aemeath bật và chibi chưa bị tắt thì mới kéo mã chibi.
const AeChibi = dynamic(() => import('./chibi').then((m) => m.AeChibi), { ssr: false });

interface Props {
  pose?: ChibiPose;
  mood?: ChibiMood;
  /** Chỗ "trang trí" (không gắn cảm xúc cụ thể): dùng sticker người dùng chọn / ngẫu nhiên ổn định theo seed. */
  free?: boolean;
  sticker?: ChibiSticker;
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
export default function SkinChibi({ pose = 'hi', mood = 'happy', free, sticker, seed = '', size = 96, animate = true, className = '' }: Props) {
  const { on, prefs } = useChibiOn();
  if (!on) return null;
  const s = sticker ?? (free ? pickSticker(prefs.sticker, seed) : undefined);
  return (
    <span className={`inline-block pointer-events-none select-none ${className}`} aria-hidden="true">
      <AeChibi sticker={s} mood={mood} pose={pose} size={size} animate={animate} />
    </span>
  );
}

/** Chibi + bong bóng thoại ngắn, dùng cho trạng thái trống/không tìm thấy. Không render gì ngoài skin Aemeath. */
export function ChibiSay({ line, size = 88, className = '', ...rest }: Props & { line: string }) {
  const { on } = useChibiOn();
  if (!on) return null;
  return (
    <div className={`sk-chibi-say ${className}`}>
      <SkinChibi size={size} {...rest} />
      <p className="sk-chibi-say__bubble">{line}</p>
    </div>
  );
}
