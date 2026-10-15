'use client';

import React from 'react';
import SkinChibi, { useChibiOn } from '@/components/skin/aemeath/SkinChibi';

interface BookLoaderProps {
  /** Text under the animation. Pass an empty string for animation only. */
  label?: string;
  size?: 'sm' | 'md';
  /** Wait this long before showing anything, so fast loads never flash a spinner */
  delayMs?: number;
  className?: string;
}

/** Page-flipping book animation (pure CSS). */
export default function BookLoader({ label = 'Đang tải...', size = 'md', delayMs = 0, className = '' }: BookLoaderProps) {
  const { on } = useChibiOn();
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 ${delayMs > 0 ? 'nh-loader-fade' : ''} ${className}`}
      style={delayMs > 0 ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      {on && size === 'md' ? (
        // Skin Aemeath: chibi nhún nhảy + mèo thay cho sách lật
        <div className="sk-chibi-loader" aria-hidden="true">
          <div className="sk-chibi-loader__hop">
            <SkinChibi pose="cheer" mood="happy" free size={92} seed="loader" />
          </div>
        </div>
      ) : (
        <div className={`nh-book ${size === 'sm' ? 'nh-book--sm' : ''}`} aria-hidden="true">
          <div className="nh-book__base" />
          <div className="nh-book__page" />
          <div className="nh-book__page" />
          <div className="nh-book__page" />
        </div>
      )}
      {label ? <span className="text-xs font-semibold text-gray-400 tracking-wide">{label}</span> : <span className="sr-only">Đang tải</span>}
    </div>
  );
}
