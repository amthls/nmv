'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const STEP = 6; // suggestions shown at first and added per "Hiện thêm"
const MAX = 24;

type Hit = { id: string; slug: string; title: string; cover_image_url?: string; story_type: string; author_name?: string; total_chapters?: number };

/**
 * The navbar search field with live suggestions: typing (2+ characters) lists matching stories underneath
 * (/stories/explore, Elasticsearch with SQL fallback), "Hiện thêm" grows the list in place, the last row opens
 * every result on /kham-pha. ↑/↓ pick a row, Enter opens it (or the full results), Esc closes.
 */
export default function SearchBox({
  inputRef, className = '', inputClassName = '', placeholder = 'Tìm truyện, tác giả...', hint, onOpenChange, onNavigate,
}: {
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  hint?: React.ReactNode; // shown at the right of the field while it is not focused
  onOpenChange?: (open: boolean) => void;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const listId = useId();
  const box = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(STEP);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = query.trim();

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  // a new query starts from the first rows again
  useEffect(() => { setLimit(STEP); setActive(-1); }, [q]);

  useEffect(() => {
    if (q.length < 2) {
      setHits([]);
      setTotal(0);
      return;
    }
    let stale = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`${API_BASE_URL}/stories/explore?${new URLSearchParams({ q, sort: 'relevance', limit: String(limit), page: '1' })}`)
        .then((r) => r.json())
        .then((j) => {
          if (stale || !j.success) return;
          setHits(j.data || []);
          setTotal(j.pagination?.total ?? (j.data || []).length);
        })
        .catch(() => {})
        .finally(() => !stale && setLoading(false));
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [q, limit]);

  // close when clicking anywhere else
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    onNavigate?.();
    router.push(href);
  };
  const allResults = q ? `/kham-pha?q=${encodeURIComponent(q)}` : '/kham-pha';

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(hits.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
  };

  const showList = open && q.length >= 2;
  return (
    <form
      ref={box}
      role="search"
      className={`relative group ${className}`}
      onSubmit={(e) => { e.preventDefault(); go(active >= 0 && hits[active] ? `/truyen/${hits[active].slug}` : allResults); }}
    >
      <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand-400 transition pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        enterKeyHint="search"
        aria-label="Tìm kiếm"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={inputClassName}
      />
      {hint}

      {showList && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-2xl glass-menu overflow-hidden shadow-2xl">
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-400">{loading ? 'Đang tìm...' : `Không thấy truyện nào khớp “${q}”.`}</p>
          ) : (
            <ul id={listId} role="listbox" className="max-h-[60vh] overflow-y-auto py-1.5">
              {hits.map((h, i) => (
                <li key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(`/truyen/${h.slug}`)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${i === active ? 'bg-white/10' : 'hover:bg-white/5'}`}
                  >
                    <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-white/5">
                      {h.cover_image_url && <SmartImage src={h.cover_image_url} alt="" className="h-full w-full object-cover" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">{h.title}</span>
                      <span className="block truncate text-[11px] text-gray-400">
                        {h.story_type === 'manga' ? 'Truyện tranh' : 'Truyện chữ'}{h.author_name ? ` · ${h.author_name}` : ''}{h.total_chapters ? ` · ${h.total_chapters} chương` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hits.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2">
              {total > hits.length && limit < MAX ? (
                <button type="button" onClick={() => setLimit((n) => n + STEP)} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-bold text-white flex items-center gap-1.5">
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Hiện thêm
                </button>
              ) : <span />}
              <button type="button" onClick={() => go(allResults)} className="text-xs font-semibold text-brand-300 hover:text-brand-200">
                Xem tất cả {total} kết quả →
              </button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
