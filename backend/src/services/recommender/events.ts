import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../../config/db';

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
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'true',
      maxAge: 365 * 86_400_000,
      path: '/',
    });
  }
  (req as any).visitorId = vid;
  next();
}

export const visitorIdOf = (req: Request): string | null => (req as any).visitorId || null;

export type RecEventKind = 'view' | 'read' | 'impression' | 'click';

/** Fire-and-forget: a lost event must never break the page that produced it. */
export function logRecEvent(e: {
  userId?: string | null; visitorId?: string | null; storyId: string; chapterId?: string | null;
  kind: RecEventKind; source?: string | null;
}) {
  if (!e.userId && !e.visitorId) return;
  pool.query(
    `INSERT INTO rec_events (user_id, visitor_id, story_id, chapter_id, kind, source) VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.userId || null, e.userId ? null : e.visitorId, e.storyId, e.chapterId || null, e.kind, e.source || null],
  ).catch((err) => console.error('[rec_events] insert failed:', err.message));
}
