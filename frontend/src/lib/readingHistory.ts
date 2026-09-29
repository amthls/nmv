/**
 * Records that a user just opened a chapter: POST /history when authenticated,
 * otherwise guest history in localStorage. The two never mix, so a shared
 * browser doesn't leak one person's history into another account. Shared
 * by the full chapter reader page and the miniplayer's own chapter
 * navigation, so both count as "read" the same way instead of duplicating
 * this logic.
 */

const GUEST_HISTORY_KEY = 'novelhub_guest_history';
// Bumped when the old list (which also held signed-in users' reads) is discarded
const GUEST_HISTORY_VERSION_KEY = 'novelhub_guest_history_v';
const GUEST_HISTORY_VERSION = '2';

/** Reading history of a signed-out visitor on this browser (newest first). */
export function getGuestHistory(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    if (localStorage.getItem(GUEST_HISTORY_VERSION_KEY) !== GUEST_HISTORY_VERSION) {
      localStorage.removeItem(GUEST_HISTORY_KEY);
      localStorage.setItem(GUEST_HISTORY_VERSION_KEY, GUEST_HISTORY_VERSION);
    }
    const list = JSON.parse(localStorage.getItem(GUEST_HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

export function setGuestHistory(list: any[]): void {
  try {
    localStorage.setItem(GUEST_HISTORY_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore (private mode, quota)
  }
}

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

  if (!isAuthenticated) {
    if (typeof window === 'undefined') return;
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
    setGuestHistory([newItem, ...getGuestHistory().filter((h: any) => h.story_id !== storyId)]);
    return;
  }

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
