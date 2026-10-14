import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

/** Post columns + reaction summary and the viewer's own reaction ($1 = viewer id or null); author/story via withPeople. */
const POST_SELECT = `
  SELECT
    p.*,
    COALESCE((
      SELECT json_object_agg(reaction, cnt) FROM (
        SELECT reaction, count(*) AS cnt FROM post_reactions WHERE post_id = p.id GROUP BY reaction
      ) r
    ), '{}'::json) AS reaction_summary,
    (SELECT pr.reaction FROM post_reactions pr WHERE pr.post_id = p.id AND pr.user_id = $1::uuid) AS my_reaction,
    (SELECT COUNT(*)::int FROM comments c WHERE c.target_type = 'post' AND c.target_id = p.id AND c.is_deleted = false) AS real_comment_count,
    EXISTS (SELECT 1 FROM post_notification_mutes m WHERE m.post_id = p.id AND m.user_id = $1::uuid) AS notifications_muted
  FROM posts p`;

/** All SQL of the posts module. */
@Injectable()
export class PostsRepository {
  constructor(private readonly db: DbService) {}

  // ---- read

  async count(where: string, values: any[]): Promise<number> {
    return (await this.db.query(`SELECT COUNT(*)::int AS n FROM posts p WHERE ${where}`, values)).rows[0].n;
  }

  async list(where: string, orderBy: string, limit: number, offset: number, values: any[]) {
    return (await this.db.query(`${POST_SELECT} WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, values)).rows;
  }

  async bySlug(viewerId: string | null, slug: string) {
    return (await this.db.query(`${POST_SELECT} WHERE p.slug = $2 AND p.is_deleted = false`, [viewerId, slug])).rows[0];
  }

  incrementViews(id: string) {
    return this.db.query('UPDATE posts SET view_count = view_count + 1 WHERE id = $1', [id]);
  }

  async takenSlugs(clean: string): Promise<Set<string>> {
    const res = await this.db.query(`SELECT slug FROM posts WHERE slug = $1 OR slug LIKE $2`, [clean, `${clean}-%`]);
    return new Set(res.rows.map((r: any) => r.slug));
  }

  leaders() {
    // a few extra: deleted or banned people are dropped after asking the backend
    return this.db.query(`
        SELECT p.user_id, count(p.id)::int AS posts,
          COALESCE(sum(p.reaction_count), 0)::int AS reactions, COALESCE(sum(p.comment_count), 0)::int AS comments
        FROM posts p
        WHERE p.is_deleted = false AND p.approval_status = 'approved' AND p.is_published AND p.published_at > NOW() - INTERVAL '30 days'
        GROUP BY p.user_id
        ORDER BY count(p.id) * 3 + COALESCE(sum(p.reaction_count), 0) + COALESCE(sum(p.comment_count), 0) * 2 DESC
        LIMIT 20`);
  }

  topStories() {
    return this.db.query(`
        SELECT story_id, count(*)::int AS post_count
        FROM posts WHERE story_id IS NOT NULL AND is_deleted = false AND approval_status = 'approved' AND is_published
        GROUP BY story_id ORDER BY count(*) DESC, max(published_at) DESC LIMIT 30`);
  }

  viewerCounts(viewerId: string | null) {
    return this.db.query(`
        SELECT
          (SELECT count(*)::int FROM posts WHERE is_deleted = false AND is_draft AND user_id = $1::uuid) AS drafts,
          (SELECT count(*)::int FROM posts WHERE is_deleted = false AND NOT is_draft AND user_id = $1::uuid) AS mine,
          (SELECT count(*)::int FROM posts WHERE is_deleted = false AND approval_status = 'approved' AND is_published) AS total`,
      [viewerId]);
  }

  // ---- write

  async insert(userId: string, f: any, slug: string, status: string, published: boolean) {
    return (await this.db.query(
      `INSERT INTO posts (user_id, story_id, title, slug, content, category, cover_image_url, images, is_draft,
                          approval_status, is_published, published_at, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11,
               CASE WHEN $11 THEN NOW() END, CASE WHEN $11 THEN NOW() END)
       RETURNING *`,
      [userId, f.story_id, f.title, slug, f.content, f.category, f.images![0] || null, JSON.stringify(f.images),
        f.is_draft, status, published],
    )).rows[0];
  }

  async findLive(id: string) {
    return (await this.db.query(`SELECT * FROM posts WHERE id = $1 AND is_deleted = false`, [id])).rows[0];
  }

  async findLiveOwner(id: string) {
    return (await this.db.query(`SELECT id, user_id FROM posts WHERE id = $1 AND is_deleted = false`, [id])).rows[0];
  }

  async update(post: any, f: any, draft: boolean, status: string, published: boolean) {
    return (await this.db.query(
      `UPDATE posts SET
         title = COALESCE($2, title),
         content = COALESCE($3, content),
         category = COALESCE($4, category),
         story_id = CASE WHEN $5::boolean THEN $6::uuid ELSE story_id END,
         images = COALESCE($7::jsonb, images),
         cover_image_url = CASE WHEN $7::jsonb IS NULL THEN cover_image_url ELSE ($7::jsonb ->> 0) END,
         is_draft = $8::boolean,
         approval_status = $9::varchar,
         is_published = $10::boolean,
         published_at = CASE WHEN $10 THEN COALESCE(published_at, NOW()) ELSE published_at END,
         rejection_reason = CASE WHEN $9::varchar = 'rejected' THEN rejection_reason ELSE NULL END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [post.id, f.title ?? null, f.content ?? null, f.category ?? null, f.story_id !== undefined, f.story_id ?? null,
        f.images ? JSON.stringify(f.images) : null, draft, status, published],
    )).rows[0];
  }

  softDelete(id: string) {
    return this.db.query(`UPDATE posts SET is_deleted = true, is_pinned = false, updated_at = NOW() WHERE id = $1`, [id]);
  }

  async approve(userId: string, ids: string[]) {
    return (await this.db.query(
      `UPDATE posts SET approval_status = 'approved', approved_by = $1, approved_at = NOW(), is_published = true, is_draft = false,
           published_at = COALESCE(published_at, NOW()), rejection_reason = NULL, removed_by = NULL, removed_at = NULL, updated_at = NOW()
         WHERE id = ANY($2::uuid[]) AND is_deleted = false AND approval_status = 'rejected'
         RETURNING id, user_id, title`, [userId, ids])).rows;
  }

  async reject(userId: string, ids: string[], reason: string | null) {
    return (await this.db.query(
      `UPDATE posts SET approval_status = 'rejected', is_published = false, is_pinned = false, rejection_reason = $2,
           removed_by = $3, removed_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND is_deleted = false AND approval_status <> 'draft'
         RETURNING id, user_id, title`, [ids, reason, userId])).rows;
  }

  async togglePin(id: string) {
    return (await this.db.query(
      `UPDATE posts SET is_pinned = NOT is_pinned WHERE id = $1 AND is_deleted = false AND approval_status = 'approved'
       RETURNING is_pinned`, [id])).rows;
  }

  async removeMute(userId: string, postId: string) {
    return (await this.db.query(`DELETE FROM post_notification_mutes WHERE user_id = $1 AND post_id = $2 RETURNING 1`, [userId, postId])).rows;
  }

  addMute(userId: string, postId: string) {
    return this.db.query(
      `INSERT INTO post_notification_mutes (user_id, post_id) SELECT $1, id FROM posts WHERE id = $2 AND is_deleted = false ON CONFLICT DO NOTHING`,
      [userId, postId]);
  }

  // ---- reactions

  async reactionTarget(id: string) {
    return (await this.db.query(`SELECT user_id, title, approval_status, is_published FROM posts WHERE id = $1 AND is_deleted = false`, [id])).rows[0];
  }

  async reactionOf(postId: string, userId: string) {
    return (await this.db.query(`SELECT reaction FROM post_reactions WHERE post_id = $1 AND user_id = $2`, [postId, userId])).rows;
  }

  deleteReaction(postId: string, userId: string) {
    return this.db.query(`DELETE FROM post_reactions WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
  }

  changeReaction(postId: string, userId: string, reaction: string) {
    return this.db.query(`UPDATE post_reactions SET reaction = $1 WHERE post_id = $2 AND user_id = $3`, [reaction, postId, userId]);
  }

  addReaction(postId: string, userId: string, reaction: string) {
    return this.db.query(`INSERT INTO post_reactions (post_id, user_id, reaction) VALUES ($1, $2, $3)`, [postId, userId, reaction]);
  }

  recountReactions(id: string) {
    return this.db.query(`UPDATE posts SET reaction_count = (SELECT count(*) FROM post_reactions WHERE post_id = $1) WHERE id = $1`, [id]);
  }

  async reactionSummary(id: string) {
    return (await this.db.query(`
      SELECT (SELECT count(*)::int FROM post_reactions WHERE post_id = $1) AS reaction_count,
        COALESCE((SELECT json_object_agg(reaction, n) FROM (
          SELECT reaction, count(*) AS n FROM post_reactions WHERE post_id = $1 GROUP BY reaction) r), '{}'::json) AS reaction_summary`, [id])).rows[0];
  }
}
