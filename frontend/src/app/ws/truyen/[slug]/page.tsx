'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileText, GitMerge, History, Pencil, Plus } from 'lucide-react';
import { draftLabel } from '@/components/workspace/DraftRow';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';
import { DraftRow } from '@/components/workspace/DraftRow';
import TaskCard from '@/components/workspace/TaskCard';
import AssignForm from '@/components/workspace/AssignForm';

/**
 * Workspace of one story (Plan/chapter-workspace.md, stage 2): its official chapters with their history, and my
 * drafts in it. Other people's drafts stay private until stage 3 (proposals).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const WS_URL = '/api/ws';

export default function StoryWorkspacePage() {
  const slug = useParams()?.slug as string;
  const router = useRouter();
  const { user, isAuthenticated, isLoading, openAuthModal, authFetch } = useAuth();
  const [story, setStory] = useState<any>(null);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [proposals, setProposals] = useState<any[]>([]);
  const [orphans, setOrphans] = useState<any[]>([]); // keepers: drafts of people who left the story
  const [error, setError] = useState<string | null>(null);
  // Stage 4b: the story's tasks (board), whether I keep it, the team to assign to
  const [board, setBoard] = useState<{ tasks: any[]; keeper: boolean } | null>(null);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    authFetch(`${API_BASE_URL}/stories/${slug}`).then((r) => r.json())
      .then((j) => {
        if (!j.success) throw new Error(j.message || 'Không tìm thấy truyện.');
        setStory(j.data);
        if (j.data.can_manage) {
          authFetch(`${WS_URL}/board?story_id=${j.data.id}`).then((r) => r.json())
            .then((b) => b.success && setBoard({ tasks: b.data.tasks, keeper: b.data.keeper_of.includes(j.data.id) })).catch(() => {});
          // who can be given a step: the group's members, or the owner and collaborators of a story without a group
          const people = [{ id: j.data.uploader_id, name: j.data.uploader_name || 'Chủ truyện' },
            ...(j.data.collaborators || []).map((c: any) => ({ id: c.user_id, name: c.display_name || c.username }))];
          if (j.data.group_slug) {
            fetch(`${API_BASE_URL}/groups/${j.data.group_slug}`).then((r) => r.json())
              .then((g) => g.success && setTeam([...(g.data.members || []).map((m: any) => ({ id: m.user_id, name: `${m.display_name || m.username} (${m.role})` })), ...people.slice(1)]))
              .catch(() => setTeam(people));
          } else setTeam(people);
          authFetch(`${WS_URL}/proposals?story_id=${j.data.id}`).then((r) => r.json())
            .then((p) => p.success && setProposals(p.data)).catch(() => {});
          authFetch(`${WS_URL}/drafts/orphans?story_id=${j.data.id}`).then((r) => r.json())
            .then((o) => o.success && setOrphans(o.data)).catch(() => {}); // 403 for non-keepers: nothing to show
        }
        return authFetch(`${WS_URL}/drafts?story_id=${j.data.id}`).then((r) => r.json());
      })
      .then((j) => j?.success && setDrafts(j.data))
      .catch((e) => setError(e.message));
  }, [isAuthenticated, authFetch, slug, reload]);

  if (isLoading || (isAuthenticated && !story && !error)) return <PageLoader label="Đang mở workspace của truyện..." />;
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <button onClick={() => openAuthModal('login')} className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm">
          Đăng nhập để mở workspace
        </button>
      </div>
    );
  }
  if (error || !story) return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-rose-300">{error}</div>;
  if (!story.can_manage) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-gray-400">Bạn không tham gia truyện này nên không có workspace ở đây.</div>;
  }

  const draftOf = (chapterId: string) => drafts.find((d) => d.chapter_id === chapterId);
  const groups: { title: string; chapters: any[] }[] = [
    ...(story.volumes || []).map((v: any) => ({ title: v.title, chapters: v.chapters || [] })),
    ...(story.unassigned_chapters?.length ? [{ title: 'Chưa phân tập', chapters: story.unassigned_chapters }] : []),
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <Link href="/ws" className="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition">
        <ArrowLeft className="w-4 h-4" /> Workspace của tôi
      </Link>

      <div className="rounded-3xl p-6 glass-panel border border-white/10 bg-glass shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold text-white truncate">{story.title}</h1>
          <p className="text-xs text-gray-400 mt-1">
            {story.group_name || 'Độc lập'} · {story.total_chapters} chương đã đăng ·{' '}
            <Link href={`/truyen/${story.slug}`} className="underline hover:text-white">trang đọc</Link>
          </p>
        </div>
        {story.story_type !== 'manga' && (
          <Link
            href={`/dang-chuong?story_id=${story.id}`}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center gap-1.5 w-fit"
          >
            <Plus className="w-4 h-4" /> Chương mới
          </Link>
        )}
      </div>

      {proposals.length > 0 && (
        <section className="p-5 rounded-3xl glass-panel border border-sky-500/20 bg-glass space-y-3">
          <h2 className="text-xs font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
            <GitMerge className="w-4 h-4" /> Đề xuất chờ gộp ({proposals.length})
          </h2>
          {proposals.map((p) => (
            <Link key={p.id} href={`/ws/de-xuat/${p.id}`} className="block p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 transition">
              <div className="text-sm font-bold text-white truncate">{draftLabel(p)}</div>
              <div className="text-[11px] text-gray-400">
                {p.owner_name || 'Người viết'} · lần {p.last_round} · gửi {new Date(p.submitted_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}
                {p.note ? ` · “${p.note.slice(0, 80)}”` : ''}
              </div>
            </Link>
          ))}
        </section>
      )}

      {orphans.length > 0 && (
        <section className="p-5 rounded-3xl glass-panel border border-amber-500/20 bg-glass space-y-3">
          <h2 className="text-xs font-bold text-amber-300 uppercase tracking-wider">Nháp của người đã rời truyện ({orphans.length})</h2>
          <p className="text-[11px] text-gray-400">Nhận lại để công dịch không bị mất: nháp thành của bạn (đề xuất đang chờ thì được rút về).</p>
          {orphans.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/5 border border-white/10">
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">{draftLabel(o)}</div>
                <div className="text-[11px] text-gray-400">{o.owner_name || 'Người cũ'} · lưu {new Date(o.updated_at).toLocaleDateString('vi-VN')}</div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const res = await authFetch(`${WS_URL}/drafts/${o.id}/reclaim`, { method: 'POST' });
                  const json = await res.json().catch(() => ({}));
                  if (res.ok && json.success) router.push(`/dang-chuong?draft=${o.id}`);
                  else setError(json.message || 'Không nhận lại được.');
                }}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-ink text-[11px] font-bold"
              >
                Nhận lại
              </button>
            </div>
          ))}
        </section>
      )}

      {board && (
        <section className="p-5 rounded-3xl glass-panel border border-white/10 bg-glass space-y-3">
          <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider">Việc của truyện</h2>
          <AssignForm
            storyId={story.id}
            chapters={groups.flatMap((g) => g.chapters)}
            members={team}
            keeper={board.keeper}
            authFetch={authFetch}
            onDone={() => setReload((n) => n + 1)}
          />
          {board.tasks.filter((t) => t.status === 'open' || t.status === 'claimed').length === 0 && (
            <p className="text-xs text-gray-500">Không có việc nào đang mở.</p>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            {board.tasks.filter((t) => t.status === 'open' || t.status === 'claimed').map((t) => (
              <TaskCard key={t.id} t={t} me={user?.id} keeper={board.keeper} members={team} authFetch={authFetch} onChanged={() => setReload((n) => n + 1)} />
            ))}
          </div>
        </section>
      )}

      {drafts.length > 0 && (
        <section className="p-5 rounded-3xl glass-panel border border-white/10 bg-glass space-y-3">
          <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="w-4 h-4" /> Nháp của tôi trong truyện này ({drafts.length})
          </h2>
          {drafts.map((d) => <DraftRow key={d.id} d={d} />)}
        </section>
      )}

      <section className="p-5 rounded-3xl glass-panel border border-white/10 bg-glass space-y-4">
        <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider">Chương chính thức</h2>
        {groups.length === 0 && <p className="text-xs text-gray-500">Truyện chưa có chương nào.</p>}
        {groups.map((g) => (
          <div key={g.title} className="space-y-1.5">
            <div className="text-[11px] font-bold text-gray-300">{g.title} · {g.chapters.length} chương</div>
            {g.chapters.map((ch: any) => {
              const mine = draftOf(ch.id);
              return (
                <div key={ch.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white/5 border border-white/5">
                  <Link href={`/truyen/${story.slug}/${ch.slug}`} className="min-w-0 text-sm text-gray-200 hover:text-white truncate">
                    Chương {Number(ch.chapter_number)}: {ch.title}
                  </Link>
                  <div className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold">
                    <Link href={`/truyen/${story.slug}/lich-su/${ch.id}`} className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 flex items-center gap-1">
                      <History className="w-3.5 h-3.5" /> Lịch sử
                    </Link>
                    {story.story_type !== 'manga' && (
                      <Link
                        href={mine ? `/dang-chuong?draft=${mine.id}` : `/dang-chuong?edit=${ch.id}`}
                        className={`px-2.5 py-1 rounded-lg flex items-center gap-1 ${mine ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25' : 'bg-brand-600/20 text-brand-300 hover:bg-brand-600/30'}`}
                      >
                        <Pencil className="w-3.5 h-3.5" /> {mine ? 'Nháp đang mở' : 'Sửa'}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}
