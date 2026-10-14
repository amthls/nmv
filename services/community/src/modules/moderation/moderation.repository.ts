import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../../infra/database/db.service';

const REMOVED_WHERE = `p.approval_status = 'rejected' AND p.is_deleted = false
          AND ($1::text IS NULL OR p.code ILIKE $1 OR p.title ILIKE $1 OR p.content ILIKE $1 OR p.user_id = $2::uuid)`;

/** All SQL of the moderation module (removed content, processed identity events). */
@Injectable()
export class ModerationRepository {
  constructor(private readonly db: DbService) {}

  async countRemovedPosts(pattern: string | null, authorId: string | null): Promise<number> {
    return (await this.db.query(`SELECT count(*)::int AS n FROM posts p WHERE ${REMOVED_WHERE}`, [pattern, authorId])).rows[0].n;
  }

  async removedPosts(pattern: string | null, authorId: string | null, limit: number) {
    return (await this.db.query(`SELECT 'post' AS type, p.id, p.code, p.title, p.slug, p.cover_image_url AS image, p.user_id, p.removed_by,
                        p.rejection_reason AS reason, p.removed_at
                      FROM posts p WHERE ${REMOVED_WHERE} ORDER BY p.removed_at DESC NULLS LAST LIMIT $3`, [pattern, authorId, limit])).rows;
  }

  /** True when the event was not seen before (and is now recorded). */
  async markEventSeen(tx: Queryable, eventId: string, type: string): Promise<boolean> {
    const seen = await tx.query(`INSERT INTO processed_events (event_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`, [eventId, type]);
    return seen.rowCount !== 0;
  }

  hidePostsOf(tx: Queryable, userId: string) {
    return tx.query(`UPDATE posts SET is_deleted = true, is_pinned = false WHERE user_id = $1 AND is_deleted = false`, [userId]);
  }
}
