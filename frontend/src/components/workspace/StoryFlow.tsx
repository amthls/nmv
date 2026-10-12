'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, FileText, History, Loader2, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { chapterUploadHref } from '@/lib/chapterUpload';

/**
 * The "flow" of one story in the workspace: one horizontal strip of chapter tiles per category (volume), scrolled
 * sideways like a console home screen. Picking a tile opens its versions underneath, with what each can do.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const WS_URL = '/api/ws';
const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

type Rev = { version: number; source: string; deleted: boolean; author_name: string | null; created_at: string; block_count: number };
const SOURCE_LABEL: Record<string, string> = {
  import: 'Bản gốc', create: 'Đăng chương', edit: 'Sửa', rewind: 'Khôi phục bản cũ', delete: 'Xóa chương', restore: 'Khôi phục chương',
};

export default function StoryFlow({
  slug, drafts, chapterId, onPickChapter,
}: { slug: string; drafts: any[]; chapterId: string; onPickChapter: (id: string) => void }) {
  const { authFetch } = useAuth();
  const [story, setStory] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStory(null);
    setError(null);
    authFetch(`${API_BASE_URL}/stories/${slug}`).then((r) => r.json())
      .then((j) => (j.success ? setStory(j.data) : setError(j.message || 'Không tải được truyện.')))
      .catch((e) => setError(e.message));
  }, [slug, authFetch]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!story) return <p className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Đang mở truyện...</p>;

  const categories: { title: string; chapters: any[] }[] = [
    ...(story.volumes || []).map((v: any) => ({ title: v.title, chapters: v.chapters || [] })),
    ...(story.unassigned_chapters?.length ? [{ title: 'Chưa phân tập', chapters: story.unassigned_chapters }] : []),
  ];
  const all = categories.flatMap((c) => c.chapters);
  const chosen = all.find((c) => c.id === chapterId);
  const isManga = story.story_type === 'manga';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-extrabold text-white">{story.title}</h2>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <Link href={chapterUploadHref({ storyType: story.story_type, storyId: story.id })} className="px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Chương mới
          </Link>
          <Link href={`/ws/truyen/${story.slug}`} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-200">Việc và đề xuất</Link>
        </div>
      </div>

      {categories.length === 0 && <p className="text-xs text-gray-500">Truyện chưa có chương nào. Bấm “Chương mới” để bắt đầu.</p>}

      {categories.map((c) => (
        <section key={c.title} aria-label={c.title}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-brand-300">{c.title}</h3>
            <span className="text-[11px] text-gray-500">{c.chapters.length} chương</span>
          </div>
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" style={{ scrollbarWidth: 'thin' }}>
            {c.chapters.map((ch: any) => {
              const mine = drafts.some((d) => d.chapter_id === ch.id);
              const on = ch.id === chapterId;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => onPickChapter(ch.id)}
                  aria-pressed={on}
                  className={`group relative h-28 w-36 shrink-0 snap-start rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-1 hover:scale-[1.03] ${
                    on ? 'border-brand-400 bg-brand-600/25 shadow-lg shadow-brand-500/20' : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="text-xs font-bold text-brand-300">Chương {Number(ch.chapter_number)}</div>
                  <div className="mt-1 line-clamp-3 text-sm font-semibold text-white">{ch.title}</div>
                  {mine && <span className="absolute bottom-2 right-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">Nháp</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {chosen ? (
        <ChapterVersions story={story} chapter={chosen} draft={drafts.find((d) => d.chapter_id === chosen.id)} isManga={isManga} />
      ) : (
        categories.length > 0 && <p className="text-xs text-gray-500">Chọn một chương để xem các phiên bản của nó.</p>
      )}
    </div>
  );
}

function ChapterVersions({ story, chapter, draft, isManga }: { story: any; chapter: any; draft?: any; isManga: boolean }) {
  const { authFetch } = useAuth();
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);

  useEffect(() => {
    setRevs(null);
    authFetch(`${WS_URL}/chapters/${chapter.id}/revisions`).then((r) => r.json())
      .then((j) => (j.data ? setRevs(j.data) : setMsg(j.message || 'Không tải được phiên bản.')))
      .catch(() => setMsg('Không tải được phiên bản.'));
  }, [chapter.id, authFetch, n]);

  const useVersion = async (v: number) => {
    if (!confirm(`Đưa bản chính thức về nội dung phiên bản ${v}? (Tạo phiên bản mới, không mất phiên bản nào.)`)) return;
    setBusy(true);
    const res = await authFetch(`${WS_URL}/chapters/${chapter.id}/rewind`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_version: v }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? `Đã tạo phiên bản ${json.data.version} từ phiên bản ${v}.` : json.message || 'Không dùng được bản này (chỉ chủ truyện và trưởng nhóm).');
    if (res.ok) setN((x) => x + 1);
  };

  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white">Chương {Number(chapter.chapter_number)}: {chapter.title}</h3>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <Link href={`/truyen/${story.slug}/${chapter.slug}`} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-gray-200 flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> Đọc</Link>
          {!isManga && (
            <Link
              href={draft ? `/dang-chuong?draft=${draft.id}` : `/dang-chuong?edit=${chapter.id}`}
              className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow flex items-center gap-1"
            >
              {draft ? <FileText className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />} {draft ? 'Tiếp tục nháp' : 'Sửa chương'}
            </Link>
          )}
          <Link href={`/truyen/${story.slug}/lich-su/${chapter.id}`} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-gray-200 flex items-center gap-1"><History className="w-3.5 h-3.5" /> So sánh</Link>
        </div>
      </div>
      {msg && <p className="text-xs text-amber-300">{msg}</p>}
      {!revs && !msg && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      {revs && (
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {revs.filter((r) => !r.deleted).map((r, i) => (
            <li key={r.version} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2 text-sm font-semibold text-white">
                Phiên bản {r.version}
                {i === 0 && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-normal text-emerald-300">đang dùng</span>}
              </div>
              <p className="mt-1 text-[11px] text-gray-400">{SOURCE_LABEL[r.source] || r.source}{r.author_name ? ` · ${r.author_name}` : ''} · {when(r.created_at)}</p>
              {i > 0 && (
                <button disabled={busy} onClick={() => useVersion(r.version)} className="mt-2 flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-gray-300 hover:text-white disabled:opacity-50">
                  <RotateCcw className="w-3 h-3" /> Dùng bản này
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
