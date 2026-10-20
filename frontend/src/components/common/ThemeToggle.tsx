'use client';

import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { SkinIcon } from '@/components/skin/aemeath/icons';
import { useTheme } from '@/lib/theme';

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      aria-label={isDark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
      title={isDark ? 'Giao diện sáng' : 'Giao diện tối'}
      className={`relative w-9 h-9 touch:w-11 touch:h-11 rounded-lg overflow-hidden bg-white/[0.04] border border-white/[0.08] hover:bg-brand-500/20 hover:border-brand-400/50 text-gray-300 hover:text-white transition ${className}`}
    >
      <SkinIcon lucide={Sun} ae="sun"
        className={`absolute inset-0 m-auto w-[18px] h-[18px] text-amber-500 transition-all duration-500 ease-silk ${
          isDark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'
        }`}
      />
      <SkinIcon lucide={Moon} ae="moon"
        className={`absolute inset-0 m-auto w-[18px] h-[18px] text-indigo-300 transition-all duration-500 ease-silk ${
          isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'
        }`}
      />
    </button>
  );
}
