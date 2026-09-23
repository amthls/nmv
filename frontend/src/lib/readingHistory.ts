/**
 * Records that a user just opened a chapter: guest history in localStorage
 * (instant, works offline) plus a POST /history when authenticated. Shared
 * by the full chapter reader page and the miniplayer's own chapter
 * navigation, so both count as "read" the same way instead of duplicating
 * this logic.
 */

interface LogChapterReadParams {
  storyId: string;
  storySlug: string;
  storyTitle: string;
  storyCover?: string;
  storyAuthor?: string;
  storyType?: string;
  groupName?: string;
  chapterId: string;
  chapterSlug: string;
  chapterTitle: string;
  chapterNumber: number | string;
  isAuthenticated: boolean;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  apiBaseUrl: string;
}

export function logChapterRead(params: LogChapterReadParams): void {
  const {
    storyId,
    storySlug,
    storyTitle,
    storyCover,
    storyAuthor,
    storyType,
    groupName,
    chapterId,
    chapterSlug,
    chapterTitle,
    chapterNumber,
    isAuthenticated,
    authFetch,
    apiBaseUrl,
  } = params;

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('novelhub_guest_history') || '[]';
      let list: any[] = JSON.parse(raw);
      const newItem = {
        id: `hist-${Date.now()}`,
        story_id: storyId,
        story_title: storyTitle || 'Tiểu Thuyết',
        story_slug: storySlug,
        story_cover: storyCover || '',
        story_author: storyAuthor || 'Chưa rõ',
        story_type: storyType || 'novel',
        chapter_id: chapterId,
        chapter_title: chapterTitle,
        chapter_slug: chapterSlug,
        chapter_number: chapterNumber,
        read_at: new Date().toISOString(),
        group_name: groupName || '',
      };
      list = [newItem, ...list.filter((h: any) => h.story_id !== storyId)];
      localStorage.setItem('novelhub_guest_history', JSON.stringify(list));
    } catch (e) {
      // ignore
    }
  }

  if (isAuthenticated) {
    authFetch(`${apiBaseUrl}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        story_id: storyId,
        chapter_id: chapterId,
        scroll_position: 0,
        page_number: 1,
      }),
    }).catch((err: any) => console.error('Failed to log reading history:', err));
  }
}
