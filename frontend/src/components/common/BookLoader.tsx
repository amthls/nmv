import React from 'react';

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
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 ${delayMs > 0 ? 'nh-loader-fade' : ''} ${className}`}
      style={delayMs > 0 ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <div className={`nh-book ${size === 'sm' ? 'nh-book--sm' : ''}`} aria-hidden="true">
        <div className="nh-book__base" />
        <div className="nh-book__page" />
        <div className="nh-book__page" />
        <div className="nh-book__page" />
      </div>
      {label ? <span className="text-xs font-semibold text-gray-400 tracking-wide">{label}</span> : <span className="sr-only">Đang tải</span>}
    </div>
  );
}
