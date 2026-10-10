'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, FileText, Plus } from 'lucide-react';
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

export default function WorkspacePage() {
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
  const novels = (stories || []).filter((s) => s.story_type !== 'manga');

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="rounded-3xl p-6 glass-panel border border-white/10 bg-glass shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white">Workspace của tôi</h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            Bản nháp tự lưu, chỉ mình bạn thấy cho tới khi đăng. Sửa chương đã đăng cũng làm trên nháp, đăng là thành phiên bản mới.
          </p>
        </div>
        <Link href="/dang-chuong" className="shrink-0 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center gap-1.5 w-fit">
          <Plus className="w-4 h-4" /> Chương mới
        </Link>
      </div>

      {error && <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
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

        <section className="p-5 rounded-3xl glass-panel border border-white/10 bg-glass space-y-3 h-fit">
          <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen className="w-4 h-4" /> Truyện tôi tham gia
          </h2>
          {stories === null ? (
            <p className="text-xs text-gray-500">Đang tải...</p>
          ) : novels.length === 0 ? (
            <p className="text-xs text-gray-500">Bạn chưa đăng, chưa ở nhóm dịch nào, hoặc chưa là cộng tác viên của truyện chữ nào.</p>
          ) : (
            novels.map((s) => (
              <Link key={s.id} href={`/ws/truyen/${s.slug}`} className="block p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition">
                <div className="text-sm font-bold text-white truncate">{s.title}</div>
                <div className="text-[11px] text-gray-400">
                  {s.group_name || 'Độc lập'} · {drafts?.filter((d) => d.story_id === s.id).length || 0} nháp của tôi
                </div>
              </Link>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
