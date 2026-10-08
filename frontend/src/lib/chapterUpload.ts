/** Novel chapters are written in /dang-chuong, manga chapters are uploaded page by page in /dang-truyen-tranh. */
export type UploadMode = 'novel' | 'manga';

export const CHOSEN_PARAM = 'chon';

export const uploadModeOf = (storyType?: string | null): UploadMode => (storyType === 'manga' ? 'manga' : 'novel');

/** Where to add a chapter: the uploader that matches the story type, with the story / group preselected. */
export function chapterUploadHref(
  opts: { storyType?: string | null; storyId?: string | null; groupId?: string | null; chosen?: boolean } = {},
) {
  const base = uploadModeOf(opts.storyType) === 'manga' ? '/dang-truyen-tranh' : '/dang-chuong';
  const q = new URLSearchParams();
  if (opts.storyId) q.set('story_id', opts.storyId);
  if (opts.groupId) q.set('group_id', opts.groupId);
  // the user picked this uploader on purpose: do not bounce them to the other one
  if (opts.chosen) q.set(CHOSEN_PARAM, '1');
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}
