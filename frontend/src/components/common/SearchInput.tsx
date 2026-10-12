'use client';

import React from 'react';
import { Loader2, Search, X } from 'lucide-react';

/**
 * A search field to the site standard (Plan/load-and-layout.md): search icon, a spinner and a loading bar while
 * `loading` (typing not settled yet, or the request running), a clear button. Pair it with useDebounced.
 */
export default function SearchInput({
  value, onChange, loading = false, placeholder, className = '', inputClassName = '', ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="text"
        enterKeyHint="search"
        aria-label={ariaLabel || placeholder || 'Tìm kiếm'}
        aria-busy={loading}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full h-10 pl-10 pr-16 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-brand-500 transition ${inputClassName}`}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
        {loading && <Loader2 className="w-4 h-4 animate-spin text-brand-400" aria-label="Đang tìm" />}
        {value && (
          <button type="button" onClick={() => onChange('')} aria-label="Xóa ô tìm" className="text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        )}
      </span>
      {loading && <div className="nh-loadbar -bottom-1.5 rounded-full" role="progressbar" aria-label="Đang tìm" />}
    </div>
  );
}
