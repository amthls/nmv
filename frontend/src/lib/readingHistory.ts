import { LIBRARY_URL } from './apiJson';

/**
 * Records that a visitor just opened a chapter. Signed in: nothing to do here, the backend records it when serving
 * the chapter. Signed out: guest history in localStorage, sent to the account once after signing in
 * (mergeGuestHistory) and then cleared. Shared by the full chapter reader page and the miniplayer's own chapter
 * navigation, so both count as "read" the same way.
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
  }
}

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

/** Where the reader is in a chapter (scroll %), for "Đọc tiếp". keepalive: also sent when the page is being left. */
export function saveReadingPosition(chapterId: string, percent: number, isAuthenticated: boolean, authFetch: AuthFetch): void {
  if (!isAuthenticated) {
    const list = getGuestHistory();
    const item = list.find((h: any) => h.chapter_id === chapterId);
    if (item) {
      item.scroll_position = percent;
      setGuestHistory(list);
    }
    return;
  }
  authFetch(`${LIBRARY_URL}/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapter_id: chapterId, scroll_position: percent }),
    keepalive: true,
  }).catch(() => {}); // a lost position is not worth an error
}

/** "#vt=<%>" for a "Đọc tiếp" link: the reader page scrolls back there (nothing when near the top). */
export function positionHash(item: { scroll_position?: number | string | null }): string {
  const pct = Math.round(Number(item?.scroll_position) || 0);
  return pct > 1 ? `#vt=${Math.min(pct, 100)}` : '';
}

/** After signing in: this browser's guest history goes to the account (newer reads only), then it is cleared. */
export async function mergeGuestHistory(authFetch: AuthFetch): Promise<void> {
  const list = getGuestHistory();
  if (!list.length) return;
  const items = list.slice(0, 200).map((h: any) => ({ chapter_id: h.chapter_id, read_at: h.read_at, scroll_position: Number(h.scroll_position) || 0 }));
  try {
    const res = await authFetch(`${LIBRARY_URL}/history/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (res.ok) setGuestHistory([]);
  } catch {
    // kept for the next page load
  }
}
