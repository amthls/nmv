'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BookOpen, FileText, Plus } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import StoryFlow from '@/components/workspace/StoryFlow';
import { DraftRow } from '@/components/workspace/DraftRow';
import TaskCard from '@/components/workspace/TaskCard';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';

/**
 * Personal workspace (Plan/chapter-workspace.md, stage 2): my open chapter drafts across every story, and the
 * stories I take part in (each with its own workspace page).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const WS_URL = '/api/ws';

function WorkspaceContent() {
  const router = useRouter();
  const search = useSearchParams();
  const storySlug = search?.get('truyen') || '';
  const chapterId = search?.get('chuong') || '';
  const open = (truyen: string, chuong = '') => router.push(`/ws?truyen=${truyen}${chuong ? `&chuong=${chuong}` : ''}`, { scroll: false });
  const { user, isAuthenticated, isLoading, openAuthModal, authFetch } = useAuth();
  const [drafts, setDrafts] = useState<any[] | null>(null);
  const [stories, setStories] = useState<any[] | null>(null);
  const [shared, setShared] = useState<any[]>([]); // drafts others shared with me (được nhờ)
  const [myTasks, setMyTasks] = useState<any[]>([]); // workflow steps I took, in every group
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    authFetch(`${WS_URL}/drafts`).then((r) => r.json())
      .then((j) => (j.success ? setDrafts(j.data) : setError(j.message || 'Không tải được bản nháp.')))
      .catch((e) => setError(e.message));
    authFetch(`${WS_URL}/tasks?mine=1`).then((r) => r.json())
      .then((j) => j.success && setMyTasks(j.data)).catch(() => {});
    authFetch(`${WS_URL}/drafts/shared`).then((r) => r.json())
      .then((j) => j.success && setShared(j.data)).catch(() => {});
    authFetch(`${API_BASE_URL}/stories/manageable`).then((r) => r.json())
      .then((j) => setStories(j.success ? j.data || [] : []))
      .catch(() => setStories([]));
  }, [isAuthenticated, authFetch, reload]);

  if (isLoading) return <PageLoader label="Đang mở workspace..." />;
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
        <p className="text-sm text-gray-400">Đăng nhập để xem bản nháp và các truyện bạn tham gia.</p>
        <button onClick={() => openAuthModal('login')} className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm">
          Đăng nhập
        </button>
      </div>
    );
  }

  const storyTitle = (id: string) => stories?.find((s) => s.id === id)?.title;
  const byGroup = (stories || []).reduce((m: Record<string, any[]>, s) => {
    (m[s.group_name || 'Độc lập'] ||= []).push(s);
    return m;
  }, {});

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="rounded-3xl p-6 glass-panel border border-white/10 bg-glass shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white">Workspace</h1>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">Nơi làm chương của bạn và của nhóm. Bản nháp tự lưu, chỉ mình bạn thấy cho tới khi đăng.</p>
          </div>
          <Link href="/dang-chuong" className="shrink-0 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center gap-1.5 w-fit">
            <Plus className="w-4 h-4" /> Chương mới
          </Link>
        </div>
        <ol className="grid gap-2 sm:grid-cols-3 text-xs">
          {['Chọn một bộ truyện bên dưới', 'Chọn chương trong dải danh mục', 'Xem phiên bản, sửa hoặc dùng bản cũ'].map((t, i) => (
            <li key={t} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-gray-300">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-snow">{i + 1}</span>{t}
            </li>
          ))}
        </ol>
      </div>

      {error && <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold">{error}</div>}

      <section className="space-y-4" aria-label="Truyện của tôi">
        <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5">
          <BookOpen className="w-4 h-4" /> Truyện của tôi
        </h2>
        {stories === null ? (
          <p className="text-xs text-gray-500">Đang tải...</p>
        ) : stories.length === 0 ? (
          <p className="text-xs text-gray-500">Bạn chưa đăng, chưa ở nhóm dịch nào, hoặc chưa là cộng tác viên của truyện nào. <Link href="/dang-truyen" className="underline">Đăng truyện mới</Link></p>
        ) : (
          Object.entries(byGroup).map(([group, list]) => (
            <div key={group}>
              <div className="mb-2 text-[11px] font-bold text-gray-400">{group}</div>
              <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
                {list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => open(s.slug)}
                    aria-pressed={s.slug === storySlug}
                    className={`w-28 shrink-0 snap-start text-left transition duration-200 hover:-translate-y-1 ${s.slug === storySlug ? 'opacity-100' : 'opacity-80 hover:opacity-100'}`}
                  >
                    <div className={`aspect-[3/4] overflow-hidden rounded-xl border-2 bg-white/5 ${s.slug === storySlug ? 'border-brand-400 shadow-lg shadow-brand-500/30' : 'border-transparent'}`}>
                      {s.cover_image_url ? <SmartImage src={s.cover_image_url} alt={s.title} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center p-2 text-center text-xs text-gray-400">{s.title}</div>}
                    </div>
                    <div className="mt-1.5 line-clamp-2 text-xs font-semibold text-white">{s.title}</div>
                    <div className="text-[10px] text-gray-500">{drafts?.filter((d) => d.story_id === s.id).length || 0} nháp của tôi</div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {storySlug && (
        <section className="rounded-3xl border border-white/10 bg-glass p-4 sm:p-5">
          <StoryFlow slug={storySlug} drafts={drafts || []} chapterId={chapterId} onPickChapter={(id) => open(storySlug, id)} />
        </section>
      )}

      <section className="p-5 rounded-3xl glass-panel border border-white/10 bg-glass space-y-3">
        {myTasks.length > 0 && (
          <>
            <h2 className="text-xs font-bold text-emerald-300 uppercase tracking-wider">Việc của tôi ({myTasks.length})</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {myTasks.map((t) => (
                <TaskCard key={t.id} t={t} me={user?.id} keeper={false} storyTitle={storyTitle(t.story_id)} authFetch={authFetch} onChanged={() => setReload((n) => n + 1)} />
              ))}
            </div>
          </>
        )}
        <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5">
          <FileText className="w-4 h-4" /> Nháp của tôi {drafts ? `(${drafts.length}/50)` : ''}
        </h2>
        {drafts === null ? (
          <p className="text-xs text-gray-500">Đang tải...</p>
        ) : drafts.length === 0 ? (
          <p className="text-xs text-gray-500">Chưa có bản nháp nào. Bấm “Chương mới”, hoặc “Sửa” ở một chương đã đăng.</p>
        ) : (
          drafts.map((d) => <DraftRow key={d.id} d={d} storyTitle={storyTitle(d.story_id)} />)
        )}
        {shared.length > 0 && (
          <>
            <h2 className="pt-3 text-xs font-bold text-sky-300 uppercase tracking-wider">Được nhờ ({shared.length})</h2>
            {shared.map((d) => <DraftRow key={d.id} d={d} storyTitle={`${storyTitle(d.story_id) || ''} · của ${d.owner_name || 'người khác'} · ${d.can_edit ? 'được sửa' : 'chỉ xem'}`} />)}
          </>
        )}
      </section>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<PageLoader label="Đang mở workspace..." />}>
      <WorkspaceContent />
    </Suspense>
  );
}
