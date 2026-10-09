'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Ban, Check, ChevronDown, LogIn, MessageCircle, Pin, PinOff, Search, Send, Settings2, Tag, X,
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import PageLoader from '@/components/common/PageLoader';
import LabelManager from '@/components/messages/LabelManager';
import { DmLabel, labelStyle } from '@/components/messages/labels';
import { useAuth } from '@/context/AuthContext';
import { useRealtime } from '@/lib/realtime';
import { apiJson } from '@/lib/apiJson';

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100';

function Avatar({ src, alt, size = 'w-10 h-10' }: { src?: string | null; alt: string; size?: string }) {
  return (
    <div className={`${size} rounded-full overflow-hidden bg-brand-600/30 border border-brand-500/30 shrink-0`}>
      <SmartImage src={src || DEFAULT_AVATAR} alt={alt} className="w-full h-full object-cover" />
    </div>
  );
}

/** `text` with every case-insensitive occurrence of `query` highlighted. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase() ? <mark key={i} className="bg-amber-400/30 text-amber-100 rounded px-0.5">{p}</mark> : p
      )}
    </>
  );
}

function LabelPills({ ids, labels }: { ids: string[]; labels: DmLabel[] }) {
  const mine = labels.filter((l) => ids.includes(l.id));
  if (!mine.length) return null;
  return (
    <div className="flex items-center gap-1 mt-1 overflow-hidden">
      {mine.slice(0, 2).map((l) => (
        <span key={l.id} className={`px-1.5 py-px rounded-md border text-[10px] font-semibold truncate max-w-[90px] ${labelStyle(l.color).chip}`}>
          {l.name}
        </span>
      ))}
      {mine.length > 2 && <span className="text-[10px] text-gray-500">+{mine.length - 2}</span>}
    </div>
  );
}

function MessagesInner() {
  const { user, isAuthenticated, isLoading: isAuthLoading, openAuthModal, authFetch } = useAuth();
  const partnerUsername = useSearchParams().get('u');

  const [conversations, setConversations] = useState<any[]>([]);
  const [labels, setLabels] = useState<DmLabel[]>([]);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // debounced `search`
  const [isLabelManagerOpen, setIsLabelManagerOpen] = useState(false);

  const [partner, setPartner] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [pinned, setPinned] = useState<any[]>([]);
  const [threadLabels, setThreadLabels] = useState<string[]>([]);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [canMessage, setCanMessage] = useState(true);
  const [showPinned, setShowPinned] = useState(false);
  const [isLabelMenuOpen, setIsLabelMenuOpen] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const labelMenuRef = useRef<HTMLDivElement>(null);

  const api = (path: string, init?: RequestInit & { json?: unknown }) => apiJson(authFetch, path, init);

  const fetchConversations = async () => {
    const params = new URLSearchParams();
    if (activeLabel) params.set('label', activeLabel);
    if (query) params.set('q', query);
    try {
      const { ok, json } = await api(`/messages${params.toString() ? `?${params}` : ''}`);
      if (ok) setConversations(json.data.conversations || []);
    } catch (e) {}
  };

  const fetchLabels = async () => {
    try {
      const { ok, json } = await api('/messages/labels');
      if (ok) setLabels(json.data.labels || []);
    } catch (e) {}
  };

  const fetchThread = async () => {
    if (!partnerUsername) return;
    try {
      const { ok, json } = await api(`/messages/${encodeURIComponent(partnerUsername)}`);
      if (ok) {
        setPartner(json.data.partner);
        setMessages(json.data.messages || []);
        setPinned(json.data.pinned || []);
        setThreadLabels(json.data.label_ids || []);
        setBlockedByMe(!!json.data.blocked_by_me);
        setCanMessage(json.data.can_message !== false);
        setThreadError(null);
      } else {
        setThreadError(json.message || 'Không tải được cuộc trò chuyện.');
      }
    } catch (e) {}
  };

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchLabels();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchConversations();
    const timer = setInterval(fetchConversations, 60000); // fallback; new messages are pushed
    return () => clearInterval(timer);
  }, [isAuthenticated, activeLabel, query]);

  useEffect(() => {
    setPartner(null);
    setMessages([]);
    setPinned([]);
    setShowPinned(false);
    setIsLabelMenuOpen(false);
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

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (labelMenuRef.current && !labelMenuRef.current.contains(e.target as Node)) setIsLabelMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || isSending || !partnerUsername) return;
    setIsSending(true);
    try {
      const { ok, json } = await api(`/messages/${encodeURIComponent(partnerUsername)}`, { method: 'POST', json: { message: draft.trim() } });
      if (ok) {
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

  // ---- labels
  const labelResult = async (p: Promise<{ ok: boolean; json: any }>) => {
    const { ok, json } = await p;
    if (!ok) return json.message || 'Có lỗi xảy ra.';
    await Promise.all([fetchLabels(), fetchConversations()]);
    return null;
  };
  const createLabel = (name: string, color: string) => labelResult(api('/messages/labels', { method: 'POST', json: { name, color } }));
  const updateLabel = (id: string, patch: { name?: string; color?: string }) =>
    labelResult(api(`/messages/labels/${id}`, { method: 'PATCH', json: patch }));
  const deleteLabel = async (id: string) => {
    const err = await labelResult(api(`/messages/labels/${id}`, { method: 'DELETE' }));
    if (!err) {
      if (activeLabel === id) setActiveLabel(null);
      setThreadLabels((prev) => prev.filter((x) => x !== id));
    }
    return err;
  };

  const toggleThreadLabel = async (id: string) => {
    if (!partnerUsername) return;
    const next = threadLabels.includes(id) ? threadLabels.filter((x) => x !== id) : [...threadLabels, id];
    setThreadLabels(next);
    const { ok, json } = await api(`/messages/${encodeURIComponent(partnerUsername)}/labels`, { method: 'PUT', json: { label_ids: next } });
    if (!ok) setThreadError(json.message || 'Không gắn được nhãn.');
    fetchLabels();
    fetchConversations();
  };

  // ---- block / pin
  const toggleBlock = async () => {
    if (!partnerUsername || !partner) return;
    const name = partner.display_name || partner.username;
    if (!blockedByMe && !window.confirm(`Chặn ${name}? Hai bạn sẽ không nhắn tin được cho nhau cho đến khi bạn bỏ chặn.`)) return;
    const { ok, json } = await api(`/messages/${encodeURIComponent(partnerUsername)}/block`, { method: blockedByMe ? 'DELETE' : 'POST' });
    if (!ok) setThreadError(json.message || 'Có lỗi xảy ra.');
    fetchThread();
    fetchConversations();
  };

  const togglePin = async (m: any) => {
    if (!partnerUsername) return;
    const { ok, json } = await api(`/messages/${encodeURIComponent(partnerUsername)}/pins/${m.id}`, { method: m.pinned_at ? 'DELETE' : 'POST' });
    if (!ok) setThreadError(json.message || 'Không ghim được tin nhắn.');
    else setThreadError(null);
    fetchThread();
  };

  const jumpTo = (id: string) => {
    const el = document.getElementById(`dm-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(id);
    setTimeout(() => setFlashId(null), 1600);
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

  const partnerName = partner ? partner.display_name || partner.username : '';
  const chip = (active: boolean) =>
    `shrink-0 px-2.5 h-7 rounded-full border text-[11px] font-semibold flex items-center gap-1.5 transition ${
      active ? 'bg-white text-ink border-white' : 'bg-white/[0.04] text-gray-300 border-white/10 hover:bg-white/[0.08]'
    }`;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24">
      <div className="rounded-3xl glass-panel border border-white/10 bg-glass overflow-hidden shadow-2xl flex h-[calc(100vh-10rem)] min-h-[480px]">

        {/* Inbox (hidden on phones while a thread is open) */}
        <aside className={`${partnerUsername ? 'hidden md:flex' : 'flex'} w-full md:w-80 shrink-0 flex-col border-r border-white/10`}>
          <div className="p-3 border-b border-white/10 bg-black/20 space-y-2.5">
            <div className="flex items-center gap-2 px-1">
              <MessageCircle className="w-4 h-4 text-brand-400" />
              <h1 className="text-xs font-bold text-white uppercase tracking-wider">Tin nhắn</h1>
              <button
                onClick={() => setIsLabelManagerOpen(true)}
                className="ml-auto flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] font-semibold text-gray-300 hover:text-white hover:bg-white/10"
                title="Quản lý nhãn"
              >
                <Settings2 className="w-3.5 h-3.5" /> Nhãn
              </button>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={activeLabel ? 'Tìm trong nhãn này...' : 'Tìm người hoặc nội dung tin nhắn...'}
                aria-label="Tìm tin nhắn"
                className="w-full h-8 pl-8 pr-7 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label="Xóa tìm kiếm" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1">
              <button onClick={() => setActiveLabel(null)} className={chip(!activeLabel)}>Tất cả</button>
              {labels.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setActiveLabel(activeLabel === l.id ? null : l.id)}
                  className={activeLabel === l.id
                    ? `shrink-0 px-2.5 h-7 rounded-full border text-[11px] font-semibold flex items-center gap-1.5 ${labelStyle(l.color).chipActive}`
                    : chip(false)}
                >
                  <span className={`w-2 h-2 rounded-full ${labelStyle(l.color).dot}`} />
                  {l.name}
                  <span className="opacity-60">{l.conversation_count}</span>
                </button>
              ))}
              {labels.length === 0 && (
                <button onClick={() => setIsLabelManagerOpen(true)} className={`${chip(false)} border-dashed`}>
                  <Tag className="w-3 h-3" /> Tạo nhãn
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="p-6 text-center text-xs text-gray-500">
                {query || activeLabel
                  ? 'Không có cuộc trò chuyện nào khớp.'
                  : 'Chưa có cuộc trò chuyện nào. Vào trang cá nhân của ai đó và bấm “Nhắn tin” để bắt đầu.'}
              </p>
            ) : conversations.map((c) => (
              <Link
                key={c.partner_id}
                href={`/tin-nhan?u=${encodeURIComponent(c.username)}`}
                className={`flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition ${
                  c.username === partnerUsername ? 'bg-brand-600/15' : ''
                }`}
              >
                <Avatar src={c.avatar_url} alt={c.display_name || c.username} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm truncate ${c.unread > 0 ? 'font-extrabold text-white' : 'font-semibold text-gray-200'}`}>
                      <Highlight text={c.display_name || c.username} query={query} />
                    </span>
                    {c.blocked && <Ban className="w-3 h-3 text-rose-400 shrink-0" aria-label="Đã chặn" />}
                    <span className="ml-auto text-[10px] text-gray-500 shrink-0">
                      {new Date(c.last_at).toLocaleDateString('vi-VN')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs truncate ${c.unread > 0 ? 'text-gray-200' : 'text-gray-500'}`}>
                      {c.match_message
                        ? <Highlight text={c.match_message} query={query} />
                        : <>{c.last_sender_id === user?.id ? 'Bạn: ' : ''}{c.last_message}</>}
                    </span>
                    {c.unread > 0 && (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-[10px] font-bold text-snow flex items-center justify-center shrink-0">
                        {c.unread > 9 ? '9+' : c.unread}
                      </span>
                    )}
                  </div>
                  <LabelPills ids={c.label_ids || []} labels={labels} />
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
                    <Avatar src={partner.avatar_url} alt={partnerName} size="w-8 h-8" />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">{partnerName}</div>
                      <div className="text-[11px] text-gray-500">@{partner.username}</div>
                    </div>
                  </Link>
                )}

                {partner && partner.id !== user?.id && (
                  <div className="ml-auto flex items-center gap-1">
                    {/* Labels for this conversation */}
                    <div className="relative" ref={labelMenuRef}>
                      <button
                        onClick={() => setIsLabelMenuOpen((v) => !v)}
                        className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition ${
                          isLabelMenuOpen ? 'bg-white/10 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'
                        }`}
                        title="Gắn nhãn"
                      >
                        <Tag className="w-3.5 h-3.5 text-fuchsia-400" />
                        <span className="hidden sm:inline">Nhãn{threadLabels.length ? ` (${threadLabels.length})` : ''}</span>
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      {isLabelMenuOpen && (
                        <div className="absolute right-0 mt-2 w-56 rounded-xl glass-menu py-1.5 z-20">
                          {labels.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">Chưa có nhãn nào.</p>}
                          {labels.map((l) => (
                            <button
                              key={l.id}
                              onClick={() => toggleThreadLabel(l.id)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/5"
                            >
                              <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                                threadLabels.includes(l.id) ? 'bg-brand-600 border-brand-500' : 'border-white/20'
                              }`}>
                                {threadLabels.includes(l.id) && <Check className="w-3 h-3 text-snow" strokeWidth={3} />}
                              </span>
                              <span className={`w-2 h-2 rounded-full ${labelStyle(l.color).dot}`} />
                              <span className="truncate">{l.name}</span>
                            </button>
                          ))}
                          <div className="border-t border-white/10 mt-1 pt-1">
                            <button
                              onClick={() => { setIsLabelMenuOpen(false); setIsLabelManagerOpen(true); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-brand-400 hover:bg-white/5"
                            >
                              <Settings2 className="w-3.5 h-3.5" /> Tạo / sửa nhãn
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setShowPinned((v) => !v)}
                      disabled={!pinned.length}
                      className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition disabled:opacity-40 ${
                        showPinned ? 'bg-white/10 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'
                      }`}
                      title="Tin đã ghim"
                    >
                      <Pin className="w-3.5 h-3.5 text-amber-400" />
                      <span>{pinned.length}</span>
                    </button>

                    <button
                      onClick={toggleBlock}
                      className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition ${
                        blockedByMe ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25' : 'text-gray-300 hover:text-rose-300 hover:bg-rose-500/10'
                      }`}
                      title={blockedByMe ? 'Bỏ chặn' : 'Chặn người này'}
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{blockedByMe ? 'Bỏ chặn' : 'Chặn'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Pinned messages: latest one always visible, the full list on demand */}
              {pinned.length > 0 && (
                <div className="border-b border-white/10 bg-amber-500/[0.06]">
                  <button
                    onClick={() => (showPinned ? setShowPinned(false) : jumpTo(pinned[0].id))}
                    className="w-full flex items-center gap-2 px-4 py-2 text-left"
                  >
                    <Pin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-[11px] font-semibold text-amber-300 shrink-0">Đã ghim</span>
                    <span className="text-xs text-gray-300 truncate">{pinned[0].message}</span>
                    {pinned.length > 1 && (
                      <span
                        onClick={(e) => { e.stopPropagation(); setShowPinned((v) => !v); }}
                        className="ml-auto text-[11px] text-amber-300 hover:underline shrink-0"
                      >
                        {showPinned ? 'Thu gọn' : `Xem cả ${pinned.length}`}
                      </span>
                    )}
                  </button>
                  {showPinned && (
                    <div className="max-h-48 overflow-y-auto px-2 pb-2 space-y-1">
                      {pinned.map((m) => (
                        <div key={m.id} className="group flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5">
                          <button onClick={() => jumpTo(m.id)} className="flex-1 min-w-0 text-left">
                            <div className="text-[10px] text-gray-500">
                              {m.sender_id === user?.id ? 'Bạn' : partnerName} · {new Date(m.created_at).toLocaleString('vi-VN')}
                            </div>
                            <div className="text-xs text-gray-200 line-clamp-2 whitespace-pre-wrap break-words">{m.message}</div>
                          </button>
                          <button onClick={() => togglePin(m)} title="Bỏ ghim" className="p-1 rounded text-gray-500 hover:text-amber-300 opacity-0 group-hover:opacity-100">
                            <PinOff className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2">
                {messages.length === 0 && !threadError && (
                  <p className="h-full flex items-center justify-center text-xs text-gray-500">
                    Hãy gửi lời chào đầu tiên!
                  </p>
                )}
                {messages.map((m) => {
                  const mine = m.sender_id === user?.id;
                  return (
                    <div key={m.id} id={`dm-${m.id}`} className={`group flex items-center gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
                      <div
                        className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words transition-shadow ${
                          mine ? 'bg-brand-600 text-snow rounded-br-md' : 'bg-white/5 border border-white/10 text-gray-200 rounded-bl-md'
                        } ${flashId === m.id ? 'ring-2 ring-amber-400' : ''}`}
                        title={new Date(m.created_at).toLocaleString('vi-VN')}
                      >
                        {m.message}
                        <div className={`text-[10px] mt-1 flex items-center gap-1 ${mine ? 'text-snow/70 justify-end' : 'text-gray-500'}`}>
                          {m.pinned_at && <Pin className="w-2.5 h-2.5 text-amber-300" aria-label="Đã ghim" />}
                          {new Date(m.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          {mine && m.read_at && ' · Đã xem'}
                        </div>
                      </div>
                      <button
                        onClick={() => togglePin(m)}
                        title={m.pinned_at ? 'Bỏ ghim' : 'Ghim tin nhắn'}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-amber-300 hover:bg-white/5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                      >
                        {m.pinned_at ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      </button>
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
              {partner && partner.id !== user?.id && (canMessage ? (
                <form onSubmit={handleSend} className="p-3 border-t border-white/10 bg-black/30 flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={`Nhắn cho ${partnerName}...`}
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
              ) : (
                <div className="p-3 border-t border-white/10 bg-black/30 flex items-center justify-center gap-3 text-xs text-gray-400">
                  <Ban className="w-4 h-4 text-rose-400" />
                  {blockedByMe ? (
                    <>
                      <span>Bạn đã chặn {partnerName}.</span>
                      <button onClick={toggleBlock} className="text-brand-400 hover:underline font-semibold">Bỏ chặn</button>
                    </>
                  ) : (
                    <span>Không thể gửi tin nhắn cho người này.</span>
                  )}
                </div>
              ))}
            </>
          )}
        </section>
      </div>

      <LabelManager
        isOpen={isLabelManagerOpen}
        onClose={() => setIsLabelManagerOpen(false)}
        labels={labels}
        onCreate={createLabel}
        onUpdate={updateLabel}
        onDelete={deleteLabel}
      />
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
