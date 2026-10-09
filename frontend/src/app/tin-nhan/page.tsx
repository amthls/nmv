'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, LogIn, MessageCircle, Send } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import PageLoader from '@/components/common/PageLoader';
import { useAuth } from '@/context/AuthContext';
import { useRealtime } from '@/lib/realtime';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100';

function Avatar({ src, alt, size = 'w-10 h-10' }: { src?: string | null; alt: string; size?: string }) {
  return (
    <div className={`${size} rounded-full overflow-hidden bg-brand-600/30 border border-brand-500/30 shrink-0`}>
      <SmartImage src={src || DEFAULT_AVATAR} alt={alt} className="w-full h-full object-cover" />
    </div>
  );
}

function MessagesInner() {
  const { user, isAuthenticated, isLoading: isAuthLoading, openAuthModal, authFetch } = useAuth();
  const partnerUsername = useSearchParams().get('u');

  const [conversations, setConversations] = useState<any[]>([]);
  const [partner, setPartner] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchConversations = async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/messages`);
      const json = await res.json();
      if (res.ok && json.success) setConversations(json.data.conversations || []);
    } catch (e) {}
  };

  const fetchThread = async () => {
    if (!partnerUsername) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/messages/${encodeURIComponent(partnerUsername)}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setPartner(json.data.partner);
        setMessages(json.data.messages || []);
        setThreadError(null);
      } else {
        setThreadError(json.message || 'Không tải được cuộc trò chuyện.');
      }
    } catch (e) {}
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchConversations();
    const timer = setInterval(fetchConversations, 60000); // fallback; new messages are pushed
    return () => clearInterval(timer);
  }, [isAuthenticated]);

  useEffect(() => {
    setPartner(null);
    setMessages([]);
    setThreadError(null);
    if (!isAuthenticated || !partnerUsername) return;
    // Opening a thread marks it read, so refresh the inbox counts right after
    fetchThread().then(fetchConversations);
    const timer = setInterval(fetchThread, 30000);
    return () => clearInterval(timer);
  }, [isAuthenticated, partnerUsername]);

  useRealtime('dm', () => {
    fetchConversations();
    fetchThread();
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || isSending || !partnerUsername) return;
    setIsSending(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/messages/${encodeURIComponent(partnerUsername)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: draft.trim() }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setDraft('');
        setThreadError(null);
        setMessages((prev) => [...prev, json.data]);
        fetchConversations();
      } else {
        setThreadError(json.message || 'Không thể gửi tin nhắn.');
      }
    } catch (e) {} finally {
      setIsSending(false);
    }
  };

  if (isAuthLoading) return <PageLoader label="Đang tải tin nhắn..." />;

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
        <MessageCircle className="w-10 h-10 mx-auto text-brand-400" />
        <p className="text-sm text-gray-300">Đăng nhập để nhắn tin với người dùng khác.</p>
        <button
          onClick={() => openAuthModal('login')}
          className="px-5 h-10 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-bold text-xs inline-flex items-center gap-1.5 transition"
        >
          <LogIn className="w-4 h-4" /> Đăng nhập
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24">
      <div className="rounded-3xl glass-panel border border-white/10 bg-glass overflow-hidden shadow-2xl flex h-[calc(100vh-10rem)] min-h-[480px]">

        {/* Inbox (hidden on phones while a thread is open) */}
        <aside className={`${partnerUsername ? 'hidden md:flex' : 'flex'} w-full md:w-80 shrink-0 flex-col border-r border-white/10`}>
          <div className="p-4 border-b border-white/10 bg-black/20 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-brand-400" />
            <h1 className="text-xs font-bold text-white uppercase tracking-wider">Tin nhắn</h1>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="p-6 text-center text-xs text-gray-500">
                Chưa có cuộc trò chuyện nào. Vào trang cá nhân của ai đó và bấm “Nhắn tin” để bắt đầu.
              </p>
            ) : conversations.map((c) => (
              <Link
                key={c.partner_id}
                href={`/tin-nhan?u=${encodeURIComponent(c.username)}`}
                className={`flex items-center gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition ${
                  c.username === partnerUsername ? 'bg-brand-600/15' : ''
                }`}
              >
                <Avatar src={c.avatar_url} alt={c.display_name || c.username} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm truncate ${c.unread > 0 ? 'font-extrabold text-white' : 'font-semibold text-gray-200'}`}>
                      {c.display_name || c.username}
                    </span>
                    <span className="ml-auto text-[10px] text-gray-500 shrink-0">
                      {new Date(c.last_at).toLocaleDateString('vi-VN')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs truncate ${c.unread > 0 ? 'text-gray-200' : 'text-gray-500'}`}>
                      {c.last_sender_id === user?.id ? 'Bạn: ' : ''}{c.last_message}
                    </span>
                    {c.unread > 0 && (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-[10px] font-bold text-snow flex items-center justify-center shrink-0">
                        {c.unread > 9 ? '9+' : c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </aside>

        {/* Thread */}
        <section className={`${partnerUsername ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0`}>
          {!partnerUsername ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 text-xs text-gray-500">
              <MessageCircle className="w-10 h-10 opacity-40" />
              <p>Chọn một cuộc trò chuyện ở bên trái.</p>
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-white/10 bg-black/20 flex items-center gap-3">
                <Link href="/tin-nhan" className="md:hidden p-1.5 rounded-lg text-gray-300 hover:bg-white/10" title="Quay lại">
                  <ArrowLeft className="w-4 h-4" />
                </Link>
                {partner && (
                  <Link href={`/nguoi-dung/${partner.username}`} className="flex items-center gap-2 min-w-0 hover:opacity-80">
                    <Avatar src={partner.avatar_url} alt={partner.display_name || partner.username} size="w-8 h-8" />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">{partner.display_name || partner.username}</div>
                      <div className="text-[11px] text-gray-500">@{partner.username}</div>
                    </div>
                  </Link>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2">
                {messages.length === 0 && !threadError && (
                  <p className="h-full flex items-center justify-center text-xs text-gray-500">
                    Hãy gửi lời chào đầu tiên!
                  </p>
                )}
                {messages.map((m) => {
                  const mine = m.sender_id === user?.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          mine ? 'bg-brand-600 text-snow rounded-br-md' : 'bg-white/5 border border-white/10 text-gray-200 rounded-bl-md'
                        }`}
                        title={new Date(m.created_at).toLocaleString('vi-VN')}
                      >
                        {m.message}
                        <div className={`text-[10px] mt-1 ${mine ? 'text-snow/70 text-right' : 'text-gray-500'}`}>
                          {new Date(m.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          {mine && m.read_at && ' · Đã xem'}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {threadError && (
                <div className="px-4 py-2 bg-rose-500/10 border-t border-rose-500/30 text-rose-300 text-[11px] font-semibold">
                  {threadError}
                </div>
              )}
              {partner && partner.id !== user?.id && (
                <form onSubmit={handleSend} className="p-3 border-t border-white/10 bg-black/30 flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={`Nhắn cho ${partner.display_name || partner.username}...`}
                    value={draft}
                    maxLength={2000}
                    onChange={(e) => setDraft(e.target.value)}
                    className="flex-1 h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || isSending}
                    className="px-5 h-10 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-snow font-bold text-xs flex items-center gap-1.5 transition"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Gửi</span>
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<PageLoader label="Đang tải tin nhắn..." />}>
      <MessagesInner />
    </Suspense>
  );
}
