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
// Spam guard on top of the per-hour limiter in the routes and the one-pending-report unique index
const DAILY_REPORT_LIMIT = 30;
const REREPORT_COOLDOWN_HOURS = 24;

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

    const guard = await pool.query(`
      SELECT
        EXISTS (SELECT 1 FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3 AND status = 'pending') AS pending,
        EXISTS (SELECT 1 FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3
                AND status <> 'pending' AND resolved_at > NOW() - make_interval(hours => $4)) AS recently_handled,
        (SELECT count(*)::int FROM reports WHERE reporter_id = $1 AND created_at > NOW() - INTERVAL '24 hours') AS today
    `, [req.user.id, target_type, target_id, REREPORT_COOLDOWN_HOURS]);
    const g = guard.rows[0];
    if (g.pending) {
      return res.status(409).json({ success: false, message: 'Bạn đã báo cáo nội dung này và đang chờ xử lý.' });
    }
    if (g.recently_handled) {
      return res.status(429).json({ success: false, message: `Báo cáo trước của bạn về nội dung này vừa được xử lý. Vui lòng chờ ${REREPORT_COOLDOWN_HOURS} giờ trước khi báo cáo lại.` });
    }
    if (g.today >= DAILY_REPORT_LIMIT) {
      return res.status(429).json({ success: false, message: `Mỗi ngày chỉ gửi được tối đa ${DAILY_REPORT_LIMIT} báo cáo. Vui lòng thử lại sau.` });
    }

    let ins;
    try {
      ins = await pool.query(
        `INSERT INTO reports (reporter_id, target_type, target_id, reason, description)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, status, created_at`,
        [req.user.id, target_type, target_id, reason, typeof description === 'string' ? description.trim().slice(0, 1000) || null : null]
      );
    } catch (err: any) {
      // uq_reports_pending: a second click that raced past the check above
      if (err.code === '23505') return res.status(409).json({ success: false, message: 'Bạn đã báo cáo nội dung này và đang chờ xử lý.' });
      throw err;
    }
    res.status(201).json({ success: true, message: 'Đã gửi báo cáo. Cảm ơn bạn, ban quản trị sẽ xem xét.', data: ins.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * List reports for moderators: `status` (pending|resolved|dismissed|all), `type` (story|chapter|comment|post),
 * `q` (report code, the reported item's code or title, the reporter's description). Each row carries a preview,
 * the reported item's code and link, whether it was taken down, and how many reports on it are still pending.
 */
export const getReports = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !isModerator(req.user.roles)) {
      return res.status(403).json({ success: false, message: 'Chỉ Admin/Mod mới xem được báo cáo.' });
    }
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const type = typeof req.query.type === 'string' && TARGET_TABLES[req.query.type] ? req.query.type : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const pageNum = Math.max(1, parseInt(req.query.page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));

    const params: any[] = [];
    const where: string[] = [];
    if (status !== 'all') { params.push(status); where.push(`r.status = $${params.length}`); }
    if (type) { params.push(type); where.push(`r.target_type = $${params.length}`); }
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      const n = params.length;
      where.push(`(r.code ILIKE $${n} OR r.description ILIKE $${n} OR t.code ILIKE $${n} OR t.preview ILIKE $${n})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // One row per report with the reported item resolved by type
    const fromSql = `
      FROM reports r
      JOIN users u ON u.id = r.reporter_id
      LEFT JOIN LATERAL (
        SELECT s.title AS preview, s.code, s.slug AS path, s.approval_status = 'rejected' AS removed
          FROM stories s WHERE r.target_type = 'story' AND s.id = r.target_id
        UNION ALL
        SELECT s.title || ' · ' || c.title, s.code || '-C' || trim_scale(c.chapter_number)::text,
               s.slug || '/' || c.slug, s.approval_status = 'rejected'
          FROM chapters c JOIN stories s ON s.id = c.story_id WHERE r.target_type = 'chapter' AND c.id = r.target_id
        UNION ALL
        SELECT p.title, p.code, p.slug, p.approval_status = 'rejected'
          FROM posts p WHERE r.target_type = 'post' AND p.id = r.target_id
        UNION ALL
        SELECT left(c.content, 160), NULL, NULL, c.is_deleted
          FROM comments c WHERE r.target_type = 'comment' AND c.id = r.target_id
      ) t ON true`;

    const [total, rows] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n ${fromSql} ${whereSql}`, params),
      pool.query(`
        SELECT r.id, r.code, r.target_type, r.target_id, r.reason, r.description, r.status,
               r.resolution_note, r.resolved_at, r.created_at,
               u.username AS reporter_username, u.display_name AS reporter_name,
               t.preview AS target_preview, t.code AS target_code, t.path AS target_path, COALESCE(t.removed, false) AS target_removed,
               (SELECT count(*)::int FROM reports x
                 WHERE x.target_type = r.target_type AND x.target_id = r.target_id AND x.status = 'pending') AS target_pending_count
        ${fromSql}
        ${whereSql}
        ORDER BY r.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limitNum, (pageNum - 1) * limitNum]),
    ]);

    res.json({
      success: true,
      data: rows.rows,
      pagination: { page: pageNum, limit: limitNum, total: total.rows[0].n },
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
