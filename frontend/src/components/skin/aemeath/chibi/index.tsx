'use client';

/* Aemeath chibi = the official animated "Slice of Life" stickers (Wuthering Waves wiki), converted to animated WebP
   in /public/backgrounds/aemeath/chibi. A hand-drawn SVG could not reach that quality, so the API keeps its
   outfit/mood/pose props but each combination maps onto one of the four stickers. */

export type ChibiOutfit = 'default' | 'school' | 'idol' | 'casual';
export type ChibiMood = 'happy' | 'wink' | 'sleepy' | 'surprised' | 'sad' | 'smug';
export type ChibiPose = 'hi' | 'peek' | 'sit' | 'read' | 'sign' | 'cheer';
export type ChibiSticker = 'hi' | 'sleepy' | 'smug' | 'music';
type Sticker = ChibiSticker;

const SRC = '/backgrounds/aemeath/chibi/';

function pick(mood: ChibiMood, pose: ChibiPose): Sticker {
  if (pose === 'peek') return 'sleepy'; // head resting on a desk edge: reads as peeking over the screen border
  if (mood === 'sleepy' || mood === 'sad') return 'sleepy';
  if (mood === 'smug' || mood === 'wink') return 'smug';
  if (pose === 'read' || pose === 'sit') return 'music';
  return 'hi';
}

export interface AeChibiProps {
  outfit?: ChibiOutfit;
  mood?: ChibiMood;
  pose?: ChibiPose;
  cat?: boolean;
  /** Chon thang sticker, bo qua mood/pose */
  sticker?: ChibiSticker;
  size?: number;
  className?: string;
  signText?: string;
  title?: string;
  /** false shows a still frame (also forced by prefers-reduced-motion via CSS swap below) */
  animate?: boolean;
}

export function AeChibi({ mood = 'happy', pose = 'hi', sticker, size = 120, className = '', signText, title, animate = true }: AeChibiProps) {
  const name = sticker ?? pick(mood, pose);
  const still = `${SRC}${name}.png`;
  const moving = `${SRC}${name}.webp`;
  return (
    <span className={`ae-chibi relative inline-block select-none ${className}`} style={{ width: size, height: size }}>
      <picture>
        {animate && <source srcSet={moving} media="(prefers-reduced-motion: no-preference)" />}
        <img
          src={still}
          alt={title ?? ''}
          aria-hidden={title ? undefined : true}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-contain"
        />
      </picture>
      {signText && (
        <span className="ae-chibi__sign absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold">
          {signText}
        </span>
      )}
    </span>
  );
}

/** No official standalone cat art exists; kept for API compatibility and renders nothing. */
export function AeCat(_: { mood?: ChibiMood; size?: number; className?: string }) {
  return null;
}

export type ChibiBadgeName = 'wink' | 'map' | 'heart' | 'wave';

/** Huy hiệu tròn (ảnh chính thức do chủ dự án cung cấp), dùng làm avatar 32-96px. */
export function AeBadge({ name, size = 56, className = '' }: { name: ChibiBadgeName; size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${SRC}badge-${name}.webp`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`rounded-full object-cover ring-2 ring-white/20 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
