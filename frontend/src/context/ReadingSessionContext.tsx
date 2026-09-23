'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

export interface ReadingSession {
  storyId: string;
  storySlug: string;
  storyTitle: string;
  storyCover?: string;
  storyType?: 'novel' | 'manga';
  chapterId: string;
  chapterSlug: string;
  chapterTitle: string;
  chapterNumber: number | string;
  prevChapterSlug?: string | null;
  nextChapterSlug?: string | null;
  scrollPercent: number;
  /** Chapter body, mirrored from the full page's already-fetched API response so the
   *  miniplayer's reading tier needs no extra request (and no duplicate view-count/history). */
  content?: string;
  contentBlocks?: any[];
  pages?: { page_number: number; image_url: string; width?: number; height?: number }[];
}

interface ReadingSessionContextType {
  session: ReadingSession | null;
  /** true once the user has closed the miniplayer for the session's current chapter */
  isDismissed: boolean;
  setSession: (data: Omit<ReadingSession, 'scrollPercent'>) => void;
  updateScrollPercent: (chapterId: string, percent: number) => void;
  dismiss: () => void;
}

const ReadingSessionContext = createContext<ReadingSessionContextType | undefined>(undefined);

export const ReadingSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSessionState] = useState<ReadingSession | null>(null);
  const [dismissedChapterId, setDismissedChapterId] = useState<string | null>(null);

  const setSession = useCallback((data: Omit<ReadingSession, 'scrollPercent'>) => {
    setSessionState((prev) => ({
      ...data,
      // Re-opening the same chapter (e.g. a fast refresh) keeps its known progress instead of resetting to 0
      scrollPercent: prev?.chapterId === data.chapterId ? prev.scrollPercent : 0,
    }));
    // A genuinely new chapter clears any earlier dismissal; re-opening the dismissed one keeps it dismissed.
    setDismissedChapterId((prev) => (prev === data.chapterId ? prev : null));
  }, []);

  const updateScrollPercent = useCallback((chapterId: string, percent: number) => {
    setSessionState((prev) => {
      if (!prev || prev.chapterId !== chapterId) return prev;
      return { ...prev, scrollPercent: percent };
    });
  }, []);

  const dismiss = useCallback(() => {
    setSessionState((prev) => {
      if (prev) setDismissedChapterId(prev.chapterId);
      return prev;
    });
  }, []);

  const isDismissed = !!session && session.chapterId === dismissedChapterId;

  return (
    <ReadingSessionContext.Provider value={{ session, isDismissed, setSession, updateScrollPercent, dismiss }}>
      {children}
    </ReadingSessionContext.Provider>
  );
};

export const useReadingSession = () => {
  const ctx = useContext(ReadingSessionContext);
  if (!ctx) {
    throw new Error('useReadingSession must be used within a ReadingSessionProvider');
  }
  return ctx;
};
