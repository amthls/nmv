import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../../infra/database/db.service';

/** All SQL of the comments module. Methods that run inside a transaction take the Queryable (the pool or a client). */
@Injectable()
export class CommentsRepository {
  constructor(private readonly db: DbService) {}

  // ---- counters

  recountReplies(db: Queryable, parentIds: any[]) {
    return db.query(`UPDATE comments p SET reply_count = (SELECT COUNT(*) FROM comments c WHERE c.parent_id = p.id AND c.is_deleted = false)
                    WHERE p.id = ANY($1::uuid[])`, [parentIds]);
  }

  recountPosts(db: Queryable, postIds: string[]) {
    return db.query(`UPDATE posts p SET comment_count = (
                      SELECT COUNT(*) FROM comments c WHERE c.target_type = 'post' AND c.target_id = p.id AND c.is_deleted = false)
                    WHERE p.id = ANY($1::uuid[])`, [postIds]);
  }

  async countsFor(chapterIds: string[], storyIds: string[]) {
    return (await this.db.query(
      `SELECT target_type, target_id, count(*) FILTER (WHERE NOT is_deleted)::int AS n
       FROM comments WHERE (target_type = 'chapter' AND target_id = ANY($1::uuid[])) OR (target_type = 'story' AND target_id = ANY($2::uuid[]))
       GROUP BY target_type, target_id`, [chapterIds, storyIds])).rows;
  }

  // ---- read

  async list(targetType: any, targetId: any, limit: number, offset: number) {
    return (await this.db.query(`
      SELECT c.id, c.user_id, c.target_type, c.target_id, c.parent_id, c.root_id, c.depth,
        c.content, c.is_edited, c.quoted_text, c.like_count, c.reply_count, c.created_at
      FROM comments c
      WHERE c.target_type = $1 AND c.target_id = $2::uuid AND c.is_deleted = false
      ORDER BY c.created_at ASC
      LIMIT $3 OFFSET $4;
    `, [targetType, targetId, limit, offset])).rows;
  }

  async postTarget(id: any) {
    return (await this.db.query(
      `SELECT user_id, title, approval_status, is_published FROM posts WHERE id = $1 AND is_deleted = false`,
      [id]
    )).rows;
  }

  async parentOf(id: any) {
    return (await this.db.query(`SELECT id, root_id, depth, user_id FROM comments WHERE id = $1 AND is_deleted = false`, [id])).rows;
  }

  // ---- write

  async insert(authorId: string, targetType: string, targetId: any, parentId: any, rootId: any, depth: number, content: string, quotedText: any) {
    return (await this.db.query(`
      INSERT INTO comments (user_id, target_type, target_id, parent_id, root_id, depth, content, quoted_text)
      VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8) RETURNING *;
    `, [authorId, targetType, targetId, parentId || null, rootId || null, depth, content.trim(), quotedText || null])).rows[0];
  }

  async hasLike(userId: string, commentId: string) {
    return (await this.db.query(`SELECT 1 FROM comment_likes WHERE user_id = $1 AND comment_id = $2`, [userId, commentId])).rows.length > 0;
  }

  async removeLike(userId: string, commentId: string) {
    await this.db.query(`DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2`, [userId, commentId]);
    await this.db.query(`UPDATE comments SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`, [commentId]);
  }

  async addLike(userId: string, commentId: string) {
    await this.db.query(`INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2)`, [userId, commentId]);
    await this.db.query(`UPDATE comments SET like_count = like_count + 1 WHERE id = $1`, [commentId]);
  }

  async likeCount(commentId: string) {
    return (await this.db.query(`SELECT like_count FROM comments WHERE id = $1`, [commentId])).rows[0]?.like_count || 0;
  }

  async ownerOf(id: string) {
    return (await this.db.query(`SELECT user_id FROM comments WHERE id = $1 AND is_deleted = false`, [id])).rows;
  }

  async updateContent(id: string, content: string) {
    return (await this.db.query(
      `UPDATE comments SET content = $1, is_edited = true WHERE id = $2 RETURNING id, content, is_edited, updated_at`,
      [content, id]
    )).rows[0];
  }

  async lockLive(tx: Queryable, id: string) {
    return (await tx.query(
      `SELECT id, user_id, target_type, target_id, parent_id FROM comments WHERE id = $1 AND is_deleted = false FOR UPDATE`,
      [id]
    )).rows;
  }

  /** The comment plus all live descendants (replies, replies of replies). */
  deleteTree(tx: Queryable, id: string) {
    return tx.query(`
        WITH RECURSIVE t AS (
          SELECT id FROM comments WHERE id = $1
          UNION ALL
          SELECT c.id FROM comments c JOIN t ON c.parent_id = t.id WHERE c.is_deleted = false
        )
        UPDATE comments SET is_deleted = true WHERE id IN (SELECT id FROM t) AND is_deleted = false;
      `, [id]);
  }

  /** Hide every live comment of a user and the replies under them. */
  hideOfUser(db: Queryable, userId: string) {
    return db.query(`
    WITH RECURSIVE t AS (
      SELECT id FROM comments WHERE user_id = $1 AND is_deleted = false
      UNION
      SELECT c.id FROM comments c JOIN t ON c.parent_id = t.id WHERE c.is_deleted = false
    )
    UPDATE comments SET is_deleted = true WHERE id IN (SELECT id FROM t) AND is_deleted = false
    RETURNING parent_id, target_type, target_id;
  `, [userId]);
  }
}
