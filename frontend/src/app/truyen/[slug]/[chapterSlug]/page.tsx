'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { 
  ArrowLeft, 
  ChevronLeft, 
  ChevronRight, 
  Settings, 
  List, 
  Bookmark, 
  BookOpen, 
  Eye, 
  AlertCircle,
  MessageSquare,
  Users,
  User,
  Clock,
  Trash2,
  Pencil,
  CheckCircle2
} from 'lucide-react';
import ReaderSettingsModal, { ReaderSettings } from '@/components/reader/ReaderSettingsModal';
import ChapterSelectorModal from '@/components/reader/ChapterSelectorModal';
import FloatingReaderBar from '@/components/reader/FloatingReaderBar';
import CommentSection from '@/components/comments/CommentSection';
import ReportButton from '@/components/common/ReportButton';
import SmartImage from '@/components/common/SmartImage';
import { useAuth } from '@/context/AuthContext';
import { useReadingSession } from '@/context/ReadingSessionContext';
import { logChapterRead } from '@/lib/readingHistory';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function ChapterReaderPage() {
  const params = useParams();
  const router = useRouter();
  const { user, hasRole, authFetch, isAuthenticated, openAuthModal } = useAuth();
  const { setSession: setReadingSession, updateScrollPercent } = useReadingSession();

  const storySlug = params?.slug as string;
  const chapterSlug = params?.chapterSlug as string;

  const [chapterData, setChapterData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChapterSelectorOpen, setIsChapterSelectorOpen] = useState(false);
  const [bookmarkedLines, setBookmarkedLines] = useState<Set<number>>(new Set());
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2800);
  };

  // Fetch bookmarks for current chapter
  const fetchBookmarks = useCallback(async (chapId: string) => {
    if (!chapId) return;
    const lines = new Set<number>();

    // Line bookmarks belong to the signed-in account and live only on the server
    if (isAuthenticated) {
      try {
        const res = await authFetch(`${API_BASE_URL}/bookmarks?chapter_id=${chapId}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            json.data.forEach((b: any) => {
              if (b.line_index !== null && b.line_index !== undefined) {
                lines.add(b.line_index);
              }
            });
          }
        }
      } catch (e) {
        console.error('Failed to load chapter bookmarks:', e);
      }
    }

    setBookmarkedLines(lines);
  }, [isAuthenticated, authFetch]);

  useEffect(() => {
    if (chapterData?.id) {
      fetchBookmarks(chapterData.id);
    }
  }, [chapterData?.id, fetchBookmarks]);

  // Auto-log Reading History whenever user reads this chapter
  useEffect(() => {
    if (!chapterData?.id) return;
    const storyId = chapterData.story_id || chapterData.story?.id;
    const chapterId = chapterData.id;
    if (!storyId || !chapterId) return;

    logChapterRead({
      storyId,
      storySlug: chapterData.story?.slug || storySlug,
      storyTitle: chapterData.story?.title,
      storyCover: chapterData.story?.cover_image_url,
      storyAuthor: chapterData.story?.author_name,
      storyType: chapterData.story?.story_type,
      groupName: chapterData.story?.group_name,
      chapterId,
      chapterSlug: chapterData.slug || chapterSlug,
      chapterTitle: chapterData.title,
      chapterNumber: chapterData.chapter_number,
      isAuthenticated,
      authFetch,
      apiBaseUrl: API_BASE_URL,
    });

    // Feed the global "continue reading" miniplayer so it can follow the user off this page.
    // Content is included so expanding the miniplayer into its reading tier needs no extra fetch.
    setReadingSession({
      storyId,
      storySlug: chapterData.story?.slug || storySlug,
      storyTitle: chapterData.story?.title || 'Tiểu Thuyết',
      storyCover: chapterData.story?.cover_image_url || '',
      storyType: chapterData.story?.story_type,
      chapterId,
      chapterSlug: chapterData.slug || chapterSlug,
      chapterTitle: chapterData.title,
      chapterNumber: chapterData.chapter_number,
      prevChapterSlug: chapterData.prev_chapter?.slug ?? null,
      nextChapterSlug: chapterData.next_chapter?.slug ?? null,
      content: chapterData.content,
      contentBlocks: chapterData.content_blocks,
      pages: chapterData.pages,
    });
  }, [chapterData?.id, isAuthenticated]);

  // Keep the miniplayer's progress bar in sync while the user scrolls this chapter
  useEffect(() => {
    if (!chapterData?.id) return;
    const chapterId = chapterData.id;

    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      const percent = totalHeight > 0 ? Math.min(100, Math.max(0, Math.round((window.scrollY / totalHeight) * 100))) : 0;
      updateScrollPercent(chapterId, percent);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [chapterData?.id, updateScrollPercent]);

  // Check for line hash or search param to auto-scroll
  useEffect(() => {
    if (!chapterData || isLoading) return;

    const searchParams = new URLSearchParams(window.location.search);
    const lineParam = searchParams.get('line');
    let targetIndex: number | null = null;

    if (lineParam !== null && !isNaN(parseInt(lineParam))) {
      targetIndex = parseInt(lineParam);
    } else if (window.location.hash.startsWith('#line-')) {
      const parsed = parseInt(window.location.hash.replace('#line-', ''));
      if (!isNaN(parsed)) targetIndex = parsed;
    }

    if (targetIndex !== null) {
      setHighlightedLine(targetIndex);
      const timer = setTimeout(() => {
        const el = document.getElementById(`line-${targetIndex}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [chapterData, isLoading]);

  const handleToggleBookmarkLine = async (lineIdx: number, lineText: string) => {
    if (!chapterData) return;
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }

    // Optimistic update, rolled back if the server rejects it
    const nextIsBookmarked = !bookmarkedLines.has(lineIdx);
    const applyBookmarked = (bookmarked: boolean) => {
      setBookmarkedLines((prev) => {
        const next = new Set(prev);
        if (bookmarked) next.add(lineIdx);
        else next.delete(lineIdx);
        return next;
      });
    };
    applyBookmarked(nextIsBookmarked);

    try {
      // The server toggles: it removes an existing bookmark on the same line, otherwise adds one
      const res = await authFetch(`${API_BASE_URL}/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_id: chapterData.story_id || chapterData.story?.id,
          chapter_id: chapterData.id,
          line_text: lineText,
          line_index: lineIdx,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || `HTTP ${res.status}`);
      const added = json.action !== 'removed';
      if (added !== nextIsBookmarked) applyBookmarked(added);
      showToast(added ? `Đã lưu bookmark đoạn ${lineIdx + 1}!` : `Đã bỏ bookmark đoạn ${lineIdx + 1}.`);
    } catch (e) {
      console.error('Failed to update bookmark:', e);
      applyBookmarked(!nextIsBookmarked);
      showToast('Không thể cập nhật bookmark. Vui lòng thử lại.');
    }
  };

  // Reader Settings State
  const [settings, setSettings] = useState<ReaderSettings>({
    theme: 'dark',
    fontFamily: 'Noto Serif',
    fontSize: 18,
    lineHeight: 1.8,
    maxWidth: '860px',
    textAlign: 'left',
  });

  // 1. Fetch chapter details
  useEffect(() => {
    async function fetchChapter() {
      if (!storySlug || !chapterSlug) return;
      setIsLoading(true);
      try {
        const res = await authFetch(`${API_BASE_URL}/stories/${storySlug}/chapters/${chapterSlug}`, { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setChapterData(json.data);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }
      } catch (err) {
        console.error('Failed to fetch chapter:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchChapter();
  }, [storySlug, chapterSlug, authFetch]);

  const canManage = Boolean(
    hasRole('admin', 'mod') ||
    (user && chapterData && (
      user.id === chapterData.uploader_id ||
      user.id === chapterData.story?.uploader_id
    ))
  );

  const handleDeleteCurrentChapter = async () => {
    if (!chapterData) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa chương "${chapterData.title}"? Thao tác này không thể hoàn tác.`)) return;

    try {
      const res = await authFetch(`${API_BASE_URL}/chapters/${chapterData.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        alert('Đã xóa chương thành công.');
        router.push(`/truyen/${storySlug}`);
      } else {
        alert(json.message || 'Xóa chương thất bại.');
      }
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  // 2. Keyboard Navigation (Left / Right / A / D)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      if (chapterData?.prev_chapter) {
        router.push(`/truyen/${storySlug}/${chapterData.prev_chapter.slug}`);
      }
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      if (chapterData?.next_chapter) {
        router.push(`/truyen/${storySlug}/${chapterData.next_chapter.slug}`);
      }
    }
  }, [chapterData, storySlug, router]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (isLoading) {
    return (
      <div className="min-h-screen max-w-3xl mx-auto px-4 py-16 space-y-6 animate-pulse">
        <div className="h-10 bg-white/5 rounded-xl w-3/4" />
        <div className="h-6 bg-white/5 rounded w-1/2" />
        <div className="space-y-4 pt-8">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="h-4 bg-white/5 rounded w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!chapterData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-brand-400" />
        <h2 className="text-xl font-bold text-white">Không tìm thấy nội dung chương này</h2>
        <Link
          href={`/truyen/${storySlug}`}
          className="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold"
        >
          Quay lại trang truyện
        </Link>
      </div>
    );
  }

  // Theme styling classes
  const themeClasses = {
    dark: 'bg-[#0d0d15] text-[#e2e8f0]',
    amoled: 'bg-[#000000] text-[#cccccc]',
    sepia: 'bg-[#F4ECD8] text-[#5B4636]',
    light: 'bg-[#FFFFFF] text-[#1a202c]',
  }[settings.theme];

  const headerBgClass = {
    dark: 'bg-[#12121e]/90 border-white/10 text-white',
    amoled: 'bg-black/90 border-white/20 text-white',
    sepia: 'bg-[#e8dec5]/90 border-[#d4c5a9] text-[#5B4636]',
    light: 'bg-gray-100/90 border-gray-200 text-gray-900',
  }[settings.theme];

  const fontClass = {
    'Noto Serif': 'font-serif',
    'Inter': 'font-sans',
    'Roboto': 'font-sans',
    'Georgia': 'font-serif',
    'Merriweather': 'font-serif',
  }[settings.fontFamily];

  const hasBlocks = Array.isArray(chapterData.content_blocks) && chapterData.content_blocks.length > 0;

  // Fallback paragraphs
  const paragraphs = chapterData.content
    ? chapterData.content.split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean)
    : [
        'Nội dung chương này đang được dịch hoặc cập nhật.',
        'Vui lòng quay lại sau hoặc đọc các chương khác.'
      ];

  const isManga = chapterData.story?.story_type === 'manga';

  const isMarkdownImage = (text: string) => {
    return /^!\[(.*?)\]\((.*?)\)$/.test(text);
  };

  const getImageUrl = (text: string) => {
    const match = text.match(/^!\[(.*?)\]\((.*?)\)$/);
    return match ? match[2] : '';
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 pb-28 ${themeClasses}`}>
      
      {/* 1. Sticky Reader Top Control Bar */}
      <header className={`sticky top-0 z-40 w-full backdrop-blur-md border-b transition-colors duration-300 ${headerBgClass}`}>
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          
          {/* Left: Back to Story & Title */}
          <div className="flex items-center gap-3 truncate">
            <Link
              href={`/truyen/${storySlug}`}
              className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition"
              title="Quay lại mục lục truyện"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="truncate">
              <h2 className="text-xs font-bold truncate opacity-80">{chapterData.story?.title}</h2>
              <h1 className="text-sm font-extrabold truncate">{chapterData.title}</h1>
            </div>
          </div>

          {/* Right: Actions (Prev/Next, Chapter List, Settings) */}
          <div className="flex items-center gap-1.5 shrink-0">
            
            {/* Prev Chapter */}
            <button
              onClick={() => chapterData.prev_chapter && router.push(`/truyen/${storySlug}/${chapterData.prev_chapter.slug}`)}
              disabled={!chapterData.prev_chapter}
              className="p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
              title="Chương trước (Phím A / Mũi tên trái)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Chapter Selector Trigger */}
            <button
              onClick={() => setIsChapterSelectorOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:hover:bg-white/15 text-xs font-semibold transition"
              title="Mục lục chương"
            >
              <List className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Chương {chapterData.chapter_number}</span>
            </button>

            {/* Next Chapter */}
            <button
              onClick={() => chapterData.next_chapter && router.push(`/truyen/${storySlug}/${chapterData.next_chapter.slug}`)}
              disabled={!chapterData.next_chapter}
              className="p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
              title="Chương sau (Phím D / Mũi tên phải)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Reader Settings Trigger */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white shadow-sm transition ml-1"
              title="Tùy chỉnh font chữ, cỡ chữ, màu nền"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Report violation (icon only in the header) */}
            {chapterData?.id && (
              <ReportButton
                targetType="chapter"
                targetId={chapterData.id}
                className="p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition ml-1 flex items-center [&>span]:hidden"
              />
            )}

            {/* Edit / Delete Chapter for Admin / Mod / Owner */}
            {canManage && (
              <Link
                href={`/dang-chuong?edit=${chapterData.id}`}
                className="p-2 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-500/30 transition ml-1"
                title="Sửa chương này (Chủ thầu / Admin / Mod)"
              >
                <Pencil className="w-4 h-4" />
              </Link>
            )}
            {canManage && (
              <button
                onClick={handleDeleteCurrentChapter}
                className="p-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 transition ml-1"
                title="Xóa chương này (Chủ thầu / Admin / Mod)"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

        </div>
      </header>

      {/* 2. Main Reader Canvas */}
      <main 
        className="mx-auto px-4 sm:px-6 py-10 transition-all duration-300"
        style={{ maxWidth: settings.maxWidth }}
      >
        {/* Chapter Title & Publisher Meta Header */}
        <div className="text-center pb-8 border-b border-white/10 space-y-3 mb-8">
          {chapterData.volume_title && (
            <div className="text-xs uppercase font-bold tracking-wider text-brand-400">
              {chapterData.volume_title}
            </div>
          )}
          <h1 className="text-xl sm:text-3xl font-extrabold tracking-wide leading-snug">
            {chapterData.title}
          </h1>

          {/* Publisher & Group Info */}
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs opacity-75 pt-1">
            {chapterData.story?.group_name && (
              <span className="flex items-center gap-1 font-bold text-brand-300">
                <Users className="w-3.5 h-3.5" /> Nhóm: {chapterData.story.group_name}
              </span>
            )}
            {chapterData.story?.group_name && <span>•</span>}
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" /> Người dịch: <strong>{chapterData.uploader_name || chapterData.uploader_username}</strong>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {new Date(chapterData.published_at).toLocaleDateString('vi-VN')}
            </span>
            {chapterData.word_count > 0 && (
              <>
                <span>•</span>
                <span>{chapterData.word_count.toLocaleString()} chữ</span>
              </>
            )}
          </div>
        </div>

        {/* 3. MANGA DISPLAY MODE */}
        {isManga && chapterData.pages && chapterData.pages.length > 0 ? (
          <div className="space-y-4 flex flex-col items-center">
            {chapterData.pages.map((page: any) => (
              <div key={page.page_number} className="w-full max-w-3xl rounded-xl overflow-hidden shadow-2xl bg-black/40">
                <SmartImage
                  src={page.image_url}
                  adaptive
                  alt={`Trang ${page.page_number}`}
                  className="w-full h-auto"
                />
              </div>
            ))}
          </div>
        ) : (
          /* 4. SMART NOVEL DISPLAY MODE (Line-by-Line with Translator Notes & Inline Images) */
          <div 
            className={`space-y-6 ${fontClass}`}
            style={{ 
              fontSize: `${settings.fontSize}px`, 
              lineHeight: settings.lineHeight,
              textAlign: settings.textAlign as any
            }}
          >
            {hasBlocks ? (
              // RENDER SMART CONTENT BLOCKS
              chapterData.content_blocks.map((block: any, idx: number) => (
                <div 
                  key={block.id || idx}
                  id={`line-${idx}`}
                  className={`group relative rounded-xl p-2.5 transition-colors duration-200 space-y-3 ${
                    highlightedLine === idx ? 'bg-amber-500/20 ring-2 ring-amber-400 border-l-4 border-amber-400 shadow-md' : bookmarkedLines.has(idx) ? 'bg-brand-500/15 border-l-4 border-brand-500' : 'hover:bg-white/5'
                  }`}
                >
                  {/* Paragraph text */}
                  {block.text && (
                    <p className="leading-relaxed">
                      {block.text}
                    </p>
                  )}

                  {/* Translator Annotation / Note at this line */}
                  {block.note && (
                    <div className="p-3.5 rounded-2xl bg-amber-500/10 border-l-4 border-amber-500 text-xs font-sans text-amber-200 italic space-y-1 shadow-sm">
                      <span className="font-extrabold text-[11px] uppercase tracking-wider text-amber-400 not-italic flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5" /> Lời Bình / Chú Thích Dịch Giả:
                      </span>
                      <div className="not-italic leading-relaxed">{block.note}</div>
                    </div>
                  )}

                  {/* Inline Illustration at this exact line */}
                  {block.image_url && block.image_url !== 'placeholder' && (
                    <div className="my-6 flex flex-col items-center not-prose">
                      <div className="rounded-3xl overflow-hidden shadow-2xl border border-white/15 max-w-xl bg-black/40">
                        <SmartImage
                          src={block.image_url}
                          adaptive
                          alt={`Minh họa đoạn ${idx + 1}`}
                          className="w-full h-auto max-h-[85vh] object-contain"
                        />
                      </div>
                      <span className="text-xs opacity-60 mt-2.5 font-sans italic text-center">
                        Ảnh minh họa Light Novel (Đoạn #{idx + 1})
                      </span>
                    </div>
                  )}

                  {/* Bookmark line action button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleToggleBookmarkLine(idx, block.text || '');
                    }}
                    className={`absolute right-2 top-2 p-1.5 rounded-lg transition-all cursor-pointer z-20 select-none active:scale-90 ${
                      bookmarkedLines.has(idx)
                        ? 'opacity-100 text-amber-400 bg-amber-500/25 border border-amber-400/50 shadow-sm ring-1 ring-amber-400/30'
                        : 'opacity-35 hover:opacity-100 text-gray-400 hover:text-amber-400 hover:bg-white/10'
                    }`}
                    title={bookmarkedLines.has(idx) ? 'Bỏ đánh dấu đoạn này' : 'Đánh dấu đoạn đang đọc'}
                  >
                    <Bookmark className={`w-4 h-4 transition-transform ${bookmarkedLines.has(idx) ? 'fill-amber-400 text-amber-400 scale-110' : ''}`} />
                  </button>
                </div>
              ))
            ) : (
              // RENDER REGULAR PARAGRAPHS
              paragraphs.map((p: string, idx: number) => {
                if (isMarkdownImage(p)) {
                  const imgUrl = getImageUrl(p);
                  return (
                    <div key={idx} className="my-8 flex flex-col items-center not-prose">
                      <div className="rounded-3xl overflow-hidden shadow-2xl border border-white/15 max-w-xl bg-black/40">
                        <SmartImage
                          src={imgUrl}
                          adaptive
                          alt={`Minh họa ${chapterData.title}`}
                          className="w-full h-auto max-h-[85vh] object-contain"
                        />
                      </div>
                      <span className="text-xs opacity-60 mt-2.5 font-sans italic text-center">
                        Ảnh minh họa Light Novel
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={idx}
                    id={`line-${idx}`}
                    className={`group relative rounded-xl p-2 transition-colors duration-200 ${
                      highlightedLine === idx ? 'bg-amber-500/20 ring-2 ring-amber-400 border-l-4 border-amber-400 shadow-md' : bookmarkedLines.has(idx) ? 'bg-brand-500/15 border-l-4 border-brand-500' : 'hover:bg-white/5'
                    }`}
                  >
                    <p className="leading-relaxed">
                      {p}
                    </p>
                    <button
                      onClick={() => handleToggleBookmarkLine(idx, p)}
                      className={`absolute right-2 top-2 p-1.5 rounded-lg transition ${bookmarkedLines.has(idx) ? 'opacity-100 text-amber-400 bg-amber-500/15' : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-amber-400 hover:bg-white/10'}`}
                      title={bookmarkedLines.has(idx) ? 'Bỏ đánh dấu đoạn này' : 'Đánh dấu đoạn này'}
                    >
                      <Bookmark className={`w-3.5 h-3.5 ${bookmarkedLines.has(idx) ? 'fill-amber-400 text-amber-400' : ''}`} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 5. Navigation Buttons Bottom */}
        <div className="mt-16 pt-8 border-t border-white/10 flex items-center justify-between gap-4">
          {chapterData.prev_chapter ? (
            <Link
              href={`/truyen/${storySlug}/${chapterData.prev_chapter.slug}`}
              className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold transition hover:scale-105"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Chương trước</span>
            </Link>
          ) : (
            <div />
          )}

          <button
            onClick={() => setIsChapterSelectorOpen(true)}
            className="px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold transition"
          >
            Mục lục chương
          </button>

          {chapterData.next_chapter ? (
            <Link
              href={`/truyen/${storySlug}/${chapterData.next_chapter.slug}`}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-brand-500/25 transition hover:scale-105"
            >
              <span>Chương tiếp</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          ) : (
            <div />
          )}
        </div>

        {/* 6. Chapter Comment Section */}
        <div className="mt-16">
          <CommentSection
            targetType="chapter"
            targetId={chapterData.id}
            title="Bình Luận Về Chương Này"
          />
        </div>

      </main>

      {/* 7. Floating Dynamic Taskbar */}
      <FloatingReaderBar
        storySlug={storySlug}
        chapterNumber={chapterData.chapter_number}
        chapterTitle={chapterData.title}
        totalChapters={chapterData.all_chapters?.length || 0}
        prevChapter={chapterData.prev_chapter}
        nextChapter={chapterData.next_chapter}
        onOpenChapterList={() => setIsChapterSelectorOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Modals */}
      <ReaderSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSettingsChange={setSettings}
      />

      <ChapterSelectorModal
        isOpen={isChapterSelectorOpen}
        onClose={() => setIsChapterSelectorOpen(false)}
        storySlug={storySlug}
        currentChapterSlug={chapterSlug}
        chapters={chapterData.all_chapters || []}
      />

    
      {/* Floating Instant Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-zinc-900/95 border border-white/20 text-white shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{toastMsg}</span>
        </div>
      )}

    </div>
  );
}
