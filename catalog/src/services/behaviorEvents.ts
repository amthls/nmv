import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { publishEvent } from './queue.service';

/**
 * Anonymous visitor id (cookie `nh_vid`), so guests get session-based recommendations and their
 * reading also teaches "people who read X also read Y". Holds no personal data.
 */
const COOKIE = 'nh_vid';
const VID_RE = /^[a-f0-9]{32}$/;

export function visitorCookie(req: Request, res: Response, next: NextFunction) {
  let vid = (req as any).cookies?.[COOKIE];
  if (typeof vid !== 'string' || !VID_RE.test(vid)) {
    vid = crypto.randomBytes(16).toString('hex');
    res.cookie(COOKIE, vid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || process.env.COOKIE_SECURE === 'true',
      maxAge: 365 * 86_400_000,
      path: '/',
    });
  }
  (req as any).visitorId = vid;
  next();
}

export const visitorIdOf = (req: Request): string | null => (req as any).visitorId || null;

/**
 * A story page or chapter was opened: catalog.story.viewed / catalog.chapter.read for the recommender
 * (schemas in events/). Fire-and-forget, never breaks the page.
 */
export function publishBehavior(e: { userId?: string | null; visitorId?: string | null; storyId: string; chapterId?: string }) {
  if (!e.userId && !e.visitorId) return;
  publishEvent(e.chapterId ? 'catalog.chapter.read' : 'catalog.story.viewed', {
    ...(e.userId ? { user_id: e.userId } : { visitor_id: e.visitorId }),
    story_id: e.storyId,
    ...(e.chapterId ? { chapter_id: e.chapterId } : {}),
    at: new Date().toISOString(),
  });
}
