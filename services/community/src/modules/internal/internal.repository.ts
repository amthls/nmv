import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

/** All SQL of the internal module (service-to-service calls). */
@Injectable()
export class InternalRepository {
  constructor(private readonly db: DbService) {}

  async postPath(no: number, me: string | null, staff: boolean): Promise<string | null> {
    const r = await this.db.query(`SELECT '/fandom/' || slug AS path FROM posts WHERE code_no = $1 AND NOT is_deleted
                                AND ((approval_status = 'approved' AND is_published) OR user_id = $2 OR $3)`, [no, me, staff]);
    return r.rows[0]?.path ?? null;
  }

  async reportPath(no: number): Promise<string | null> {
    const r = await this.db.query(`SELECT '/bao-cao' AS path FROM reports WHERE code_no = $1`, [no]);
    return r.rows[0]?.path ?? null;
  }

  async userStats(userId: string) {
    return (await this.db.query(`
    SELECT (SELECT count(*)::int FROM posts WHERE user_id = $1 AND is_deleted = false) AS posts,
           (SELECT count(*)::int FROM posts WHERE user_id = $1 AND is_deleted = false AND approval_status = 'approved') AS approved_posts,
           (SELECT count(*)::int FROM comments WHERE user_id = $1 AND is_deleted = false) AS comments,
           (SELECT COALESCE(sum(like_count), 0)::int FROM comments WHERE user_id = $1 AND is_deleted = false) AS comment_likes`,
    [userId])).rows[0];
  }

  async deleteStoryComments(storyId: string | null, chapterIds: string[]): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM comments WHERE (target_type = 'story' AND target_id = $1::uuid) OR (target_type = 'chapter' AND target_id = ANY($2::uuid[]))`,
      [storyId, chapterIds]);
    return r.rowCount!;
  }

  unlinkStoryPosts(storyId: string | null) {
    return this.db.query(`UPDATE posts SET story_id = NULL WHERE story_id = $1::uuid`, [storyId]);
  }
}
