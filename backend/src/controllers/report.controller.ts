import { Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

const TARGET_TABLES: Record<string, string> = {
  story: 'stories',
  chapter: 'chapters',
  comment: 'comments',
  post: 'posts',
};
const REASONS = ['spam', 'inappropriate', 'copyright', 'wrong_info', 'harassment', 'other'];
const isModerator = (roles: string[] = []) => roles.includes('admin') || roles.includes('mod');

/**
 * File a violation report against a story, chapter, comment or post.
 */
export const createReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để báo cáo.' });
    }
    const { target_type, target_id, reason, description } = req.body;

    const table = TARGET_TABLES[target_type as string];
    if (!table) {
      return res.status(400).json({ success: false, message: 'target_type phải là story, chapter, comment hoặc post.' });
    }
    if (!REASONS.includes(reason)) {
      return res.status(400).json({ success: false, message: `Lý do không hợp lệ. Chọn một trong: ${REASONS.join(', ')}.` });
    }
    if (typeof target_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(target_id)) {
      return res.status(400).json({ success: false, message: 'target_id không hợp lệ.' });
    }
    const exists = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [target_id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Nội dung bị báo cáo không tồn tại.' });
    }

    const dup = await pool.query(
      `SELECT 1 FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3 AND status = 'pending'`,
      [req.user.id, target_type, target_id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Bạn đã báo cáo nội dung này và đang chờ xử lý.' });
    }

    const ins = await pool.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, status, created_at`,
      [req.user.id, target_type, target_id, reason, typeof description === 'string' ? description.trim().slice(0, 1000) || null : null]
    );
    res.status(201).json({ success: true, message: 'Đã gửi báo cáo. Cảm ơn bạn, ban quản trị sẽ xem xét.', data: ins.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * List reports for moderators, with a short preview of the reported content.
 */
export const getReports = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !isModerator(req.user.roles)) {
      return res.status(403).json({ success: false, message: 'Chỉ Admin/Mod mới xem được báo cáo.' });
    }
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const pageNum = Math.max(1, parseInt(req.query.page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));

    const where = status === 'all' ? '' : 'WHERE r.status = $1';
    const params: any[] = status === 'all' ? [] : [status];

    const total = await pool.query(`SELECT count(*) FROM reports r ${where}`, params);
    const rows = await pool.query(`
      SELECT r.id, r.target_type, r.target_id, r.reason, r.description, r.status,
             r.resolution_note, r.resolved_at, r.created_at,
             u.username AS reporter_username, u.display_name AS reporter_name,
             CASE r.target_type
               WHEN 'story'   THEN (SELECT s.title FROM stories s WHERE s.id = r.target_id)
               WHEN 'chapter' THEN (SELECT c.title FROM chapters c WHERE c.id = r.target_id)
               WHEN 'comment' THEN (SELECT left(c.content, 160) FROM comments c WHERE c.id = r.target_id)
               WHEN 'post'    THEN (SELECT p.title FROM posts p WHERE p.id = r.target_id)
             END AS target_preview,
             CASE r.target_type
               WHEN 'story'   THEN (SELECT s.slug FROM stories s WHERE s.id = r.target_id)
               WHEN 'chapter' THEN (SELECT s.slug || '/' || c.slug FROM chapters c JOIN stories s ON s.id = c.story_id WHERE c.id = r.target_id)
               WHEN 'post'    THEN (SELECT p.slug FROM posts p WHERE p.id = r.target_id)
             END AS target_path
      FROM reports r
      JOIN users u ON u.id = r.reporter_id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limitNum, (pageNum - 1) * limitNum]);

    res.json({
      success: true,
      data: rows.rows,
      pagination: { page: pageNum, limit: limitNum, total: parseInt(total.rows[0].count) },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Close a report as resolved (action taken) or dismissed (no violation).
 */
export const resolveReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !isModerator(req.user.roles)) {
      return res.status(403).json({ success: false, message: 'Chỉ Admin/Mod mới xử lý được báo cáo.' });
    }
    const { id } = req.params;
    const { status, resolution_note } = req.body;
    if (!['resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status phải là resolved hoặc dismissed.' });
    }
    const upd = await pool.query(`
      UPDATE reports SET status = $1, resolution_note = $2, resolved_by = $3, resolved_at = NOW()
      WHERE id = $4 RETURNING id, status, resolved_at;
    `, [status, typeof resolution_note === 'string' ? resolution_note.trim().slice(0, 1000) || null : null, req.user.id, id]);
    if (upd.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Báo cáo không tồn tại.' });
    }
    res.json({ success: true, message: 'Đã cập nhật báo cáo.', data: upd.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
