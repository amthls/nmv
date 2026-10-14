import { Response } from 'express';
import { pool } from '../../config';
import { AuthedRequest, isStaff } from '../../common/utils/auth';
import { chapters, profiles, stories } from '../../infra/clients/backend';

// Moved from the backend's report.controller.ts (Plan/community.md): same routes and JSON under /api/community.

const TARGETS = ['story', 'chapter', 'comment', 'post'];
const REASONS = ['spam', 'inappropriate', 'copyright', 'wrong_info', 'harassment', 'other'];
// Spam guard on top of the per-hour limiter in the routes and the one-pending-report unique index
const DAILY_REPORT_LIMIT = 30;
const REREPORT_COOLDOWN_HOURS = 24;

/** What a report points at as it is now: preview, code, path (story/chapter pages are /truyen/<path>, posts /fandom/<path>). */
async function snapshot(type: string, id: string): Promise<{ preview: string | null; code: string | null; path: string | null } | null> {
  if (type === 'post') {
    const r = await pool.query(`SELECT title, code, slug FROM posts WHERE id = $1`, [id]);
    return r.rows[0] ? { preview: r.rows[0].title, code: r.rows[0].code, path: r.rows[0].slug } : null;
  }
  if (type === 'comment') {
    const r = await pool.query(`SELECT left(content, 160) AS preview FROM comments WHERE id = $1`, [id]);
    return r.rows[0] ? { preview: r.rows[0].preview, code: null, path: null } : null;
  }
  const ch = type === 'chapter' ? (await chapters([id])).get(id) : undefined;
  const st = (await stories([ch ? ch.story_id : id])).get(ch ? ch.story_id : id);
  if (!st || (type === 'chapter' && !ch)) return null;
  return ch
    ? { preview: `${st.title} · ${ch.title}`, code: `${st.code}-C${ch.chapter_number}`, path: `${st.slug}/${ch.slug}` }
    : { preview: st.title, code: st.code, path: st.slug };
}

/** File a violation report against a story, chapter, comment or post. */
export const createReport = async (req: AuthedRequest, res: Response) => {
  try {
    const { target_type, target_id, reason, description } = req.body || {};
    if (!TARGETS.includes(target_type)) {
      return res.status(400).json({ success: false, message: 'target_type phải là story, chapter, comment hoặc post.' });
    }
    if (!REASONS.includes(reason)) {
      return res.status(400).json({ success: false, message: `Lý do không hợp lệ. Chọn một trong: ${REASONS.join(', ')}.` });
    }
    if (typeof target_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(target_id)) {
      return res.status(400).json({ success: false, message: 'target_id không hợp lệ.' });
    }
    const target = await snapshot(target_type, target_id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Nội dung bị báo cáo không tồn tại.' });
    }

    const me = req.user!.id;
    const guard = await pool.query(`
      SELECT
        EXISTS (SELECT 1 FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3 AND status = 'pending') AS pending,
        EXISTS (SELECT 1 FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3
                AND status <> 'pending' AND resolved_at > NOW() - make_interval(hours => $4)) AS recently_handled,
        (SELECT count(*)::int FROM reports WHERE reporter_id = $1 AND created_at > NOW() - INTERVAL '24 hours') AS today
    `, [me, target_type, target_id, REREPORT_COOLDOWN_HOURS]);
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
        `INSERT INTO reports (reporter_id, target_type, target_id, reason, description, target_preview, target_code, target_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status, created_at`,
        [me, target_type, target_id, reason, typeof description === 'string' ? description.trim().slice(0, 1000) || null : null,
          target.preview, target.code, target.path]
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
export const getReports = async (req: AuthedRequest, res: Response) => {
  try {
    if (!isStaff(req)) return res.status(403).json({ success: false, message: 'Chỉ Admin/Mod mới xem được báo cáo.' });
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const type = typeof req.query.type === 'string' && TARGETS.includes(req.query.type) ? req.query.type : null;
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

    // Posts and comments are ours (live); stories and chapters: the snapshot taken when reported
    const fromSql = `
      FROM reports r
      LEFT JOIN LATERAL (
        SELECT p.title AS preview, p.code, p.slug AS path, p.approval_status = 'rejected' AS removed
          FROM posts p WHERE r.target_type = 'post' AND p.id = r.target_id
        UNION ALL
        SELECT left(c.content, 160), NULL, NULL, c.is_deleted
          FROM comments c WHERE r.target_type = 'comment' AND c.id = r.target_id
        UNION ALL
        SELECT r.target_preview, r.target_code, r.target_path, NULL WHERE r.target_type IN ('story', 'chapter')
      ) t ON true`;

    const [total, rows] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n ${fromSql} ${whereSql}`, params),
      pool.query(`
        SELECT r.id, r.code, r.target_type, r.target_id, r.reason, r.description, r.status,
               r.resolution_note, r.resolved_at, r.created_at, r.reporter_id,
               t.preview AS target_preview, t.code AS target_code, t.path AS target_path, COALESCE(t.removed, false) AS target_removed,
               (SELECT count(*)::int FROM reports x
                 WHERE x.target_type = r.target_type AND x.target_id = r.target_id AND x.status = 'pending') AS target_pending_count
        ${fromSql}
        ${whereSql}
        ORDER BY r.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limitNum, (pageNum - 1) * limitNum]),
    ]);

    // Reporter names, and whether a reported story (or a chapter's story) has been taken down
    const chs = await chapters(rows.rows.filter((r) => r.target_type === 'chapter').map((r) => r.target_id));
    const [people, sts] = await Promise.all([
      profiles(rows.rows.map((r) => r.reporter_id)),
      stories([...rows.rows.filter((r) => r.target_type === 'story').map((r) => r.target_id), ...[...chs.values()].map((c) => c.story_id)]),
    ]);
    const data = rows.rows.map(({ reporter_id, ...r }) => {
      const storyId = r.target_type === 'story' ? r.target_id : chs.get(r.target_id)?.story_id;
      const removed = r.target_type === 'story' || r.target_type === 'chapter'
        ? sts.get(storyId)?.approval_status === 'rejected'
        : r.target_removed;
      const u = people.get(reporter_id);
      return { ...r, target_removed: removed, reporter_username: u?.username ?? null, reporter_name: u?.display_name ?? null };
    });

    res.json({ success: true, data, pagination: { page: pageNum, limit: limitNum, total: total.rows[0].n } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Close a report as resolved (action taken) or dismissed (no violation). */
export const resolveReport = async (req: AuthedRequest, res: Response) => {
  try {
    if (!isStaff(req)) return res.status(403).json({ success: false, message: 'Chỉ Admin/Mod mới xử lý được báo cáo.' });
    const { id } = req.params;
    const { status, resolution_note } = req.body || {};
    if (!['resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status phải là resolved hoặc dismissed.' });
    }
    const upd = await pool.query(`
      UPDATE reports SET status = $1, resolution_note = $2, resolved_by = $3, resolved_at = NOW()
      WHERE id = $4 RETURNING id, status, resolved_at;
    `, [status, typeof resolution_note === 'string' ? resolution_note.trim().slice(0, 1000) || null : null, req.user!.id, id]);
    if (upd.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Báo cáo không tồn tại.' });
    }
    res.json({ success: true, message: 'Đã cập nhật báo cáo.', data: upd.rows[0] });
  } catch (error: any) {
    if (error?.code === '22P02') return res.status(404).json({ success: false, message: 'Báo cáo không tồn tại.' });
    res.status(500).json({ success: false, message: error.message });
  }
};
