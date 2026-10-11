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
  History,
  CheckCircle2,
  Download,
} from 'lucide-react';
import ReaderSettingsModal, {
  DEFAULT_READER_SETTINGS, ReaderSettings, READER_FONTS, loadReaderSettings, saveReaderSettings,
} from '@/components/reader/ReaderSettingsModal';
import ImageLightbox from '@/components/reader/ImageLightbox';
import RichContent from '@/components/common/RichContent';
import { enhanceChapterHtml, enhancePlainText, withFootnoteMarker } from '@/lib/chapterRender';

const PARAGRAPH_GAP = { compact: '0rem', normal: '0.75rem', airy: '1.75rem' } as const;
import ChapterSelectorModal from '@/components/reader/ChapterSelectorModal';
import DownloadModal from '@/components/story/DownloadModal';
import FloatingReaderBar from '@/components/reader/FloatingReaderBar';
import CommentSection from '@/components/comments/CommentSection';
import ReportButton from '@/components/common/ReportButton';
import SmartImage from '@/components/common/SmartImage';
import MangaReader from '@/components/reader/MangaReader';
import { rewriteHtmlImages, useImageQuality } from '@/lib/imageQuality';
import { useAuth } from '@/context/AuthContext';
import { useReadingSession } from '@/context/ReadingSessionContext';
import { logChapterRead, saveReadingPosition } from '@/lib/readingHistory';
import CodeBadge from '@/components/common/CodeBadge';
import { LIBRARY_URL } from '@/lib/apiJson';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function ChapterReaderPage() {
  const params = useParams();
  const router = useRouter();
  const { user, authFetch, isAuthenticated, openAuthModal } = useAuth();
  const { setSession: setReadingSession, updateScrollPercent } = useReadingSession();

  const storySlug = params?.slug as string;
  const chapterSlug = params?.chapterSlug as string;

  const [chapterData, setChapterData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [isChapterSelectorOpen, setIsChapterSelectorOpen] = useState(false);
  const [bookmarkedLines, setBookmarkedLines] = useState<Set<number>>(new Set());
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  // touch screens have no hover: the bookmark button shows on the paragraph last tapped
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [imageQuality] = useImageQuality();

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
        const res = await authFetch(`${LIBRARY_URL}/bookmarks?chapter_id=${chapId}`);
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

    let current = 0;
    let saved = -1;
    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      const percent = totalHeight > 0 ? Math.min(100, Math.max(0, Math.round((window.scrollY / totalHeight) * 100))) : 0;
      current = percent;
      updateScrollPercent(chapterId, percent);
    };
    // The reading position for "Đọc tiếp": every 15 s if it moved, and when the tab is hidden or the chapter left
    const save = () => {
      if (current === saved) return;
      saved = current;
      saveReadingPosition(chapterId, current, isAuthenticated, authFetch);
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') save(); };

    handleScroll();
    saved = current; // opening the chapter is recorded already
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('visibilitychange', onHidden);
    const timer = setInterval(save, 15000);
    return () => {
      save();
      clearInterval(timer);
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [chapterData?.id, updateScrollPercent, isAuthenticated, authFetch]);

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

    const resume = window.location.hash.match(/^#vt=(\d{1,3})$/);
    if (targetIndex === null && resume) {
      // "Đọc tiếp": back to the saved scroll %, once the page height stops changing (content still laying out), max ~5 s.
      // shortcut: manga pages loading later can still move it; anchor to a page/paragraph if readers notice.
      let lastHeight = -1;
      let tries = 0;
      const timer = setInterval(() => {
        const height = document.documentElement.scrollHeight;
        if ((height === lastHeight && height > window.innerHeight) || ++tries > 25) {
          clearInterval(timer);
          window.scrollTo({ top: (Math.min(100, Number(resume[1])) / 100) * (height - window.innerHeight), behavior: 'instant' });
        }
        lastHeight = height;
      }, 200);
      return () => clearInterval(timer);
    }

    if (targetIndex !== null) {
      setHighlightedLine(targetIndex);
      // a soft glow to find the place again, then it gets out of the way
      setTimeout(() => setHighlightedLine((cur) => (cur === targetIndex ? null : cur)), 2600);
      const timer = setTimeout(() => {
        const el = document.getElementById(`line-${targetIndex}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [chapterData, isLoading]);

  /**
   * Bookmarks must not pull the eye while reading: a bookmarked paragraph only gets a thin amber
   * line in the left gutter, and the jump-to-bookmark glow is faint and fades out.
   */
  const lineMarkClass = (idx: number) => [
    "before:content-[''] before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-[2px] before:rounded-full before:transition-colors before:duration-500",
    bookmarkedLines.has(idx) ? 'before:bg-amber-400/45' : 'before:bg-transparent',
    highlightedLine === idx ? 'bg-amber-400/10' : '',
  ].join(' ');

  /** Hidden until hover (or tap on touch screens); a saved one stays as a faint ribbon. */
  const bookmarkButtonClass = (idx: number) => {
    const saved = bookmarkedLines.has(idx);
    const shown = activeLine === idx;
    return `absolute right-1 top-1.5 p-1.5 rounded-md transition-opacity duration-200 select-none z-20 active:scale-90 focus-visible:opacity-100 ${
      saved
        ? `text-amber-400/70 hover:text-amber-400 ${shown ? 'opacity-100' : 'opacity-30 group-hover:opacity-90'}`
        : `text-gray-400 hover:text-amber-400 ${shown ? 'opacity-70' : 'opacity-0 group-hover:opacity-60'}`
    }`;
  };

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
      const res = await authFetch(`${LIBRARY_URL}/bookmarks`, {
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

  // Reader Settings State (remembered in this browser)
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
  useEffect(() => setSettings(loadReaderSettings()), []);
  const updateSettings = (next: ReaderSettings) => {
    setSettings(next);
    saveReaderSettings(next);
  };

  // Numbered translator notes: the number opens the note under its paragraph
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set());
  const toggleNote = (n: number) =>
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  // Illustration viewer
  const readerTextRef = React.useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<{ images: { src: string; alt?: string }[]; index: number } | null>(null);
  const handleReaderClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const fn = target.closest('[data-fn]');
    if (fn) {
      e.preventDefault();
      toggleNote(Number(fn.getAttribute('data-fn')));
      return;
    }
    const figure = target.closest('figure.image, .nh-illus');
    const img = figure?.querySelector('img');
    if (!img || !readerTextRef.current) return;
    const all = Array.from(readerTextRef.current.querySelectorAll<HTMLImageElement>('figure.image img, .nh-illus img'));
    // full-size file, not the resolution picked for the page
    const full = (el: HTMLImageElement) => (el.getAttribute('src') || '').replace(/\?w=\d+$/, '');
    setLightbox({ images: all.map((el) => ({ src: full(el), alt: el.getAttribute('alt') || undefined })), index: Math.max(0, all.indexOf(img)) });
  };

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
    user && chapterData && (
      user.id === chapterData.uploader_id ||
      user.id === chapterData.story?.uploader_id
    )
  );

  const handleDeleteCurrentChapter = async () => {
    if (!chapterData) return;
    if (!confirm(`Xóa chương "${chapterData.title}"? Độc giả sẽ không thấy chương này nữa; người giữ truyện khôi phục được trong lịch sử chương.`)) return;

    try {
      const res = await authFetch(`${API_BASE_URL}/chapters/${chapterData.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        // The history page of a deleted chapter is where it can be brought back
        router.push(`/truyen/${storySlug}/lich-su/${chapterData.id}?deleted=1`);
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
    if (e.defaultPrevented) return; // the manga reader turned a page instead

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
          className="px-4 py-2 rounded-xl bg-brand-600 text-snow text-xs font-semibold"
        >
          Quay lại trang truyện
        </Link>
      </div>
    );
  }

  // Theme styling classes
  const themeClasses = {
    dark: 'dark bg-surface text-[#e2e8f0]',
    amoled: 'dark bg-[#000000] text-[#cccccc]',
    sepia: 'light bg-[#F4ECD8] text-[#5B4636]',
    light: 'light bg-[#FFFFFF] text-[#1a202c]',
  }[settings.theme];

  const headerBgClass = {
    dark: 'bg-glass border-white/10 text-white',
    amoled: 'bg-black/90 border-white/20 text-white',
    sepia: 'bg-[#e8dec5]/90 border-[#d4c5a9] text-[#5B4636]',
    light: 'bg-glass border-white/10 text-white',
  }[settings.theme];

  const fontStack = (READER_FONTS[settings.fontFamily] || READER_FONTS.Literata).stack;

  const hasBlocks = Array.isArray(chapterData.content_blocks) && chapterData.content_blocks.length > 0;
  // translator notes numbered in reading order
  const footnoteNumbers: Record<number, number> = {};
  const footnoteList: { n: number; idx: number; note: string }[] = [];
  if (hasBlocks) {
    chapterData.content_blocks.forEach((b: any, idx: number) => {
      if (b.note) {
        footnoteNumbers[idx] = footnoteList.length + 1;
        footnoteList.push({ n: footnoteList.length + 1, idx, note: b.note });
      }
    });
  }

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
              className="p-1.5 rounded-lg hover:bg-white/10 transition"
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
              className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
              title="Chương trước (Phím A / Mũi tên trái)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Chapter Selector Trigger */}
            <button
              onClick={() => setIsChapterSelectorOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold transition"
              title="Mục lục chương"
            >
              <List className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Chương {chapterData.chapter_number}</span>
            </button>

            {/* Next Chapter */}
            <button
              onClick={() => chapterData.next_chapter && router.push(`/truyen/${storySlug}/${chapterData.next_chapter.slug}`)}
              disabled={!chapterData.next_chapter}
              className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
              title="Chương sau (Phím D / Mũi tên phải)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Reader Settings Trigger */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow shadow-sm transition ml-1"
              title="Tùy chỉnh font chữ, cỡ chữ, màu nền"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Download this chapter (EPUB/PDF) when the story's team allows it */}
            {chapterData.story?.allow_download && (
              <button
                onClick={() => setIsDownloadOpen(true)}
                className="p-2 rounded-lg hover:bg-white/10 transition ml-1"
                title="Tải chương này (EPUB / PDF)"
              >
                <Download className="w-4 h-4" />
              </button>
            )}

            {/* Report violation (icon only in the header) */}
            {chapterData?.id && (
              <ReportButton
                targetType="chapter"
                targetId={chapterData.id}
                className="p-2 rounded-lg hover:bg-white/10 transition ml-1 flex items-center [&>span]:hidden"
              />
            )}

            {/* Edit / delete chapter: owner only */}
            {canManage && (
              <Link
                href={`/dang-chuong?edit=${chapterData.id}`}
                className="p-2 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-500/30 transition ml-1"
                title="Sửa chương này"
              >
                <Pencil className="w-4 h-4" />
              </Link>
            )}
            {canManage && (
              <Link
                href={`/truyen/${storySlug}/lich-su/${chapterData.id}`}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 transition ml-1"
                title="Lịch sử phiên bản"
              >
                <History className="w-4 h-4" />
              </Link>
            )}
            {canManage && (
              <button
                onClick={handleDeleteCurrentChapter}
                className="p-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 transition ml-1"
                title="Xóa chương này"
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
        // manga pages size themselves (column width / wide strip); text keeps the reader's line width
        style={{ maxWidth: isManga ? 'none' : settings.maxWidth }}
      >
        {/* Chapter Title & Publisher Meta Header */}
        <div className={`text-center pb-8 border-b border-white/10 space-y-3 mb-8 ${isManga ? 'max-w-4xl mx-auto' : ''}`}>
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
            <CodeBadge code={chapterData.code} />
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
          <div className="-mx-4 sm:-mx-6">
            <MangaReader
              pages={chapterData.pages}
              nextHref={chapterData.next_chapter ? `/truyen/${storySlug}/${chapterData.next_chapter.slug}` : null}
              prevHref={chapterData.prev_chapter ? `/truyen/${storySlug}/${chapterData.prev_chapter.slug}` : null}
            />
          </div>
        ) : (
          /* 4. NOVEL DISPLAY: formatted blocks, numbered translator notes, translator messages, illustrations */
          <div
            ref={readerTextRef}
            onClick={handleReaderClick}
            className={`reader-text flex flex-col ${settings.indent ? 'nh-indent' : ''} ${settings.showImages ? '' : 'nh-hide-images'}`}
            style={{
              fontFamily: fontStack,
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              textAlign: settings.textAlign as any,
              rowGap: PARAGRAPH_GAP[settings.paragraphSpacing] || PARAGRAPH_GAP.normal,
            }}
          >
            {chapterData.intro_note && (
              <aside className="nh-message mb-4">
                <div className="nh-message__label"><MessageSquare className="w-3.5 h-3.5" /> Lời người dịch</div>
                <RichContent content={chapterData.intro_note} />
              </aside>
            )}

            {hasBlocks ? (
              // RENDER SMART CONTENT BLOCKS
              chapterData.content_blocks.map((block: any, idx: number) => {
                const noteNo = footnoteNumbers[idx];
                const body = block.html
                  ? enhanceChapterHtml(rewriteHtmlImages(block.html, imageQuality))
                  : block.text ? `<p>${enhancePlainText(block.text)}</p>` : '';
                return (
                <div
                  key={block.id || idx}
                  id={`line-${idx}`}
                  onClick={() => setActiveLine(idx)}
                  className={`group relative rounded-lg py-2 pl-3 pr-9 transition-colors duration-700 space-y-3 ${lineMarkClass(idx)}`}
                >
                  {/* Formatted block from the chapter editor (sanitized by the API), else plain paragraph text */}
                  {body && (
                    <div className="chapter-rich" dangerouslySetInnerHTML={{ __html: noteNo ? withFootnoteMarker(body, noteNo) : body }} />
                  )}
                  {!body && noteNo && (
                    <sup className="nh-fn"><a href={`#fn-${noteNo}`} data-fn={noteNo}>[{noteNo}]</a></sup>
                  )}

                  {/* Translator note: its number [n] opens it here */}
                  {noteNo && openNotes.has(noteNo) && (
                    <div className="nh-note">
                      <div className="nh-note__head">
                        <span>Chú thích [{noteNo}]</span>
                        <button type="button" onClick={() => toggleNote(noteNo)} className="opacity-70 hover:opacity-100">Đóng</button>
                      </div>
                      <div className="whitespace-pre-line">{block.note}</div>
                    </div>
                  )}

                  {/* Illustration hung on a paragraph (older chapters) */}
                  {!block.html && block.image_url && block.image_url !== 'placeholder' && (
                    <figure className="nh-illus">
                      <SmartImage src={block.image_url} adaptive alt={`Minh họa đoạn ${idx + 1}`} />
                    </figure>
                  )}

                  {/* Bookmark line action button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleToggleBookmarkLine(idx, block.text || '');
                    }}
                    className={bookmarkButtonClass(idx)}
                    title={bookmarkedLines.has(idx) ? 'Bỏ đánh dấu đoạn này' : 'Đánh dấu đoạn đang đọc'}
                    aria-label={bookmarkedLines.has(idx) ? 'Bỏ đánh dấu đoạn này' : 'Đánh dấu đoạn này'}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${bookmarkedLines.has(idx) ? 'fill-current' : ''}`} />
                  </button>
                </div>
                );
              })
            ) : (
              // RENDER REGULAR PARAGRAPHS
              paragraphs.map((p: string, idx: number) => {
                if (isMarkdownImage(p)) {
                  const imgUrl = getImageUrl(p);
                  return (
                    <figure key={idx} className="nh-illus">
                      <SmartImage src={imgUrl} adaptive alt={`Minh họa ${chapterData.title}`} />
                    </figure>
                  );
                }

                return (
                  <div
                    key={idx}
                    id={`line-${idx}`}
                    onClick={() => setActiveLine(idx)}
                    className={`group relative rounded-lg py-2 pl-3 pr-9 transition-colors duration-700 ${lineMarkClass(idx)}`}
                  >
                    <div className="chapter-rich" dangerouslySetInnerHTML={{ __html: `<p>${enhancePlainText(p)}</p>` }} />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleBookmarkLine(idx, p); }}
                      className={bookmarkButtonClass(idx)}
                      title={bookmarkedLines.has(idx) ? 'Bỏ đánh dấu đoạn này' : 'Đánh dấu đoạn này'}
                      aria-label={bookmarkedLines.has(idx) ? 'Bỏ đánh dấu đoạn này' : 'Đánh dấu đoạn này'}
                    >
                      <Bookmark className={`w-3.5 h-3.5 ${bookmarkedLines.has(idx) ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                );
              })
            )}

            {chapterData.outro_note && (
              <aside className="nh-message mt-6">
                <div className="nh-message__label"><MessageSquare className="w-3.5 h-3.5" /> Lời người dịch</div>
                <RichContent content={chapterData.outro_note} />
              </aside>
            )}

            {/* All notes at the end, like a book's notes page */}
            {footnoteList.length > 0 && (
              <section className="nh-footnotes mt-6" aria-label="Ghi chú">
                <h2>Ghi chú</h2>
                <ol>
                  {footnoteList.map(({ n, idx, note }) => (
                    <li key={n} id={`fn-${n}`}>
                      <span className="whitespace-pre-line">{note}</span>{' '}
                      <button
                        type="button"
                        onClick={() => document.getElementById(`line-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                        className="nh-footnotes__back"
                        title="Về đoạn có chú thích"
                      >
                        ↩
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}

        {/* 5. Navigation Buttons Bottom */}
        <div className={`mt-16 pt-8 border-t border-white/10 flex items-center justify-between gap-4 ${isManga ? 'max-w-4xl mx-auto' : ''}`}>
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
              className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-snow text-xs font-bold shadow-lg shadow-brand-500/25 transition hover:scale-105"
            >
              <span>Chương tiếp</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          ) : (
            <div />
          )}
        </div>

        {/* 6. Chapter Comment Section */}
        <div className={`mt-16 ${isManga ? 'max-w-4xl mx-auto' : ''}`}>
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
        onSettingsChange={updateSettings}
      />
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(index) => setLightbox((lb) => (lb ? { ...lb, index } : lb))}
          onClose={() => setLightbox(null)}
        />
      )}

      {chapterData.story?.allow_download && (
        <DownloadModal
          isOpen={isDownloadOpen}
          onClose={() => setIsDownloadOpen(false)}
          storySlug={storySlug}
          initialChapterIds={[chapterData.id]}
        />
      )}

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
