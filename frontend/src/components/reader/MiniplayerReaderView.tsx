'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import { useAuth } from '@/context/AuthContext';
import { useReadingSession, ReadingSession } from '@/context/ReadingSessionContext';
import { logChapterRead } from '@/lib/readingHistory';
import { normalizeChapterContent } from '@/lib/chapterContent';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

/**
 * Tier 3 of the miniplayer: an actual read-only chapter reader packed into the
 * widget once it's dragged tall enough. Title bar (with prev/next/expand/close)
 * stays fixed on top, content scrolls underneath. No bookmarking, no comments -
 * those stay exclusive to the full page.
 */
export default function MiniplayerReaderView({ session }: { session: ReadingSession }) {
  const router = useRouter();
  const { isAuthenticated, authFetch } = useAuth();
  const { setSession, updateScrollPercent, dismiss } = useReadingSession();
  const [isNavigating, setIsNavigating] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const chapterHref = `/truyen/${session.storySlug}/${session.chapterSlug}`;
  const normalized = normalizeChapterContent({
    story: { story_type: session.storyType },
    content: session.content,
    content_blocks: session.contentBlocks,
    pages: session.pages,
  });
  const hasContent = normalized.isManga ? normalized.mangaPages.length > 0 : normalized.textItems.length > 0;

  // Reset scroll position to the top whenever a different chapter is shown
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [session.chapterId]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const total = el.scrollHeight - el.clientHeight;
    const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((el.scrollTop / total) * 100))) : 0;
    updateScrollPercent(session.chapterId, percent);
  }, [session.chapterId, updateScrollPercent]);

  const goToChapter = useCallback(
    async (slug?: string | null) => {
      if (!slug || isNavigating) return;
      setIsNavigating(true);
      try {
        const res = await authFetch(`${API_BASE_URL}/stories/${session.storySlug}/chapters/${slug}`, {
          credentials: 'include',
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || 'Không tải được chương');
        const chapter = json.data;

        logChapterRead({
          storyId: session.storyId,
          storySlug: session.storySlug,
          storyTitle: chapter.story?.title || session.storyTitle,
          storyCover: chapter.story?.cover_image_url || session.storyCover,
          storyAuthor: chapter.story?.author_name,
          storyType: chapter.story?.story_type || session.storyType,
          groupName: chapter.story?.group_name,
          chapterId: chapter.id,
          chapterSlug: chapter.slug || slug,
          chapterTitle: chapter.title,
          chapterNumber: chapter.chapter_number,
          isAuthenticated,
          authFetch,
          apiBaseUrl: API_BASE_URL,
        });

        setSession({
          storyId: session.storyId,
          storySlug: session.storySlug,
          storyTitle: chapter.story?.title || session.storyTitle,
          storyCover: chapter.story?.cover_image_url || session.storyCover,
          storyType: chapter.story?.story_type || session.storyType,
          chapterId: chapter.id,
          chapterSlug: chapter.slug || slug,
          chapterTitle: chapter.title,
          chapterNumber: chapter.chapter_number,
          prevChapterSlug: chapter.prev_chapter?.slug ?? null,
          nextChapterSlug: chapter.next_chapter?.slug ?? null,
          content: chapter.content,
          contentBlocks: chapter.content_blocks,
          pages: chapter.pages,
        });
      } catch (err) {
        console.error('Miniplayer: failed to load chapter', err);
      } finally {
        setIsNavigating(false);
      }
    },
    [authFetch, isAuthenticated, isNavigating, session, setSession]
  );

  return (
    <div className="flex flex-col w-full h-full">
      {/* Title bar */}
      <div className="shrink-0 flex items-center gap-1.5 pl-7 pr-2 py-2 border-b border-white/10 bg-black/20">
        <div
          className="min-w-0 flex-1 cursor-pointer"
          onClick={() => router.push(chapterHref)}
          title="Mở trang đầy đủ"
        >
          <p className="text-[11px] font-bold text-white truncate">{session.storyTitle}</p>
          <p className="text-[10px] text-gray-400 truncate">
            Chương {session.chapterNumber}: {session.chapterTitle}
          </p>
        </div>
        <button
          onClick={() => goToChapter(session.prevChapterSlug)}
          disabled={!session.prevChapterSlug || isNavigating}
          className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent transition shrink-0"
          title="Chương trước"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => goToChapter(session.nextChapterSlug)}
          disabled={!session.nextChapterSlug || isNavigating}
          className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent transition shrink-0"
          title="Chương tiếp"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => router.push(chapterHref)}
          className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition shrink-0"
          title="Mở trang đầy đủ"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={dismiss}
          className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition shrink-0"
          title="Đóng"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {isNavigating ? (
          <div className="text-xs text-gray-400 text-center py-8">Đang tải chương...</div>
        ) : !hasContent ? (
          <div className="text-xs text-gray-400 text-center py-8">
            Nội dung chương này đang được dịch hoặc cập nhật.
          </div>
        ) : normalized.isManga ? (
          <div className="space-y-2 flex flex-col items-center">
            {normalized.mangaPages.map((page) => (
              <SmartImage
                key={page.pageNumber}
                src={page.imageUrl}
                adaptive
                alt={`Trang ${page.pageNumber}`}
                className="w-full h-auto rounded-lg"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3 text-[13px] leading-relaxed text-gray-200">
            {normalized.textItems.map((item) =>
              item.kind === 'image' ? (
                <SmartImage
                  key={item.id}
                  src={item.imageUrl}
                  adaptive
                  alt={session.chapterTitle}
                  className="w-full h-auto rounded-lg"
                />
              ) : (
                <div key={item.id} className="space-y-2">
                  {item.text && <p>{item.text}</p>}
                  {item.note && (
                    <div className="p-2 rounded-lg bg-amber-500/10 border-l-2 border-amber-500 text-[11px] text-amber-200 italic">
                      {item.note}
                    </div>
                  )}
                  {item.inlineImageUrl && (
                    <SmartImage
                      src={item.inlineImageUrl}
                      adaptive
                      alt={session.chapterTitle}
                      className="w-full h-auto rounded-lg"
                    />
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
