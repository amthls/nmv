'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import StoryCardGrid, { CardMeta, Story } from './StoryCardGrid';
import Pagination from './Pagination';
import { columnsStyle, useAutoColumns } from '@/lib/useAutoColumns';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const TYPES = [['', 'Tất cả'], ['novel', 'Truyện chữ'], ['manga', 'Truyện tranh']] as const;
const PAGE_SIZE = 30;

/**
 * A page of its own for one homepage row ("Mới cập nhật", "Nhiều người xem"): every story in that order, filtered by
 * type, paged. Type and page live in the URL (?loai=&trang=) so Back and shared links keep them.
 */
export default function SortedStoriesPage({ title, subtitle, sort, meta, ranked = false }: {
  title: string; subtitle: string; sort: 'updated' | 'views'; meta: CardMeta; ranked?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const type = search?.get('loai') || '';
  const page = Math.max(1, Number(search?.get('trang')) || 1);
  const [stories, setStories] = useState<Story[] | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState(false);
  const [gridBox, columns] = useAutoColumns();

  useEffect(() => {
    let stale = false;
    setStories(null);
    setError(false);
    const q = new URLSearchParams({ sort, page: String(page), limit: String(PAGE_SIZE) });
    if (type) q.set('type', type);
    fetch(`${API_BASE_URL}/stories/explore?${q}`).then((r) => r.json())
      .then((j) => {
        if (stale) return;
        if (!j.success) throw new Error();
        setStories(j.data || []);
        setTotalPages(j.pagination?.totalPages || 1);
      })
      .catch(() => !stale && setError(true));
    return () => { stale = true; };
  }, [sort, type, page]);

  const go = (next: { loai?: string; trang?: number }) => {
    const q = new URLSearchParams();
    const loai = next.loai ?? type;
    const trang = next.trang ?? 1;
    if (loai) q.set('loai', loai);
    if (trang > 1) q.set('trang', String(trang));
    router.push(`${pathname}${q.size ? `?${q}` : ''}`);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold leading-snug text-white">{title}</h1>
          <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
        </div>
        <div role="tablist" aria-label="Loại truyện" className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10 w-full sm:w-fit overflow-x-auto scrollbar-none">
          {TYPES.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={type === value}
              onClick={() => go({ loai: value })}
              className={`flex-1 sm:flex-none whitespace-nowrap min-h-11 sm:min-h-0 px-3.5 py-1.5 rounded-lg text-sm sm:text-xs font-bold transition ${type === value ? 'bg-brand-600 text-snow' : 'text-gray-300 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="text-sm text-rose-300">Không tải được danh sách. Thử tải lại trang.</p>}
      <div ref={gridBox} className="grid gap-3 sm:gap-4 gap-y-5 sm:gap-y-6" style={columnsStyle(columns)}>
        {stories === null && !error
          ? Array.from({ length: columns * 2 }, (_, i) => <div key={i} className="aspect-[2/3] rounded-xl bg-white/5 animate-pulse" />)
          : (stories || []).map((s, i) => (
            <StoryCardGrid key={s.id} story={s} meta={meta} rank={ranked ? (page - 1) * PAGE_SIZE + i + 1 : undefined} />
          ))}
      </div>
      {stories?.length === 0 && <p className="text-sm text-gray-400">Chưa có truyện nào.</p>}
      {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={(p) => go({ trang: p })} />}
    </div>
  );
}
