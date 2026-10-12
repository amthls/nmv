'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, FileText, Handshake, Plus, User, Users } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import StoryFlow from '@/components/workspace/StoryFlow';
import { DraftRow } from '@/components/workspace/DraftRow';
import TaskCard from '@/components/workspace/TaskCard';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';

/**
 * Personal workspace (Plan/chapter-workspace.md, stage 2; layout Plan/ui-overhaul.md B4a): a shelf of the stories I take
 * part in (filtered by group, ←/→ to move) over the picked story's cover, its chapter streams (StoryFlow), then my tasks and drafts.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const WS_URL = '/api/ws';

function WorkspaceContent() {
  const search = useSearchParams();
  const storySlug = search?.get('truyen') || '';
  const chapterId = search?.get('chuong') || '';
  // only the URL changes: router.replace would refetch the page and show app/loading.tsx, which threw the page to the top
  const open = (truyen: string, chuong = '') => window.history.replaceState(null, '', `/ws?truyen=${truyen}${chuong ? `&chuong=${chuong}` : ''}`);
  const { user, isAuthenticated, isLoading, openAuthModal, authFetch } = useAuth();
  const [drafts, setDrafts] = useState<any[] | null>(null);
  const [stories, setStories] = useState<any[] | null>(null);
  const [shared, setShared] = useState<any[]>([]); // drafts others shared with me (được nhờ)
  const [myTasks, setMyTasks] = useState<any[]>([]); // workflow steps I took, in every group
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null); // shelf tab: 'mine' | 'collab' | 'g:<group slug>'; null = the picked story's
  const shelfRef = useRef<HTMLDivElement>(null);

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

  // whose story: a group's (worked on together, also in that group's workspace), mine alone, or someone's I help on
  const scopeOf = (s: any) => (s.group_id ? `g:${s.group_slug}` : s.uploader_id === user?.id ? 'mine' : 'collab');
  const picked = (stories || []).find((s) => s.slug === storySlug);
  const scopes = Array.from(new Set((stories || []).map(scopeOf)))
    .sort((a, b) => (a === 'mine' ? -1 : b === 'mine' ? 1 : a === 'collab' ? 1 : b === 'collab' ? -1 : 0));
  const activeScope = scope ?? (picked ? scopeOf(picked) : scopes[0]);
  const shelf = (stories || []).filter((s) => scopeOf(s) === activeScope);
  const groupOfScope = (sc: string) => (stories || []).find((s) => scopeOf(s) === sc);

  // nothing picked yet: open the first story so the streams show right away
  useEffect(() => {
    if (!storySlug && shelf.length) open(shelf[0].slug);
  }, [storySlug, shelf.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the picked cover in view on the shelf
  useEffect(() => {
    shelfRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [storySlug, activeScope, stories]);

  const step = (dir: number) => {
    if (!shelf.length) return;
    const i = shelf.findIndex((s) => s.slug === storySlug);
    open(shelf[Math.min(shelf.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))].slug);
  };

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
  const pickScope = (sc: string) => {
    setScope(sc);
    const first = (stories || []).find((s) => scopeOf(s) === sc);
    if (first) open(first.slug);
  };
  const scopeLabel = (sc: string) => (sc === 'mine' ? 'Truyện của tôi' : sc === 'collab' ? 'Tôi cộng tác' : `Nhóm ${groupOfScope(sc)?.group_name}`);
  const ScopeIcon = (sc: string) => (sc === 'mine' ? User : sc === 'collab' ? Handshake : Users);
  const activeGroup = activeScope?.startsWith('g:') ? groupOfScope(activeScope) : null;

  return (
    <div className="relative">
      {/* the picked story's cover, blurred, behind the top of the page (fades out downwards) */}
      {picked?.cover_image_url && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[560px] overflow-hidden" style={{ maskImage: 'linear-gradient(to bottom, black 30%, transparent)' }}>
          <SmartImage key={picked.id} src={picked.cover_image_url} alt="" className="h-full w-full scale-110 object-cover opacity-35 blur-2xl" />
        </div>
      )}
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white">Workspace của tôi</h1>
            <p className="mt-1 text-xs text-gray-400">Bàn làm việc riêng của bạn: chương, nháp và việc bạn nhận. Mỗi nhóm dịch có workspace nhóm riêng.</p>
            <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300">
              {['Chọn truyện trên kệ', 'Bấm chương trên dòng chảy', 'Xem phiên bản, sửa hoặc dùng bản cũ'].map((t, i) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-snow">{i + 1}</span>{t}
                </li>
              ))}
            </ol>
          </div>
          <Link href="/dang-chuong" className="shrink-0 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center gap-1.5 w-fit">
            <Plus className="w-4 h-4" /> Chương mới
          </Link>
        </div>

        {error && <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold">{error}</div>}

        <section className="space-y-3" aria-label="Truyện của tôi">
          {stories === null ? (
            <p className="text-xs text-gray-400">Đang tải...</p>
          ) : stories.length === 0 ? (
            <p className="text-xs text-gray-400">Bạn chưa đăng, chưa ở nhóm dịch nào, hoặc chưa là cộng tác viên của truyện nào. <Link href="/dang-truyen" className="underline">Đăng truyện mới</Link></p>
          ) : (
            <>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Truyện theo chủ sở hữu">
                {scopes.map((sc) => {
                  const Icon = ScopeIcon(sc);
                  const on = sc === activeScope;
                  const group = sc.startsWith('g:');
                  return (
                    <button
                      key={sc}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => pickScope(sc)}
                      className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition ${
                        on ? (group ? 'bg-emerald-600 border-emerald-500 text-snow' : 'bg-brand-600 border-brand-500 text-snow') : 'border-white/15 text-gray-300 hover:text-white hover:border-white/40'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" /> {scopeLabel(sc)} ({stories.filter((s) => scopeOf(s) === sc).length})
                    </button>
                  );
                })}
              </div>
              {activeGroup ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-100">
                  <span>Truyện của <b>nhóm {activeGroup.group_name}</b>: bạn làm chương của mình ở đây. Việc chung, bản dịch chờ duyệt và hoạt động của cả nhóm nằm ở workspace nhóm.</span>
                  <Link href={`/ws/nhom/${activeGroup.group_slug}`} className="shrink-0 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-snow hover:bg-emerald-500">
                    <Users className="w-3.5 h-3.5" /> Mở workspace nhóm
                  </Link>
                </div>
              ) : (
                <p className="text-xs text-gray-400">
                  {activeScope === 'mine' ? 'Truyện bạn tự đăng, không thuộc nhóm nào: chỉ bạn và cộng tác viên bạn mời làm ở đây.' : 'Truyện của người khác mời bạn cộng tác.'}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => step(-1)} aria-label="Truyện trước" className="hidden sm:grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white"><ChevronLeft className="w-5 h-5" /></button>
                <div
                  ref={shelfRef}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); } }}
                  aria-label="Kệ truyện (phím ← → để đổi truyện)"
                  className="-mx-4 flex min-w-0 flex-1 items-end gap-3 overflow-x-auto px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-xl sm:mx-0 sm:px-1"
                  style={{ scrollbarWidth: 'none' }}
                >
                  {shelf.map((s) => {
                    const on = s.slug === storySlug;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        tabIndex={-1}
                        onClick={() => open(s.slug)}
                        aria-pressed={on}
                        title={s.title}
                        className={`shrink-0 text-left transition-all duration-300 ${on ? 'w-32 sm:w-40' : 'w-20 sm:w-24 opacity-70 hover:opacity-100'}`}
                      >
                        <div className={`aspect-[3/4] overflow-hidden rounded-xl bg-white/5 transition-all duration-300 ${on ? 'ring-2 ring-brand-300 shadow-2xl shadow-black/50' : ''}`}>
                          {s.cover_image_url ? <SmartImage src={s.cover_image_url} alt={s.title} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center p-2 text-center text-[11px] text-gray-400">{s.title}</div>}
                        </div>
                        <div className={`mt-1.5 line-clamp-2 text-[11px] leading-tight ${on ? 'font-bold text-white' : 'text-gray-400'}`}>{s.title}</div>
                      </button>
                    );
                  })}
                </div>
                <button type="button" onClick={() => step(1)} aria-label="Truyện sau" className="hidden sm:grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white"><ChevronRight className="w-5 h-5" /></button>
              </div>
            </>
          )}
        </section>

        {storySlug && (
          <section className="rounded-3xl border border-white/10 bg-surface/60 p-4 sm:p-5 backdrop-blur-sm">
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
