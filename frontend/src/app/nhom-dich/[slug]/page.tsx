'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { 
  Users, 
  BookOpen, 
  MessageSquare, 
  UserPlus, 
  Send, 
  Plus, 
  Globe, 
  ExternalLink, 
  Clock, 
  CheckCircle2, 
  Eye, 
  Star, 
  Trash2,
  Edit3,
  AlertCircle,
  FileText,
  XCircle,
  Lock,
  LogIn,
  LayoutDashboard,
  PenLine
} from 'lucide-react';
import WorkflowSteps from '@/components/workspace/WorkflowSteps';
import { TASK_GUIDE_HREF } from '@/components/workspace/AssignForm';
import { CircleHelp } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { useAuth } from '@/context/AuthContext';
import RichContent from '@/components/common/RichContent';
import { stripHtml } from '@/lib/richText';
import { chapterUploadHref } from '@/lib/chapterUpload';
import { useRealtime } from '@/lib/realtime';
import CodeBadge from '@/components/common/CodeBadge';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function GroupDetailPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const { user, isAuthenticated, authFetch, openAuthModal } = useAuth();

  const [group, setGroup] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'stories' | 'chat' | 'members' | 'info'>('stories');
  // links from the group workspace: #chat opens the chat, #quy-trinh the workflow settings
  useEffect(() => {
    const tab = { '#chat': 'chat', '#quy-trinh': 'info' }[window.location.hash] as 'chat' | 'info' | undefined;
    if (tab) setActiveTab(tab);
  }, []);
  // The steps a chapter of this group goes through before a story keeper merges it (stage 4b)
  const [workflowDraft, setWorkflowDraft] = useState<string[] | null>(null);
  const [workflowMsg, setWorkflowMsg] = useState<string | null>(null);
  const [mergersDraft, setMergersDraft] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Chatroom State
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSendingMsg, setIsSendingMsg] = useState(false);
  const [chatFeedback, setChatFeedback] = useState<string | null>(null);

  // Add Member State
  const [newMemberInput, setNewMemberInput] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('translator');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [memberFeedback, setMemberFeedback] = useState<string | null>(null);

  // Join Request State
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [isJoinBusy, setIsJoinBusy] = useState(false);
  const [joinFeedback, setJoinFeedback] = useState<string | null>(null);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);

  const currentMembership = group?.members?.find((m: any) => m.user_id === user?.id);
  // Mirrors the server: only the group's leader/mod manage it (site admin/mod get no extra rights here);
  // only the leader manages other managers; only members publish stories and chapters into the group.
  const isLeaderOrMod = ['leader', 'mod'].includes(currentMembership?.role);
  const isLeader = currentMembership?.role === 'leader';
  const isGroupLeader = currentMembership?.role === 'leader';
  const isMember = isAuthenticated && Boolean(currentMembership);
  const canSeeInternal = isMember; // chat
  // Same rules as the server: leaders manage anyone but other leaders, group mods only regular
  // members; your own card lets a leader/mod step down (never promote themselves).
  const leaderCount = group?.members?.filter((m: any) => m.role === 'leader').length || 0;
  const canManageMember = (m: any) =>
    m.user_id !== user?.id && (
      currentMembership?.role === 'leader' ? m.role !== 'leader'
      : isLeaderOrMod && !['leader', 'mod'].includes(m.role)
    );
  const canStepDown = (m: any) =>
    m.user_id === user?.id && (m.role === 'mod' || (m.role === 'leader' && leaderCount > 1));
  const roleRank = (r: string) => (r === 'leader' ? 3 : r === 'mod' ? 2 : 1);
  const ROLE_OPTIONS = [
    { value: 'leader', label: 'Trưởng Nhóm (Leader)', managerOnly: true },
    { value: 'mod', label: 'Quản Lý Nhóm (Mod)', managerOnly: true },
    { value: 'translator', label: 'Dịch Giả (Translator)' },
    { value: 'editor', label: 'Biên Tập (Editor)' },
    { value: 'proofreader', label: 'Hiệu Đính (Proofreader)' },
    { value: 'raw_provider', label: 'Raw Provider' },
    { value: 'member', label: 'Thành Viên (Member)' },
  ];
  const assignableRoles = ROLE_OPTIONS.filter((r) => isGroupLeader || !r.managerOnly);

  const fetchGroup = async () => {
    if (!slug) return;
    if (!group) setIsLoading(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/groups/${slug}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setGroup(json.data);
      } else if (res.status === 404) {
        setGroup(null);
      }
    } catch (e) {
      console.error('Failed to load group:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchGroup();
  }, [slug, user?.id]);

  // Pending join requests (leader/mod only)
  const fetchJoinRequests = async () => {
    if (!group?.id) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/groups/${group.id}/join-requests`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setJoinRequests(json.data || []);
      }
    } catch (e) {}
  };

  useEffect(() => {
    if (isLeaderOrMod && group?.id) fetchJoinRequests();
    else setJoinRequests([]);
  }, [isLeaderOrMod, group?.id]);

  const handleRequestJoin = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!group?.id || isJoinBusy) return;
    const message = prompt('Lời nhắn gửi Trưởng nhóm (không bắt buộc):');
    if (message === null) return; // cancelled
    setIsJoinBusy(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/groups/${group.id}/join-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      });
      const json = await res.json();
      setJoinFeedback(json.message || null);
      if (res.ok) fetchGroup();
    } catch (e) {} finally {
      setIsJoinBusy(false);
    }
  };

  const handleCancelJoin = async () => {
    if (!group?.id || isJoinBusy || !confirm('Hủy yêu cầu gia nhập nhóm?')) return;
    setIsJoinBusy(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/groups/${group.id}/join-requests/me`, { method: 'DELETE' });
      const json = await res.json();
      setJoinFeedback(json.message || null);
      if (res.ok) fetchGroup();
    } catch (e) {} finally {
      setIsJoinBusy(false);
    }
  };

  const handleReviewJoin = async (requestId: string, approve: boolean) => {
    if (!group?.id) return;
    setReviewingRequestId(requestId);
    try {
      const res = await authFetch(`${API_BASE_URL}/groups/${group.id}/join-requests/${requestId}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST',
      });
      const json = await res.json();
      setMemberFeedback(json.message || null);
      fetchJoinRequests();
      if (res.ok && approve) fetchGroup();
    } catch (e) {} finally {
      setReviewingRequestId(null);
    }
  };

  // Fetch Chatroom Messages
  const fetchMessages = async () => {
    if (!group?.id || !canSeeInternal) return;
    try {
      const res = await authFetch(`/api/msg/groups/${group.id}/messages`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setMessages(json.data || []);
      }
    } catch (e) {}
  };

  useEffect(() => {
    if (activeTab === 'chat' && group?.id && canSeeInternal) {
      fetchMessages();
      const interval = setInterval(fetchMessages, 30000); // fallback; new messages are pushed
      return () => clearInterval(interval);
    }
  }, [activeTab, group?.id, canSeeInternal]);

  useRealtime('group_message', (data) => {
    // no groupId: the socket just reconnected, anything may have changed
    if ((!data?.groupId || data.groupId === group?.id) && activeTab === 'chat') fetchMessages();
  });

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!newMessage.trim() || isSendingMsg || !group?.id) return;

    setIsSendingMsg(true);
    try {
      const res = await authFetch(`/api/msg/groups/${group.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage.trim() }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setNewMessage('');
        setChatFeedback(null);
        fetchMessages();
      } else {
        setChatFeedback(json.message || 'Không thể gửi tin nhắn.');
      }
    } catch (e) {} finally {
      setIsSendingMsg(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!group?.id || !confirm('Xóa tin nhắn này?')) return;
    try {
      await authFetch(`/api/msg/groups/${group.id}/messages/${messageId}`, {
        method: 'DELETE',
      });
      fetchMessages();
    } catch (e) {}
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberInput.trim() || isAddingMember || !group?.id) return;

    setIsAddingMember(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/groups/${group.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username_or_email: newMemberInput.trim(),
          role: newMemberRole,
        }),
      });
      const json = await res.json();
      setMemberFeedback(json.message);
      if (res.ok) {
        setNewMemberInput('');
        fetchGroup();
      }
    } catch (e) {} finally {
      setIsAddingMember(false);
    }
  };

  const handleUpdateRole = async (memberUserId: string, newRole: string) => {
    if (!group?.id) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/groups/${group.id}/members/${memberUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMemberFeedback(json.message || 'Không thể đổi vai trò thành viên.');
        return;
      }
      setMemberFeedback(null);
      fetchGroup();
    } catch (e) {}
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa thành viên này khỏi nhóm?')) return;
    if (!group?.id) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/groups/${group.id}/members/${memberUserId}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) {
        setMemberFeedback(json.message || 'Không thể xóa thành viên.');
        return;
      }
      setMemberFeedback(null);
      fetchGroup();
    } catch (e) {}
  };

  const handleLeaveGroup = async () => {
    if (!group?.id || !user?.id || !confirm(`Bạn có chắc muốn rời nhóm ${group.name}?`)) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/groups/${group.id}/members/${user.id}`, { method: 'DELETE' });
      const json = await res.json();
      setJoinFeedback(json.message || null);
      if (res.ok) fetchGroup();
    } catch (e) {}
  };

  if (isLoading) {
    return (
      <div className="max-w-[1600px] mx-auto px-4 py-16 space-y-6 animate-pulse">
        <div className="h-48 rounded-3xl bg-white/5" />
        <div className="h-12 w-1/3 bg-white/5 rounded-2xl" />
        <div className="h-64 rounded-3xl bg-white/5" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-4 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-brand-400" />
        <h2 className="text-xl font-bold text-white">Không tìm thấy nhóm dịch này</h2>
        <Link href="/nhom-dich" className="px-4 py-2 rounded-xl bg-brand-600 text-snow text-xs font-semibold">
          Quay lại danh sách nhóm
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-24">
      
      {/* 1. Header Banner & Profile */}
      <div className="rounded-3xl overflow-hidden glass-panel border border-white/10 bg-glass shadow-2xl relative">
        
        {/* Banner */}
        <div className="h-44 sm:h-56 w-full relative bg-gradient-to-r from-brand-900/60 via-indigo-900/40 to-surface">
          {group.banner_url && (
            <SmartImage src={group.banner_url} alt={group.name} className="w-full h-full object-cover" />
          )}
        </div>

        {/* Profile Info Bar */}
        <div className="p-6 sm:p-8 relative pt-16 sm:pt-6 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6">
          
          {/* Avatar */}
          <div className="absolute -top-14 sm:-top-16 left-6 sm:left-8 w-28 h-28 sm:w-32 sm:h-32 rounded-3xl overflow-hidden border-4 border-surface-2 bg-gray-900 shadow-2xl">
            <SmartImage 
              src={group.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200'} 
              alt={group.name} 
              className="w-full h-full object-cover" 
            />
          </div>

          {/* Details */}
          <div className="sm:ml-36 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">
                {group.name}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-500/20 text-brand-300 border border-brand-500/30">
                Nhóm Dịch Chính Thức
              </span>
              <CodeBadge code={group.code} />
            </div>

            <div className="text-xs sm:text-sm text-gray-300 max-w-2xl leading-relaxed">
              {stripHtml(group.description)
                ? <RichContent content={group.description} />
                : 'Chưa có mô tả nhóm.'}
            </div>

            {joinFeedback && (
              <div className="text-xs font-semibold text-amber-300">{joinFeedback}</div>
            )}

            {/* Social links */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400 pt-1">
              {group.discord_url && (
                <a href={group.discord_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-indigo-400 hover:underline">
                  <Globe className="w-3.5 h-3.5" /> Discord
                </a>
              )}
              {group.website_url && (
                <a href={group.website_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-cyan-400 hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> Website / Fanpage
                </a>
              )}
            </div>
          </div>

          {/* Join + Publish Story CTA */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
            {currentMembership && (
              <button
                onClick={handleLeaveGroup}
                className="px-3 py-2.5 rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 text-gray-400 hover:text-rose-300 text-xs font-bold transition"
              >
                Rời nhóm
              </button>
            )}
            {!currentMembership && group.approval_status === 'approved' && (
              group.my_join_request ? (
                <div className="flex items-center gap-2">
                  <span className="px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold text-xs flex items-center gap-1.5">
                    <Clock className="w-4 h-4" /> Đang chờ Trưởng nhóm duyệt
                  </span>
                  <button
                    onClick={handleCancelJoin}
                    disabled={isJoinBusy}
                    className="px-3 py-2.5 rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 text-gray-300 hover:text-rose-300 text-xs font-bold transition disabled:opacity-40"
                  >
                    Hủy yêu cầu
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleRequestJoin}
                  disabled={isJoinBusy}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-snow font-bold text-xs shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{isJoinBusy ? 'Đang gửi...' : 'Xin Gia Nhập Nhóm'}</span>
                </button>
              )
            )}

            {isMember && (
              <Link
                href={`/ws/nhom/${group.slug}`}
                className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-bold text-xs shadow-lg shadow-brand-500/25 flex items-center gap-2 transition"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Vào workspace nhóm</span>
              </Link>
            )}
          </div>

        </div>

        {/* 2. Workspace Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 sm:px-8 border-t border-white/10 overflow-x-auto bg-black/20 text-xs font-bold">
          
          <button
            onClick={() => setActiveTab('stories')}
            className={`py-3.5 px-3 border-b-2 flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'stories' ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Truyện ({group.story_count ?? group.stories?.length ?? 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('chat')}
            className={`py-3.5 px-3 border-b-2 flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'chat' ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-4 h-4 text-cyan-400" />
            <span>Chat nhóm</span>
          </button>

          <button
            onClick={() => setActiveTab('members')}
            className={`py-3.5 px-3 border-b-2 flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'members' ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4 text-indigo-400" />
            <span>Thành viên ({group.members?.length || 0})</span>
            {isLeaderOrMod && joinRequests.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500 text-ink" title="Yêu cầu gia nhập đang chờ duyệt">
                {joinRequests.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('info')}
            className={`py-3.5 px-3 border-b-2 flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'info' ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <span>Quy trình & nội quy</span>
          </button>

        </div>

      </div>

      {/* 3. Tab Contents */}
      
      {/* TAB 1: STORIES */}
      {activeTab === 'stories' && (
        <div className="space-y-6">
          {isMember && (
            <section className="p-5 sm:p-6 rounded-3xl border border-brand-500/25 bg-brand-500/5 space-y-4" aria-label="Làm việc với nhóm">
              <div>
                <h2 className="text-base font-bold text-white">Làm việc với nhóm</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Mỗi chương đi qua các bước dưới đây. Xong một bước thì bước sau tự mở cho người đúng vai trò; bước cuối người giữ truyện gộp và đăng.
                </p>
                <div className="mt-1"><Link href={`${TASK_GUIDE_HREF}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-300 hover:text-brand-200"><CircleHelp className="w-3.5 h-3.5" /> Hướng dẫn từng bước có ảnh</Link></div>
              </div>
              <WorkflowSteps workflow={group.workflow} />
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { href: `/ws/nhom/${group.slug}`, icon: LayoutDashboard, title: 'Workspace nhóm', text: 'Nhận việc, xem ai đang làm gì, duyệt đề xuất chờ gộp', main: true },
                  { href: `/dang-chuong?group_id=${group.id}`, icon: PenLine, title: 'Đăng chương mới', text: 'Viết hoặc dán chương, lưu nháp rồi gửi cho nhóm' },
                  { href: `/dang-truyen?group_id=${group.id}`, icon: Plus, title: 'Đăng truyện mới', text: 'Thêm một bộ truyện chữ hoặc truyện tranh vào nhóm' },
                ].map((a) => (
                  <Link
                    key={a.title}
                    href={a.href}
                    className={`group flex items-start gap-3 p-4 rounded-2xl border transition ${a.main ? 'border-brand-500/50 bg-brand-600/20 hover:bg-brand-600/30' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  >
                    <a.icon className={`w-5 h-5 shrink-0 mt-0.5 ${a.main ? 'text-brand-300' : 'text-gray-300'}`} />
                    <span>
                      <span className="block text-sm font-bold text-white">{a.title}</span>
                      <span className="block text-[11px] text-gray-400 mt-0.5">{a.text}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <h2 className="text-lg font-bold text-white">Truyện của nhóm</h2>

          {group.stories && group.stories.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.stories.map((story: any) => (
                <div key={story.id} className="flex gap-3.5 p-3.5 rounded-2xl glass-panel border border-white/10 hover:border-brand-500/40 transition bg-glass group">
                  <div className="w-20 h-28 rounded-xl overflow-hidden bg-gray-900 shrink-0 shadow-md">
                    <SmartImage src={story.cover_image_url} alt={story.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                    <div>
                      <Link href={`/truyen/${story.slug}`}>
                        <h3 className="text-xs font-bold text-white group-hover:text-brand-300 transition line-clamp-2 leading-snug">
                          {story.title}
                        </h3>
                      </Link>
                      <div className="text-[11px] text-gray-400 mt-1">
                        Tác giả: {story.author_name || 'Chưa rõ'}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-gray-400 pt-2 border-t border-white/5">
                      <span className="text-brand-300 font-semibold">{story.total_chapters || 0} chương</span>
                      {isMember && (
                        <span className="flex items-center gap-1.5">
                          <Link href={`/ws?truyen=${story.slug}`} className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-gray-100 text-[10px] font-bold">
                            Chương & phiên bản
                          </Link>
                          <Link href={chapterUploadHref({ storyType: story.story_type, storyId: story.id, groupId: group.id, chosen: true })} className="px-2 py-1 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow text-[10px] font-bold">
                            + Chương
                          </Link>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center rounded-3xl glass-panel border border-white/10 space-y-3">
              <BookOpen className="w-12 h-12 text-brand-400 mx-auto opacity-60" />
              <h3 className="text-base font-bold text-white">Nhóm chưa có bộ truyện nào</h3>
              {isMember && (<>
                <p className="text-xs text-gray-400">Hãy bắt đầu đăng bộ Light Novel hoặc Manga đầu tiên của nhóm!</p>
                <Link href={`/dang-truyen?group_id=${group.id}`} className="inline-block px-5 py-2 rounded-xl bg-brand-600 text-snow text-xs font-bold">
                  Đăng truyện ngay
                </Link>
              </>)}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: INTERNAL TEAM CHATROOM */}
      {activeTab === 'chat' && (
        <div className="rounded-3xl glass-panel border border-white/10 bg-glass overflow-hidden flex flex-col h-[600px] shadow-2xl">
          
          {/* Chat Header */}
          <div className="p-4 border-b border-white/10 bg-black/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">Chatroom Nội Bộ Nhóm {group.name}</span>
            </div>
            <span className="text-[11px] text-gray-400">Chỉ thành viên nhóm mới có quyền xem & chat</span>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {!canSeeInternal ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-2 text-xs text-gray-500">
                <Lock className="w-8 h-8 opacity-40" />
                <p>Chatroom nội bộ chỉ hiển thị với thành viên nhóm.</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-2 text-xs text-gray-500">
                <MessageSquare className="w-8 h-8 opacity-40" />
                <p>Chưa có tin nhắn nào. Hãy gửi lời chào đến các thành viên nhóm!</p>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="flex items-start gap-3 group">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-600/30 border border-brand-500/30 shrink-0">
                    <SmartImage src={m.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'} alt={m.display_name} className="w-full h-full object-cover" />
                  </div>
                  <div className="space-y-1 max-w-xl flex-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-bold text-white">{m.display_name || m.username}</span>
                      {m.member_role && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-brand-600/30 text-brand-300 border border-brand-500/30 uppercase">
                          {m.member_role}
                        </span>
                      )}
                      <span className="text-gray-500 text-[10px]">{new Date(m.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                      {(m.user_id === user?.id || isLeaderOrMod) && canSeeInternal && (
                        <button
                          onClick={() => handleDeleteMessage(m.id)}
                          className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300 transition ml-auto"
                          title="Xóa tin nhắn"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-xs text-gray-200 leading-relaxed">
                      {m.message}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Send Box */}
          {chatFeedback && (
            <div className="px-4 py-2 bg-rose-500/10 border-t border-rose-500/30 text-rose-300 text-[11px] font-semibold">
              {chatFeedback}
            </div>
          )}
          {canSeeInternal ? (
            <form onSubmit={handleSendMessage} className="p-3 border-t border-white/10 bg-black/30 flex items-center gap-2">
              <input
                type="text"
                placeholder="Nhập tin nhắn trao đổi công việc dịch..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="flex-1 h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition"
              />
              <button
                type="submit"
                disabled={!newMessage.trim() || isSendingMsg}
                className="px-5 h-10 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-snow font-bold text-xs flex items-center gap-1.5 transition"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Gửi</span>
              </button>
            </form>
          ) : (
            <div className="p-4 border-t border-white/10 bg-black/30 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
              <Lock className="w-3.5 h-3.5" />
              <span>
                {isAuthenticated
                  ? 'Chỉ thành viên nhóm mới có thể tham gia thảo luận tại đây.'
                  : 'Đăng nhập và là thành viên nhóm để tham gia thảo luận.'}
              </span>
              {!isAuthenticated && (
                <button onClick={() => openAuthModal('login')} className="text-brand-400 hover:underline font-bold flex items-center gap-1">
                  <LogIn className="w-3.5 h-3.5" /> Đăng nhập
                </button>
              )}
            </div>
          )}

        </div>
      )}

      {/* TAB 4: MEMBERS & ROLES */}
      {activeTab === 'members' && (
        <div className="space-y-6">
          
          {/* Add Member Card (leader/mod only) */}
          {isLeaderOrMod && (
            <div className="p-5 rounded-3xl glass-panel border border-white/10 bg-glass space-y-3">
              <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5">
                <UserPlus className="w-4 h-4" /> Thêm Thành Viên Mới Vào Nhóm
              </h3>

              {memberFeedback && (
                <div className="p-2.5 rounded-xl bg-brand-500/20 text-brand-300 text-xs font-semibold">
                  {memberFeedback}
                </div>
              )}

              <form onSubmit={handleAddMember} className="flex flex-col sm:flex-row items-center gap-2">
                <input
                  type="text"
                  placeholder="Nhập tên đăng nhập của thành viên..."
                  value={newMemberInput}
                  onChange={(e) => setNewMemberInput(e.target.value)}
                  className="flex-1 h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition w-full"
                  required
                />

                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value)}
                  className="h-10 px-3 rounded-xl bg-surface-3 border border-white/10 text-xs text-white focus:outline-none focus:border-brand-500 w-full sm:w-auto"
                >
                  {assignableRoles.filter((r) => r.value !== 'leader').map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>

                <button
                  type="submit"
                  disabled={!newMemberInput.trim() || isAddingMember}
                  className="px-5 h-10 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-snow font-bold text-xs flex items-center gap-1.5 transition w-full sm:w-auto justify-center"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Thêm</span>
                </button>
              </form>
            </div>
          )}

          {/* Pending Join Requests (leader/mod only) */}
          {isLeaderOrMod && (
            <div className="p-5 rounded-3xl glass-panel border border-white/10 bg-glass space-y-3">
              <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-4 h-4" /> Yêu Cầu Gia Nhập Đang Chờ Duyệt ({joinRequests.length})
              </h3>

              {joinRequests.length === 0 ? (
                <p className="text-xs text-gray-400">Không có yêu cầu nào đang chờ duyệt.</p>
              ) : (
                <div className="space-y-2">
                  {joinRequests.map((r) => (
                    <div key={r.id} className="p-3 rounded-2xl bg-white/5 border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-gray-900 border border-white/15 shrink-0">
                          <SmartImage src={r.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'} alt={r.display_name} className="w-full h-full object-cover" />
                        </div>
                        <div className="min-w-0 text-xs space-y-0.5">
                          <div className="font-bold text-white truncate">
                            {r.display_name || r.username}
                            <span className="ml-2 font-normal text-gray-500 text-[10px]">
                              @{r.username} • {new Date(r.created_at).toLocaleDateString('vi-VN')}
                            </span>
                          </div>
                          {r.message && <div className="text-gray-300 italic break-words">&ldquo;{r.message}&rdquo;</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleReviewJoin(r.id, true)}
                          disabled={reviewingRequestId === r.id}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-snow text-xs font-bold transition flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Duyệt
                        </button>
                        <button
                          onClick={() => handleReviewJoin(r.id, false)}
                          disabled={reviewingRequestId === r.id}
                          className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 text-gray-300 hover:text-rose-300 disabled:opacity-40 text-xs font-bold transition flex items-center gap-1.5"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Từ chối
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Members List */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white">Danh Sách Thành Viên ({group.members?.length || 0})</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.members?.map((m: any) => (
                <div key={m.id} className="p-3.5 rounded-2xl glass-panel border border-white/10 flex items-center justify-between gap-3 bg-glass">
                  <div className="flex items-center gap-3 truncate">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-900 border border-white/15 shrink-0">
                      <SmartImage src={m.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'} alt={m.display_name} className="w-full h-full object-cover" />
                    </div>
                    <div className="truncate text-xs">
                      <Link href={`/nguoi-dung/${m.username}`} className="block font-bold text-white hover:text-brand-400 truncate transition">{m.display_name || m.username}</Link>
                      <div className="text-[10px] text-gray-400 capitalize">{m.role}</div>
                    </div>
                  </div>

                  {canStepDown(m) && (
                    <select
                      value={m.role}
                      onChange={(e) => {
                        const role = e.target.value;
                        if (!confirm(`Thôi chức ${m.role === 'leader' ? 'Trưởng nhóm' : 'Quản lý'} và chuyển sang vai trò mới?`)) return;
                        handleUpdateRole(m.user_id, role);
                      }}
                      title="Thôi chức"
                      className="h-7 px-2 rounded-lg bg-surface-3 border border-amber-500/30 text-[10px] text-amber-200 focus:outline-none shrink-0"
                    >
                      {ROLE_OPTIONS.filter((r) => roleRank(r.value) <= roleRank(m.role)).map((r) => (
                        <option key={r.value} value={r.value}>{r.value === m.role ? `${r.label} (thôi chức...)` : r.label}</option>
                      ))}
                    </select>
                  )}

                  {canManageMember(m) && (
                    <div className="flex items-center gap-1 shrink-0">
                      <select
                        value={m.role}
                        onChange={(e) => {
                          const role = e.target.value;
                          if (role === 'leader' && !confirm(`Bổ nhiệm ${m.display_name || m.username} làm Trưởng nhóm?`)) return;
                          handleUpdateRole(m.user_id, role);
                        }}
                        className="h-7 px-2 rounded-lg bg-surface-3 border border-white/10 text-[10px] text-gray-300 focus:outline-none"
                      >
                        {assignableRoles.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>

                      <button
                        onClick={() => handleRemoveMember(m.user_id)}
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition"
                        title="Xóa khỏi nhóm"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* TAB 5: RULES & INFO */}
      {activeTab === 'info' && (
        <div id="quy-trinh" className="p-6 rounded-3xl glass-panel border border-white/10 bg-glass space-y-3 max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-white">Quy trình làm chương</h2>
            <Link href={`${TASK_GUIDE_HREF}#quy-trinh`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-300 hover:text-brand-200"><CircleHelp className="w-3.5 h-3.5" /> Hướng dẫn có ảnh</Link>
          </div>
          <p className="text-xs text-gray-400">
            Mỗi chương đi qua các bước theo thứ tự, mỗi bước là một việc cho đúng vai trò (Trưởng nhóm/Mod nhóm và thành viên thường nhận được mọi bước),
            xong bước thì bước sau tự mở; cuối cùng là đề xuất để người giữ truyện gộp.
          </p>
          {(() => {
            const steps = workflowDraft || group.workflow || ['translate'];
            const all = [['raw', 'RAW', 'người cung cấp bản gốc'], ['translate', 'DỊCH', 'dịch giả'], ['edit', 'BIÊN TẬP', 'biên tập'], ['proofread', 'HIỆU ĐÍNH', 'hiệu đính']];
            return (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {all.map(([key, label, role]) => (
                    <label key={key} className={`px-3 py-2 rounded-xl border flex items-center gap-2 ${steps.includes(key) ? 'border-brand-500/60 bg-brand-500/10 text-white' : 'border-white/10 text-gray-400'} ${isLeaderOrMod ? 'cursor-pointer' : ''}`}>
                      {isLeaderOrMod && (
                        <input
                          type="checkbox"
                          checked={steps.includes(key)}
                          onChange={(e) => setWorkflowDraft(e.target.checked ? [...steps, key] : steps.filter((x: string) => x !== key))}
                        />
                      )}
                      <b>{label}</b> <span className="text-[10px] text-gray-400">({role})</span>
                    </label>
                  ))}
                  <span className="px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-200"><b>GỘP</b> <span className="text-[10px]">(người giữ truyện)</span></span>
                </div>
                <p className="text-xs text-gray-400 pt-1">
                  Người giữ truyện (được gộp, sửa thẳng, quay lại bản cũ): chủ truyện, Trưởng nhóm và các vai trò dưới đây{isLeader ? '' : ' (Trưởng nhóm chọn)'}.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {[['mod', 'Mod nhóm'], ['editor', 'Biên tập'], ['proofreader', 'Hiệu đính'], ['translator', 'Dịch giả'], ['raw_provider', 'Cung cấp RAW'], ['member', 'Thành viên']].map(([key, label]) => {
                    const mergers = mergersDraft || group.mergers || ['mod'];
                    return (
                      <label key={key} className={`px-3 py-2 rounded-xl border flex items-center gap-2 ${mergers.includes(key) ? 'border-emerald-500/60 bg-emerald-500/10 text-white' : 'border-white/10 text-gray-400'} ${isLeader ? 'cursor-pointer' : ''}`}>
                        {isLeader && (
                          <input
                            type="checkbox"
                            checked={mergers.includes(key)}
                            onChange={(e) => setMergersDraft(e.target.checked ? [...mergers, key] : mergers.filter((x: string) => x !== key))}
                          />
                        )}
                        {label}
                      </label>
                    );
                  })}
                </div>
                {isLeaderOrMod && (workflowDraft || mergersDraft) && (
                  <button
                    type="button"
                    onClick={async () => {
                      const body: any = { steps: workflowDraft || group.workflow || ['translate'] };
                      if (mergersDraft) body.mergers = mergersDraft;
                      const res = await authFetch(`${API_BASE_URL}/groups/${group.id}/workflow`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                      });
                      const json = await res.json().catch(() => ({}));
                      setWorkflowMsg(json.message || (res.ok ? 'Đã lưu.' : 'Không lưu được.'));
                      if (res.ok && json.success) {
                        setGroup({ ...group, workflow: json.data.workflow, mergers: json.data.mergers });
                        setWorkflowDraft(null);
                        setMergersDraft(null);
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold"
                  >
                    Lưu quy trình
                  </button>
                )}
                {workflowMsg && <p className="text-xs text-gray-300">{workflowMsg}</p>}
              </div>
            );
          })()}
        </div>
      )}
      {activeTab === 'info' && (
        <div className="p-6 rounded-3xl glass-panel border border-white/10 bg-glass space-y-4 max-w-3xl">
          <h2 className="text-base font-bold text-white">Nội Quy & Tiêu Chuẩn Dịch Thuật Của Nhóm</h2>
          <div className="text-xs text-gray-300 leading-relaxed">
            {stripHtml(group.rules)
              ? <RichContent content={group.rules} />
              : 'Nhóm chưa thiết lập nội quy riêng. Vui lòng tuân thủ quy chuẩn chung của NovelHub.'}
          </div>
        </div>
      )}

    </div>
  );
}
