import { Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

const isModerator = (roles: string[] = []) => roles.includes('admin') || roles.includes('mod');

/** Removed stories and posts share one row shape for the "Đã gỡ" page. $1 = search pattern or null. */
const REMOVED_STORIES = `
  SELECT 'story' AS type, s.id, s.code, s.title, s.slug, s.cover_image_url AS image,
         u.username AS author_username, u.display_name AS author_name,
         s.rejection_reason AS reason, s.removed_at,
         r.username AS removed_by_username, r.display_name AS removed_by_name
  FROM stories s
  JOIN users u ON u.id = s.uploader_id
  LEFT JOIN users r ON r.id = s.removed_by
  WHERE s.approval_status = 'rejected'
    AND ($1::text IS NULL OR s.code ILIKE $1 OR s.title ILIKE $1 OR s.original_title ILIKE $1
         OR s.author_name ILIKE $1 OR s.synopsis ILIKE $1 OR u.username ILIKE $1)`;

const REMOVED_POSTS = `
  SELECT 'post' AS type, p.id, p.code, p.title, p.slug, p.cover_image_url AS image,
         u.username AS author_username, u.display_name AS author_name,
         p.rejection_reason AS reason, p.removed_at,
         r.username AS removed_by_username, r.display_name AS removed_by_name
  FROM posts p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN users r ON r.id = p.removed_by
  WHERE p.approval_status = 'rejected' AND p.is_deleted = false
    AND ($1::text IS NULL OR p.code ILIKE $1 OR p.title ILIKE $1 OR p.content ILIKE $1 OR u.username ILIKE $1)`;

/**
 * GET /moderation/removed?type=all|story|post&q=&page= (Admin/Mod): content taken down by Admin/Mod,
 * newest first. `q` matches the code, the title, the text (synopsis / post body) or the author's username.
 */
export const getRemovedContent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !isModerator(req.user.roles)) {
      return res.status(403).json({ success: false, message: 'Chỉ Admin/Mod mới xem được nội dung đã gỡ.' });
    }
    const type = req.query.type === 'story' || req.query.type === 'post' ? req.query.type : 'all';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const pattern = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const pageNum = Math.max(1, parseInt(req.query.page as string) || 1);
    const limitNum = 30;

    const parts = type === 'story' ? [REMOVED_STORIES] : type === 'post' ? [REMOVED_POSTS] : [REMOVED_STORIES, REMOVED_POSTS];
    const union = parts.join(' UNION ALL ');
    const [total, rows] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n FROM (${union}) x`, [pattern]),
      pool.query(`SELECT * FROM (${union}) x ORDER BY removed_at DESC NULLS LAST LIMIT $2 OFFSET $3`,
        [pattern, limitNum, (pageNum - 1) * limitNum]),
    ]);

    res.json({ success: true, data: rows.rows, pagination: { page: pageNum, limit: limitNum, total: total.rows[0].n } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
