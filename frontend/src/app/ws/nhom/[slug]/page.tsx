'use client';

import React, { useEffect, useMemo, useState } from 'react';
import BackLink from '@/components/common/BackLink';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Activity, ArrowLeft, BookOpen, GitMerge, MessageCircle, Settings, Users } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';
import TaskCard, { STEP_LABEL, dueState } from '@/components/workspace/TaskCard';
import { draftLabel } from '@/components/workspace/DraftRow';
import WorkflowSteps from '@/components/workspace/WorkflowSteps';
import { TASK_GUIDE_HREF } from '@/components/workspace/AssignForm';
import { CircleHelp } from 'lucide-react';

/**
 * A translation group's workspace (Plan/chapter-workspace.md, stage 4b). The group keeps no content of its own: this is
 * the work of its stories put together. Overview, a task board by column, proposals waiting, what happened lately.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const WS_URL = '/api/ws';

const ACTION: Record<string, string> = {
  task_created: 'mở việc', task_claimed: 'nhận việc', task_unclaimed: 'trả việc', task_assigned: 'giao việc', task_done: 'xong bước',
  task_cancelled: 'hủy việc', proposal_submitted: 'gửi đề xuất', proposal_returned: 'trả lại đề xuất', proposal_withdrawn: 'rút đề xuất',
  proposal_merged: 'gộp đề xuất', published: 'đăng',
};

export default function GroupWorkspacePage() {
  const slug = useParams()?.slug as string;
  const { user, isAuthenticated, isLoading, openAuthModal, authFetch } = useAuth();
  const [group, setGroup] = useState<any>(null);
  const [board, setBoard] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [storyFilter, setStoryFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [stepFilter, setStepFilter] = useState(''); // a workflow step picked on the steps strip
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch(`${API_BASE_URL}/groups/${slug}`).then((r) => r.json())
      .then((g) => {
        if (!g.success) throw new Error(g.message || 'Không tìm thấy nhóm.');
        setGroup(g.data);
        const ids = (g.data.stories || []).map((s: any) => `story_id=${s.id}`).join('&');
        return authFetch(`${WS_URL}/board?${ids}`).then((r) => r.json());
      })
      .then((b) => (b.success ? setBoard(b.data) : setError(b.message)))
      .catch((e) => setError(e.message));
  }, [isAuthenticated, authFetch, slug, reload]);

  const storyTitle = useMemo(() => Object.fromEntries((group?.stories || []).map((s: any) => [s.id, s.title])), [group]);
  const members = useMemo(() => (group?.members || []).map((m: any) => ({ id: m.user_id, name: `${m.display_name || m.username} (${m.role})` })), [group]);

  if (isLoading || (isAuthenticated && !board && !error)) return <PageLoader label="Đang mở workspace nhóm..." />;
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <button onClick={() => openAuthModal('login')} className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm">Đăng nhập để mở workspace nhóm</button>
      </div>
    );
  }
  if (error || !group) return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-rose-300">{error}</div>;
  const myRole = group.members?.find((m: any) => m.user_id === user?.id)?.role;
  if (!myRole) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-gray-400">Workspace nhóm chỉ dành cho thành viên của {group.name}.</div>;
  }
  const manager = myRole === 'leader' || myRole === 'mod';

  const show = (t: any) => (!storyFilter || t.story_id === storyFilter) && (!personFilter || t.assignee_id === personFilter) && (!stepFilter || t.kind === stepFilter);
  const tasks: any[] = board.tasks.filter(show);
  const keeperOf = new Set(board.keeper_of);
  const proposals: any[] = board.proposals.filter((p: any) => (!storyFilter || p.story_id === storyFilter) && (!personFilter || p.owner_id === personFilter));
  const merged = board.activity.filter((a: any) => (a.action === 'proposal_merged' || a.action === 'published') && (!storyFilter || a.story_id === storyFilter));
  const columns = [
    { key: 'open', title: 'Chưa nhận', items: tasks.filter((t) => t.status === 'open' && t.kind !== 'merge') },
    { key: 'claimed', title: 'Đang làm', items: tasks.filter((t) => t.status === 'claimed') },
  ];
  const late = board.tasks.filter((t: any) => dueState(t) !== null);
  const stepCounts: Record<string, number> = {};
  for (const t of board.tasks) if (t.status === 'open' || t.status === 'claimed') stepCounts[t.kind] = (stepCounts[t.kind] || 0) + 1;
  stepCounts.merge = board.proposals.length;

  const select = 'h-9 px-3 rounded-xl bg-surface-3 border border-white/10 text-xs text-white';
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-5 pb-24">
      <BackLink href="/ws" className="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition">
        <ArrowLeft className="w-4 h-4" /> Workspace của tôi
      </BackLink>

      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/30 shadow-xl">
        {/* the group's banner, or its covers side by side, behind its name */}
        <div aria-hidden className="absolute inset-0 flex opacity-30 blur-sm">
          {group.banner_url
            ? <SmartImage src={group.banner_url} alt="" className="h-full w-full object-cover" />
            : (group.stories || []).slice(0, 6).map((s: any) => s.cover_image_url && <SmartImage key={s.id} src={s.cover_image_url} alt="" className="h-full min-w-0 flex-1 object-cover" />)}
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/90 via-emerald-950/70 to-transparent" aria-hidden />
        <div className="relative p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border-2 border-emerald-400/60 bg-emerald-700 grid place-items-center text-2xl font-extrabold text-snow">
            {group.avatar_url ? <SmartImage src={group.avatar_url} alt={group.name} className="h-full w-full object-cover" /> : group.name.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/25 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-200">
              <Users className="w-3 h-3" /> Workspace nhóm
            </span>
            <h1 className="mt-1 text-xl sm:text-2xl font-extrabold text-snow truncate">{group.name}</h1>
            <p className="text-xs text-emerald-100/80 mt-0.5">
              Việc chung của cả nhóm · {group.story_count ?? group.stories?.length ?? 0} truyện · {group.members?.length || 0} thành viên
            </p>
            <div className="mt-2 flex -space-x-2">
              {(group.members || []).slice(0, 8).map((m: any) => (
                <span key={m.user_id} title={m.display_name || m.username} className="h-7 w-7 overflow-hidden rounded-full border-2 border-emerald-950 bg-emerald-800 grid place-items-center text-[10px] font-bold text-snow">
                  {m.avatar_url ? <SmartImage src={m.avatar_url} alt={m.display_name || m.username} className="h-full w-full object-cover" /> : (m.display_name || m.username).slice(0, 1)}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10"><div className="text-lg font-extrabold text-sky-300">{board.tasks.filter((t: any) => t.status === 'claimed').length}</div><div className="text-[10px] text-gray-400 uppercase font-bold">Đang làm</div></div>
          <div className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10"><div className="text-lg font-extrabold text-emerald-300">{board.proposals.length}</div><div className="text-[10px] text-gray-400 uppercase font-bold">Chờ gộp</div></div>
          <div className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10"><div className={`text-lg font-extrabold ${late.length ? 'text-rose-300' : 'text-gray-300'}`}>{late.length}</div><div className="text-[10px] text-gray-400 uppercase font-bold">Sắp / đã trễ hạn</div></div>
        </div>
        </div>
      </div>

      <section className="space-y-2" aria-label="Truyện của nhóm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5"><BookOpen className="w-4 h-4" /> Truyện của nhóm</h2>
          <span className="text-[11px] text-gray-400">“Giao việc & duyệt”: giao chương cho thành viên, duyệt bản dịch họ gửi. <Link href={`${TASK_GUIDE_HREF}#giao-viec`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-300 hover:text-brand-200"><CircleHelp className="w-3.5 h-3.5" /> Xem hướng dẫn</Link></span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(group.stories || []).map((s: any) => {
            const open = board.tasks.filter((t: any) => t.story_id === s.id && (t.status === 'open' || t.status === 'claimed')).length;
            const waiting = board.proposals.filter((p: any) => p.story_id === s.id).length;
            return (
              <div key={s.id} className="flex gap-3 p-3 rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-white/5">
                  {s.cover_image_url && <SmartImage src={s.cover_image_url} alt={s.title} className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="text-sm font-bold text-white line-clamp-2">{s.title}</div>
                    <div className="text-[11px] text-gray-400">{s.total_chapters || 0} chương · {open} việc đang mở · <span className={waiting ? 'text-emerald-300 font-bold' : ''}>{waiting} chờ duyệt</span></div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
                    <Link href={`/ws/truyen/${s.slug}`} className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-snow flex items-center gap-1"><GitMerge className="w-3 h-3" /> Giao việc & duyệt</Link>
                    <Link href={`/ws?truyen=${s.slug}`} className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-gray-100">Chương & phiên bản</Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="p-4 rounded-3xl border border-white/10 bg-white/[0.03] space-y-2">
        <p className="text-xs text-gray-400">
          Chương đi từ trái sang phải. Bấm một bước để chỉ xem việc của bước đó. Việc <b className="text-gray-200">Chưa nhận</b>: bấm “Nhận việc” để làm;
          xong thì bấm “Xong bước”, bước sau tự mở. Bước <b className="text-emerald-300">GỘP</b> là các đề xuất ở cột “Chờ duyệt”.
        </p>
        <Link href={`${TASK_GUIDE_HREF}#nhan-viec`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-300 hover:text-brand-200"><CircleHelp className="w-3.5 h-3.5" /> Hướng dẫn có ảnh: nhận việc, gửi bản dịch, duyệt</Link>
        <WorkflowSteps workflow={group.workflow} counts={stepCounts} active={stepFilter} onPick={setStepFilter} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <select value={storyFilter} onChange={(e) => setStoryFilter(e.target.value)} className={select} aria-label="Lọc theo truyện">
          <option value="">Tất cả truyện</option>
          {(group.stories || []).map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} className={select} aria-label="Lọc theo người">
          <option value="">Tất cả thành viên</option>
          {members.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div className="ml-auto flex flex-wrap gap-2 text-xs font-bold">
          <Link href={`/nhom-dich/${group.slug}`} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Thành viên</Link>
          <Link href={`/nhom-dich/${group.slug}#chat`} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> Chat nhóm</Link>
          {manager && <Link href={`/nhom-dich/${group.slug}#quy-trinh`} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 flex items-center gap-1.5"><Settings className="w-3.5 h-3.5" /> Quy trình</Link>}
        </div>
      </div>

      {board.tasks.length === 0 && board.proposals.length === 0 && (
        <p className="p-4 rounded-2xl border border-dashed border-white/15 text-xs text-gray-300">
          Chưa có việc nào. Người giữ truyện mở việc cho từng chương ở trang <b className="text-white">Giao việc & duyệt bản dịch</b> của truyện:{' '}
          {(group.stories || []).map((s: any, i: number) => (
            <React.Fragment key={s.id}>{i > 0 && ', '}<Link href={`/ws/truyen/${s.slug}`} className="text-brand-300 underline hover:text-brand-200">{s.title}</Link></React.Fragment>
          ))}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map((c) => (
          <section key={c.key} className="p-3 rounded-3xl bg-white/[0.03] border border-white/10 space-y-2 min-w-0">
            <h2 className="px-1 text-xs font-bold text-gray-300 uppercase tracking-wider">{c.title} ({c.items.length})</h2>
            {c.items.map((t: any) => (
              <TaskCard key={t.id} t={t} me={user?.id} keeper={keeperOf.has(t.story_id)} members={members} storyTitle={storyTitle[t.story_id]} authFetch={authFetch} onChanged={() => setReload((n) => n + 1)} />
            ))}
          </section>
        ))}
        <section className="p-3 rounded-3xl bg-white/[0.03] border border-white/10 space-y-2 min-w-0">
          <h2 className="px-1 text-xs font-bold text-gray-300 uppercase tracking-wider">Chờ duyệt ({proposals.length})</h2>
          {proposals.map((p) => (
            <Link key={p.id} href={`/ws/de-xuat/${p.id}`} className="block p-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 hover:bg-emerald-500/10 text-xs">
              <div className="font-bold text-white truncate">{draftLabel(p)}</div>
              <div className="text-[11px] text-brand-300 truncate">{storyTitle[p.story_id]}</div>
              <div className="text-[11px] text-gray-400">{p.owner_name || 'Người viết'} · lần {p.last_round}</div>
            </Link>
          ))}
        </section>
        <section className="p-3 rounded-3xl bg-white/[0.03] border border-white/10 space-y-2 min-w-0">
          <h2 className="px-1 text-xs font-bold text-gray-300 uppercase tracking-wider">Đã đăng gần đây ({merged.length})</h2>
          {merged.slice(0, 20).map((a: any) => (
            <div key={a.id} className="p-3 rounded-2xl bg-white/5 border border-white/10 text-xs">
              <div className="font-bold text-white truncate">Chương {Number(a.detail.chapter_number)}{a.detail.title ? `: ${a.detail.title}` : ''}</div>
              <div className="text-[11px] text-brand-300 truncate">{storyTitle[a.story_id]}</div>
              <div className="text-[11px] text-gray-400">{a.actor_name} · {new Date(a.created_at).toLocaleDateString('vi-VN')}</div>
            </div>
          ))}
        </section>
      </div>

      <section className="p-5 rounded-3xl glass-panel border border-white/10 bg-glass space-y-2">
        <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5"><Activity className="w-4 h-4" /> Hoạt động gần đây</h2>
        {board.activity.length === 0 && <p className="text-xs text-gray-500">Chưa có hoạt động nào.</p>}
        <ol className="space-y-1">
          {board.activity.filter((a: any) => !storyFilter || a.story_id === storyFilter).map((a: any) => (
            <li key={a.id} className="text-xs text-gray-300">
              <span className="text-gray-500">{new Date(a.created_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span>
              {' · '}<b className="text-white">{a.actor_name || 'Ai đó'}</b> {ACTION[a.action] || a.action}
              {a.detail.kind ? ` ${STEP_LABEL[a.detail.kind] || a.detail.kind}` : ''} chương {Number(a.detail.chapter_number)}
              {a.detail.assignee_name && a.action === 'task_assigned' ? ` cho ${a.detail.assignee_name}` : ''}
              <span className="text-brand-300"> · {storyTitle[a.story_id]}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
