'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, FileText, GitMerge, History, Loader2, Pencil, Plus, RotateCcw, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { chapterUploadHref } from '@/lib/chapterUpload';

/**
 * The "flow" of one story in the workspace: each category (volume) is a stream of water flowing sideways with its
 * chapters floating on it, like a console home screen. Picking a chapter opens its versions underneath, as a stream
 * too, newest (the one in use) first, each with what it can do.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const WS_URL = '/api/ws';
// many imported titles repeat the number ("Chương 1 - Bắt đầu"): the tile already shows it
const shortTitle = (t: string) => t.replace(/^\s*Chương\s*[\d.]+\s*[-:–]\s*/i, '') || t;
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
  const versionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStory(null);
    setError(null);
    authFetch(`${API_BASE_URL}/stories/${slug}`).then((r) => r.json())
      .then((j) => (j.success ? setStory(j.data) : setError(j.message || 'Không tải được truyện.')))
      .catch((e) => setError(e.message));
  }, [slug, authFetch]);

  // a picked chapter's versions open below the streams: bring them into view
  useEffect(() => {
    if (chapterId && story) versionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chapterId, story]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!story) return <p className="flex items-center gap-2 py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Đang mở truyện...</p>;

  const categories: { title: string; chapters: any[] }[] = [
    ...(story.volumes || []).map((v: any) => ({ title: v.title, chapters: v.chapters || [] })),
    ...(story.unassigned_chapters?.length ? [{ title: 'Chưa phân tập', chapters: story.unassigned_chapters }] : []),
  ];
  const all = categories.flatMap((c) => c.chapters);
  const chosen = all.find((c) => c.id === chapterId);
  const isManga = story.story_type === 'manga';
  const myDrafts = drafts.filter((d) => d.story_id === story.id).length;
  const btn = 'px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition';

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">{story.title}</h2>
          <p className="mt-1 text-xs text-gray-300">
            {story.group_name || 'Độc lập'} · {isManga ? 'Truyện tranh' : 'Truyện chữ'} · {all.length} chương
            {myDrafts > 0 && <span className="text-amber-300"> · {myDrafts} nháp của tôi</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={chapterUploadHref({ storyType: story.story_type, storyId: story.id, chosen: true })} className={`${btn} bg-brand-600 hover:bg-brand-500 text-snow shadow-lg shadow-brand-500/25`}>
            <Plus className="w-4 h-4" /> Chương mới
          </Link>
          <Link href={`/ws/truyen/${story.slug}`} className={`${btn} bg-white/10 hover:bg-white/15 text-gray-100`}>
            <GitMerge className="w-4 h-4" /> Việc & đề xuất
          </Link>
          {story.group_slug && (
            <Link href={`/ws/nhom/${story.group_slug}`} className={`${btn} bg-white/10 hover:bg-white/15 text-gray-100`}>
              <Users className="w-4 h-4" /> Workspace nhóm
            </Link>
          )}
          <Link href={`/truyen/${story.slug}`} className={`${btn} bg-white/10 hover:bg-white/15 text-gray-100`}>
            <BookOpen className="w-4 h-4" /> Trang truyện
          </Link>
        </div>
      </div>

      {categories.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-gray-400">
          Truyện chưa có chương nào. Bấm <b className="text-white">Chương mới</b> để bắt đầu.
        </p>
      )}

      {categories.map((c) => (
        <section key={c.title} aria-label={c.title}>
          <div className="mb-1 flex items-baseline gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-sky-300">{c.title}</h3>
            <span className="text-[11px] text-gray-500">{c.chapters.length} chương</span>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5" style={{ scrollbarWidth: 'thin' }}>
            <div className="ws-stream flex w-max min-w-full gap-3 py-4 pr-8">
              {c.chapters.map((ch: any) => {
                const mine = drafts.some((d) => d.chapter_id === ch.id);
                const on = ch.id === chapterId;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => onPickChapter(on ? '' : ch.id)}
                    aria-pressed={on}
                    title={on ? 'Bấm lần nữa để đóng' : 'Xem các phiên bản'}
                    className={`relative h-24 w-36 sm:w-40 shrink-0 rounded-2xl border p-3 text-left backdrop-blur-md transition duration-300 ${
                      on ? 'scale-105 border-sky-300 bg-sky-500/25 shadow-xl shadow-sky-500/30' : 'border-white/10 bg-surface-2/80 hover:-translate-y-1 hover:border-sky-400/50'
                    }`}
                  >
                    <div className="text-[11px] font-bold text-sky-300">Chương {Number(ch.chapter_number)}</div>
                    <div className="mt-0.5 line-clamp-2 text-sm font-semibold text-white">{shortTitle(ch.title)}</div>
                    {mine && <span className="absolute bottom-2 right-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">Nháp</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ))}

      <div ref={versionsRef} className="scroll-mt-24">
        {chosen ? (
          <ChapterVersions story={story} chapter={chosen} draft={drafts.find((d) => d.chapter_id === chosen.id)} isManga={isManga} />
        ) : (
          categories.length > 0 && <p className="text-xs text-gray-400">Bấm một chương trên dòng để xem các phiên bản của nó.</p>
        )}
      </div>
    </div>
  );
}

function ChapterVersions({ story, chapter, draft, isManga }: { story: any; chapter: any; draft?: any; isManga: boolean }) {
  const { authFetch } = useAuth();
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<number | null>(null); // version waiting for a second click
  const [n, setN] = useState(0);

  useEffect(() => {
    setRevs(null);
    setMsg(null);
    setAsking(null);
    authFetch(`${WS_URL}/chapters/${chapter.id}/revisions`).then((r) => r.json())
      .then((j) => (j.data ? setRevs(j.data) : setMsg(j.message || 'Không tải được phiên bản.')))
      .catch(() => setMsg('Không tải được phiên bản.'));
  }, [chapter.id, authFetch, n]);

  const useVersion = async (v: number) => {
    setBusy(true);
    const res = await authFetch(`${WS_URL}/chapters/${chapter.id}/rewind`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_version: v }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setAsking(null);
    if (res.ok) setN((x) => x + 1);
    setMsg(res.ok ? `Đã tạo phiên bản ${json.data.version} từ phiên bản ${v}.` : json.message || 'Không dùng được bản này (chỉ người giữ truyện).');
  };

  const versions = (revs || []).filter((r) => !r.deleted);
  return (
    <section className="space-y-3 rounded-3xl border border-sky-400/20 bg-sky-500/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-white">Chương {Number(chapter.chapter_number)}: {shortTitle(chapter.title)}</h3>
          <p className="text-[11px] text-gray-400">Bản đầu dòng (xanh lá) là bản người đọc đang thấy. “Dùng bản này” tạo phiên bản mới từ bản cũ, không mất bản nào.</p>
        </div>
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
          <Link href={`/truyen/${story.slug}/lich-su/${chapter.id}`} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-gray-200 flex items-center gap-1"><History className="w-3.5 h-3.5" /> So sánh các bản</Link>
        </div>
      </div>
      {msg && <p className="text-xs text-amber-300">{msg}</p>}
      {!revs && !msg && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      {revs && (
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5" style={{ scrollbarWidth: 'thin' }}>
          <ol className="ws-stream flex w-max min-w-full gap-3 py-3 pr-8">
            {versions.map((r, i) => (
              <li
                key={r.version}
                className={`w-48 shrink-0 rounded-2xl border p-3 backdrop-blur-md ${i === 0 ? 'border-emerald-400/60 bg-emerald-500/15 shadow-lg shadow-emerald-500/20' : 'border-white/10 bg-surface-2/85'}`}
              >
                <div className="flex items-center justify-between gap-2 text-sm font-bold text-white">
                  Phiên bản {r.version}
                  {i === 0 && <span className="rounded-full bg-emerald-500/25 px-2 py-0.5 text-[10px] text-emerald-200">Đang dùng</span>}
                </div>
                <p className="mt-1 text-[11px] text-gray-400">{SOURCE_LABEL[r.source] || r.source}{r.author_name ? ` · ${r.author_name}` : ''}</p>
                <p className="text-[11px] text-gray-500">{when(r.created_at)}</p>
                {i > 0 && (asking === r.version ? (
                  <div className="mt-2 flex gap-1.5">
                    <button disabled={busy} onClick={() => useVersion(r.version)} className="flex-1 rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-bold text-ink hover:bg-amber-400 disabled:opacity-50">
                      {busy ? 'Đang dùng...' : 'Chắc chắn'}
                    </button>
                    <button disabled={busy} onClick={() => setAsking(null)} className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-gray-300 hover:text-white">Hủy</button>
                  </div>
                ) : (
                  <button onClick={() => setAsking(r.version)} className="mt-2 flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:border-sky-400/60 hover:text-white">
                    <RotateCcw className="w-3 h-3" /> Dùng bản này
                  </button>
                ))}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
