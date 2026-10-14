import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

/** Posts and comments are ours (live); stories and chapters: the snapshot taken when reported. */
const REPORT_FROM = `
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

/** All SQL of the reports module. */
@Injectable()
export class ReportsRepository {
  constructor(private readonly db: DbService) {}

  async postBrief(id: string) {
    return (await this.db.query(`SELECT title, code, slug FROM posts WHERE id = $1`, [id])).rows[0];
  }

  async commentBrief(id: string) {
    return (await this.db.query(`SELECT left(content, 160) AS preview FROM comments WHERE id = $1`, [id])).rows[0];
  }

  async guardCounts(me: string, targetType: string, targetId: string, cooldownHours: number) {
    return (await this.db.query(`
      SELECT
        EXISTS (SELECT 1 FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3 AND status = 'pending') AS pending,
        EXISTS (SELECT 1 FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3
                AND status <> 'pending' AND resolved_at > NOW() - make_interval(hours => $4)) AS recently_handled,
        (SELECT count(*)::int FROM reports WHERE reporter_id = $1 AND created_at > NOW() - INTERVAL '24 hours') AS today
    `, [me, targetType, targetId, cooldownHours])).rows[0];
  }

  async insert(params: any[]) {
    return (await this.db.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, description, target_preview, target_code, target_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status, created_at`,
      params
    )).rows[0];
  }

  async count(whereSql: string, params: any[]): Promise<number> {
    return (await this.db.query(`SELECT count(*)::int AS n ${REPORT_FROM} ${whereSql}`, params)).rows[0].n;
  }

  async list(whereSql: string, params: any[], limit: number, offset: number) {
    return (await this.db.query(`
        SELECT r.id, r.code, r.target_type, r.target_id, r.reason, r.description, r.status,
               r.resolution_note, r.resolved_at, r.created_at, r.reporter_id,
               t.preview AS target_preview, t.code AS target_code, t.path AS target_path, COALESCE(t.removed, false) AS target_removed,
               (SELECT count(*)::int FROM reports x
                 WHERE x.target_type = r.target_type AND x.target_id = r.target_id AND x.status = 'pending') AS target_pending_count
        ${REPORT_FROM}
        ${whereSql}
        ORDER BY r.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limit, offset])).rows;
  }

  async resolve(status: string, note: string | null, staffId: string, id: string) {
    return (await this.db.query(`
      UPDATE reports SET status = $1, resolution_note = $2, resolved_by = $3, resolved_at = NOW()
      WHERE id = $4 RETURNING id, status, resolved_at;
    `, [status, note, staffId, id])).rows;
  }
}
