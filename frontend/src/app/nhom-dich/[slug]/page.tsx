'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { 
  Users, 
  BookOpen, 
  MessageSquare, 
  ShieldCheck, 
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
  LogIn
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { useAuth } from '@/context/AuthContext';
import RichContent from '@/components/common/RichContent';
import { stripHtml } from '@/lib/richText';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function GroupDetailPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const { user, isAuthenticated, hasRole, authFetch, openAuthModal } = useAuth();

  const [group, setGroup] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'stories' | 'chat' | 'submissions' | 'members' | 'info'>('stories');
  const [isLoading, setIsLoading] = useState(true);

  // Chatroom State
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSendingMsg, setIsSendingMsg] = useState(false);
  const [chatFeedback, setChatFeedback] = useState<string | null>(null);

  // Submissions State
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [isApproving, setIsApproving] = useState<string | null>(null);

  // Add Member State
  const [newMemberInput, setNewMemberInput] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('translator');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [memberFeedback, setMemberFeedback] = useState<string | null>(null);
  const [submissionFeedback, setSubmissionFeedback] = useState<string | null>(null);

  const currentMembership = group?.members?.find((m: any) => m.user_id === user?.id);
  const isLeaderOrMod = hasRole('admin', 'mod') || ['leader', 'mod'].includes(currentMembership?.role);
  const isMember = isAuthenticated && (isLeaderOrMod || Boolean(currentMembership));

  const fetchGroup = async () => {
    if (!slug) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/groups/${slug}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setGroup(json.data);
      }
    } catch (e) {
      console.error('Failed to load group:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchGroup();
  }, [slug]);

  // Fetch Chatroom Messages
  const fetchMessages = async () => {
    if (!group?.id) return;
    try {
      const res = await fetch(`${API_BASE_URL}/groups/${group.id}/messages`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setMessages(json.data || []);
      }
    } catch (e) {}
  };

  // Fetch Chapter Submissions
  const fetchSubmissions = async () => {
    if (!group?.id) return;
    try {
      const res = await fetch(`${API_BASE_URL}/chapters/submissions?group_id=${group.id}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setSubmissions(json.data || []);
      }
    } catch (e) {}
  };

  useEffect(() => {
    if (activeTab === 'chat' && group?.id) {
      fetchMessages();
      const interval = setInterval(fetchMessages, 4000);
      return () => clearInterval(interval);
    }
    if (activeTab === 'submissions' && group?.id) {
      fetchSubmissions();
    }
  }, [activeTab, group?.id]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!newMessage.trim() || isSendingMsg || !group?.id) return;

    setIsSendingMsg(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/groups/${group.id}/messages`, {
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
      await authFetch(`${API_BASE_URL}/groups/${group.id}/messages/${messageId}`, {
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

  const handleApproveSubmission = async (submissionId: string) => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    setIsApproving(submissionId);
    try {
      const res = await authFetch(`${API_BASE_URL}/chapters/submissions/${submissionId}/approve-active`, {
        method: 'POST',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSubmissionFeedback(null);
        fetchSubmissions();
      } else {
        setSubmissionFeedback(json.message || 'Không thể duyệt bản dịch này.');
      }
    } catch (e) {} finally {
      setIsApproving(null);
    }
  };

  const handleRejectSubmission = async (submissionId: string) => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    const reason = prompt('Lý do từ chối bản dịch này (không bắt buộc):') || '';
    setIsApproving(submissionId);
    try {
      const res = await authFetch(`${API_BASE_URL}/chapters/submissions/${submissionId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSubmissionFeedback(null);
        fetchSubmissions();
      } else {
        setSubmissionFeedback(json.message || 'Không thể từ chối bản dịch này.');
      }
    } catch (e) {} finally {
      setIsApproving(null);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 space-y-6 animate-pulse">
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
        <Link href="/nhom-dich" className="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold">
          Quay lại danh sách nhóm
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-24">
      
      {/* 1. Header Banner & Profile */}
      <div className="rounded-3xl overflow-hidden glass-panel border border-white/10 bg-[#12121e]/90 shadow-2xl relative">
        
        {/* Banner */}
        <div className="h-44 sm:h-56 w-full relative bg-gradient-to-r from-brand-900/60 via-indigo-900/40 to-[#0A0A10]">
          {group.banner_url && (
            <SmartImage src={group.banner_url} alt={group.name} className="w-full h-full object-cover" />
          )}
        </div>

        {/* Profile Info Bar */}
        <div className="p-6 sm:p-8 relative pt-16 sm:pt-6 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6">
          
          {/* Avatar */}
          <div className="absolute -top-14 sm:-top-16 left-6 sm:left-8 w-28 h-28 sm:w-32 sm:h-32 rounded-3xl overflow-hidden border-4 border-[#12121e] bg-gray-900 shadow-2xl">
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
            </div>

            <div className="text-xs sm:text-sm text-gray-300 max-w-2xl leading-relaxed">
              {stripHtml(group.description)
                ? <RichContent content={group.description} />
                : 'Chưa có mô tả nhóm.'}
            </div>

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

          {/* Publish Story CTA */}
          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
            <Link
              href={`/dang-truyen?group_id=${group.id}`}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-brand-500/25 flex items-center gap-2 transition hover:scale-105"
            >
              <Plus className="w-4 h-4" />
              <span>Đăng Bộ Truyện Mới</span>
            </Link>

            <Link
              href={`/dang-chuong?group_id=${group.id}`}
              className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs border border-white/15 flex items-center gap-2 transition"
            >
              <FileText className="w-4 h-4 text-brand-400" />
              <span>Đăng Chương Mới</span>
            </Link>
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
            <span>Tác Phẩm ({group.stories?.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('chat')}
            className={`py-3.5 px-3 border-b-2 flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'chat' ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-4 h-4 text-cyan-400" />
            <span>Chatroom Nội Bộ</span>
          </button>

          <button
            onClick={() => setActiveTab('submissions')}
            className={`py-3.5 px-3 border-b-2 flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'submissions' ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Duyệt Bản Dịch Chương</span>
          </button>

          <button
            onClick={() => setActiveTab('members')}
            className={`py-3.5 px-3 border-b-2 flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'members' ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4 text-indigo-400" />
            <span>Thành Viên ({group.members?.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('info')}
            className={`py-3.5 px-3 border-b-2 flex items-center gap-1.5 transition whitespace-nowrap ${
              activeTab === 'info' ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <span>Nội Quy & Thông Tin</span>
          </button>

        </div>

      </div>

      {/* 3. Tab Contents */}
      
      {/* TAB 1: STORIES */}
      {activeTab === 'stories' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Danh Sách Truyện Của Nhóm</h2>
            <Link
              href={`/dang-truyen?group_id=${group.id}`}
              className="text-xs text-brand-400 hover:underline font-semibold flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Thêm truyện mới vào nhóm
            </Link>
          </div>

          {group.stories && group.stories.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.stories.map((story: any) => (
                <div key={story.id} className="flex gap-3.5 p-3.5 rounded-2xl glass-panel border border-white/10 hover:border-brand-500/40 transition bg-[#12121e]/80 group">
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
                      <Link href={`/dang-chuong?story_id=${story.id}`} className="text-cyan-400 hover:underline text-[10px] font-bold">
                        + Đăng chương
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center rounded-3xl glass-panel border border-white/10 space-y-3">
              <BookOpen className="w-12 h-12 text-brand-400 mx-auto opacity-60" />
              <h3 className="text-base font-bold text-white">Nhóm chưa có bộ truyện nào</h3>
              <p className="text-xs text-gray-400">Hãy bắt đầu đăng bộ Light Novel hoặc Manga đầu tiên của nhóm!</p>
              <Link href={`/dang-truyen?group_id=${group.id}`} className="inline-block px-5 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold">
                Đăng truyện ngay
              </Link>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: INTERNAL TEAM CHATROOM */}
      {activeTab === 'chat' && (
        <div className="rounded-3xl glass-panel border border-white/10 bg-[#12121e]/90 overflow-hidden flex flex-col h-[600px] shadow-2xl">
          
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
            {messages.length === 0 ? (
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
                      {(m.user_id === user?.id || isLeaderOrMod) && (
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
          {isMember ? (
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
                className="px-5 h-10 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-1.5 transition"
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

      {/* TAB 3: CHAPTER SUBMISSIONS APPROVAL WORKFLOW */}
      {activeTab === 'submissions' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Quản Lý & Duyệt Bản Dịch Chương Của Thành Viên</h2>
              <p className="text-xs text-gray-400">Khi một chương có nhiều thành viên nộp bản dịch, Trưởng nhóm/Mod sẽ duyệt chọn bản dịch chính thức để hiển thị cho độc giả</p>
            </div>
            <Link
              href={`/dang-chuong?group_id=${group.id}`}
              className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Nộp bản dịch mới
            </Link>
          </div>

          {submissionFeedback && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold">
              {submissionFeedback}
            </div>
          )}

          {submissions.length === 0 ? (
            <div className="p-12 text-center rounded-3xl glass-panel border border-white/10 space-y-3">
              <ShieldCheck className="w-12 h-12 text-brand-400 mx-auto opacity-60" />
              <h3 className="text-base font-bold text-white">Không có bản dịch nào đang chờ duyệt</h3>
              <p className="text-xs text-gray-400">Tất cả các chương đã được xuất bản chính thức hoặc chưa có thành viên nộp bản thảo mới.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {submissions.map((sub) => (
                <div key={sub.id} className="p-4 rounded-2xl glass-panel border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#131322]/85">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-brand-400">[{sub.story_title}]</span>
                      <span className="text-xs font-bold text-white">Chương {sub.chapter_number}: {sub.title}</span>
                      {sub.is_active && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Đang hiển thị chính thức
                        </span>
                      )}
                      {sub.approval_status === 'rejected' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> Đã từ chối
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-400 flex items-center gap-3">
                      <span>Người dịch: <strong className="text-gray-200">{sub.uploader_name || sub.uploader_username}</strong></span>
                      <span>•</span>
                      <span>{sub.word_count?.toLocaleString()} chữ</span>
                      <span>•</span>
                      <span>{new Date(sub.created_at).toLocaleDateString('vi-VN')}</span>
                    </div>
                    {sub.approval_status === 'rejected' && sub.rejection_reason && (
                      <div className="text-[11px] text-rose-300 italic">Lý do từ chối: {sub.rejection_reason}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {sub.is_active ? (
                      <span className="text-xs text-emerald-400 font-bold px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                        Bản Chính Thức
                      </span>
                    ) : !isLeaderOrMod ? (
                      <span className="text-xs text-gray-400 font-semibold px-3 py-1.5">
                        {sub.approval_status === 'rejected' ? 'Đã từ chối' : 'Đang chờ Trưởng nhóm duyệt'}
                      </span>
                    ) : sub.approval_status === 'rejected' ? (
                      <button
                        onClick={() => handleApproveSubmission(sub.id)}
                        disabled={isApproving === sub.id}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{isApproving === sub.id ? 'Đang duyệt...' : 'Duyệt Lại Bản Này'}</span>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => handleApproveSubmission(sub.id)}
                          disabled={isApproving === sub.id}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isApproving === sub.id ? 'Đang duyệt...' : 'Duyệt Bản Này'}</span>
                        </button>
                        <button
                          onClick={() => handleRejectSubmission(sub.id)}
                          disabled={isApproving === sub.id}
                          className="px-4 py-2 rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 text-gray-300 hover:text-rose-300 text-xs font-bold transition flex items-center gap-1.5"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Từ Chối</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: MEMBERS & ROLES */}
      {activeTab === 'members' && (
        <div className="space-y-6">
          
          {/* Add Member Card (leader/mod only) */}
          {isLeaderOrMod && (
            <div className="p-5 rounded-3xl glass-panel border border-white/10 bg-[#131322]/90 space-y-3">
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
                  placeholder="Nhập Username hoặc Email của thành viên..."
                  value={newMemberInput}
                  onChange={(e) => setNewMemberInput(e.target.value)}
                  className="flex-1 h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition w-full"
                  required
                />

                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value)}
                  className="h-10 px-3 rounded-xl bg-[#0f0f18] border border-white/10 text-xs text-white focus:outline-none focus:border-brand-500 w-full sm:w-auto"
                >
                  <option value="translator">Dịch Giả (Translator)</option>
                  <option value="editor">Biên Tập (Editor)</option>
                  <option value="proofreader">Hiệu Đính (Proofreader)</option>
                  <option value="raw_provider">Raw Provider</option>
                  <option value="mod">Quản Lý Nhóm (Mod)</option>
                  <option value="member">Thành Viên</option>
                </select>

                <button
                  type="submit"
                  disabled={!newMemberInput.trim() || isAddingMember}
                  className="px-5 h-10 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-1.5 transition w-full sm:w-auto justify-center"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Thêm</span>
                </button>
              </form>
            </div>
          )}

          {/* Members List */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white">Danh Sách Thành Viên ({group.members?.length || 0})</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.members?.map((m: any) => (
                <div key={m.id} className="p-3.5 rounded-2xl glass-panel border border-white/10 flex items-center justify-between gap-3 bg-[#12121e]/80">
                  <div className="flex items-center gap-3 truncate">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-900 border border-white/15 shrink-0">
                      <SmartImage src={m.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'} alt={m.display_name} className="w-full h-full object-cover" />
                    </div>
                    <div className="truncate text-xs">
                      <div className="font-bold text-white truncate">{m.display_name || m.username}</div>
                      <div className="text-[10px] text-gray-400 capitalize">{m.role}</div>
                    </div>
                  </div>

                  {isLeaderOrMod && m.role !== 'leader' && (
                    <div className="flex items-center gap-1 shrink-0">
                      <select
                        value={m.role}
                        onChange={(e) => handleUpdateRole(m.user_id, e.target.value)}
                        className="h-7 px-2 rounded-lg bg-white/5 border border-white/10 text-[10px] text-gray-300 focus:outline-none"
                      >
                        <option value="translator">Translator</option>
                        <option value="editor">Editor</option>
                        <option value="mod">Mod</option>
                        <option value="member">Member</option>
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
        <div className="p-6 rounded-3xl glass-panel border border-white/10 bg-[#12121e]/90 space-y-4 max-w-3xl">
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
