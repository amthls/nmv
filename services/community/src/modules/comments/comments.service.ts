import { Request, Response } from 'express';
import { pool } from '../../config';
import { AuthedRequest, isStaff } from '../../common/utils/auth';
import { authorFields, callBackend, chapters, profiles } from '../../infra/clients/backend';
import { commentNotifications, notify } from '../notify/notify.service';

// Moved from the backend's comment.controller.ts (Plan/community.md): same routes and JSON under /api/community.

type Db = { query: (text: string, params?: any[]) => Promise<any> };

/**
 * Comment counters. Replies and posts are recounted here (inside the caller's transaction); stories and chapters are
 * the backend's (stories.total_comments = story page + all its chapters): returns a function that sends it fresh counts,
 * to call once committed. Recounting (not +1/-1) means a repeated or lost call can't drift the numbers.
 */
export async function recount(db: Db, rows: { target_type: string; target_id: string; parent_id?: string | null }[]) {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.target_type === type).map((r) => r.target_id))];
  const parentIds = [...new Set(rows.map((r) => r.parent_id).filter(Boolean))];
  if (parentIds.length) {
    await db.query(`UPDATE comments p SET reply_count = (SELECT COUNT(*) FROM comments c WHERE c.parent_id = p.id AND c.is_deleted = false)
                    WHERE p.id = ANY($1::uuid[])`, [parentIds]);
  }
  if (ids('post').length) {
    await db.query(`UPDATE posts p SET comment_count = (
                      SELECT COUNT(*) FROM comments c WHERE c.target_type = 'post' AND c.target_id = p.id AND c.is_deleted = false)
                    WHERE p.id = ANY($1::uuid[])`, [ids('post')]);
  }
  return () => void pushCatalogCounts(ids('chapter'), ids('story'));
}

/** Fresh comment counts of chapters and story pages to the backend (stories.total_comments, chapters.total_comments). */
export async function pushCatalogCounts(chapterIds: string[], storyIds: string[]) {
  try {
    if (chapterIds.length === 0 && storyIds.length === 0) return;
    const chs = await chapters(chapterIds);
    const allStories = [...new Set([...storyIds, ...[...chs.values()].map((c) => c.story_id)])];
    const r = await pool.query(
      `SELECT target_type, target_id, count(*) FILTER (WHERE NOT is_deleted)::int AS n
       FROM comments WHERE (target_type = 'chapter' AND target_id = ANY($1::uuid[])) OR (target_type = 'story' AND target_id = ANY($2::uuid[]))
       GROUP BY target_type, target_id`, [chapterIds, allStories]);
    const count = (type: string, id: string) => r.rows.find((x) => x.target_type === type && x.target_id === id)?.n || 0;
    const res = await callBackend('POST', '/internal/comment-counts', {
      chapters: chapterIds.map((id) => ({ id, count: count('chapter', id) })),
      stories: allStories.map((id) => ({ id, page_count: count('story', id) })),
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  } catch (err: any) {
    console.error('[comments] could not send comment counts to the backend:', err.message);
  }
}

export const getComments = async (req: Request, res: Response) => {
  try {
    const { target_type, target_id, page = '1', limit = '50' } = req.query;

    if (!target_type || !target_id) {
      return res.status(400).json({ success: false, message: 'target_type và target_id là bắt buộc' });
    }
    if (!['chapter', 'post', 'story'].includes(String(target_type))) {
      return res.status(400).json({ success: false, message: 'target_type không hợp lệ.' });
    }

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 50));
    const offset = (pageNum - 1) * limitNum;

    const result = await pool.query(`
      SELECT c.id, c.user_id, c.target_type, c.target_id, c.parent_id, c.root_id, c.depth,
        c.content, c.is_edited, c.quoted_text, c.like_count, c.reply_count, c.created_at
      FROM comments c
      WHERE c.target_type = $1 AND c.target_id = $2::uuid AND c.is_deleted = false
      ORDER BY c.created_at ASC
      LIMIT $3 OFFSET $4;
    `, [target_type, target_id, limitNum, offset]);

    const people = await profiles(result.rows.map((c) => c.user_id));
    const commentMap = new Map();
    const rootComments: any[] = [];
    const rows = result.rows.map((c) => ({ ...c, ...authorFields(people.get(c.user_id)), replies: [] as any[] }));
    rows.forEach((comment) => commentMap.set(comment.id, comment));
    rows.forEach((comment) => {
      if (comment.parent_id && commentMap.has(comment.parent_id)) commentMap.get(comment.parent_id).replies.push(comment);
      else rootComments.push(comment);
    });

    rootComments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({ success: true, data: rootComments, total: result.rows.length });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createComment = async (req: AuthedRequest, res: Response) => {
  try {
    const { target_type, target_id, parent_id, content, quoted_text } = req.body || {};

    if (!target_type || !target_id || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập nội dung bình luận.' });
    }
    if (!['chapter', 'post', 'story'].includes(target_type)) {
      return res.status(400).json({ success: false, message: 'target_type không hợp lệ.' });
    }

    const authorId = req.user!.id;

    let postOwnerId: string | null = null;
    let postTitle: string | null = null;
    if (target_type === 'post') {
      const postRes = await pool.query(
        `SELECT user_id, title, approval_status, is_published FROM posts WHERE id = $1 AND is_deleted = false`,
        [target_id]
      );
      if (postRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Bài viết không tồn tại hoặc đã bị xóa.' });
      }
      const targetPost = postRes.rows[0];
      postOwnerId = targetPost.user_id;
      postTitle = targetPost.title;
      const isPostVisible = targetPost.approval_status === 'approved' && targetPost.is_published;
      if (!isPostVisible && targetPost.user_id !== authorId && !isStaff(req)) {
        return res.status(404).json({ success: false, message: 'Bài viết không tồn tại hoặc đã bị xóa.' });
      }
    }

    let depth = 0;
    let rootId = null;
    let parentAuthorId: string | null = null;

    if (parent_id) {
      const parentRes = await pool.query(`SELECT id, root_id, depth, user_id FROM comments WHERE id = $1 AND is_deleted = false`, [parent_id]);
      if (parentRes.rows.length > 0) {
        const parent = parentRes.rows[0];
        depth = (parent.depth || 0) + 1;
        rootId = parent.root_id || parent.id;
        parentAuthorId = parent.user_id;
      }
    }

    const insertRes = await pool.query(`
      INSERT INTO comments (user_id, target_type, target_id, parent_id, root_id, depth, content, quoted_text)
      VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8) RETURNING *;
    `, [authorId, target_type, target_id, parent_id || null, rootId || null, depth, content.trim(), quoted_text || null]);
    const newComment = insertRes.rows[0];
    (await recount(pool, [newComment]))();

    const me = (await profiles([authorId]).catch(() => new Map())).get(authorId);
    Object.assign(newComment, authorFields(me), { replies: [] });

    // Who should hear about this comment is decided here; delivery is the messaging service's
    void notify(commentNotifications({
      commentId: newComment.id,
      actorId: authorId,
      actorName: newComment.display_name || newComment.username || 'Ai đó',
      content,
      targetType: target_type,
      targetId: target_id,
      postOwnerId,
      postTitle,
      parentAuthorId,
    }));

    res.status(201).json({ success: true, message: 'Bình luận thành công', data: newComment });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const likeComment = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const authorId = req.user!.id;

    const checkRes = await pool.query(`SELECT 1 FROM comment_likes WHERE user_id = $1 AND comment_id = $2`, [authorId, id]);

    let liked = false;
    if (checkRes.rows.length > 0) {
      await pool.query(`DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2`, [authorId, id]);
      await pool.query(`UPDATE comments SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`, [id]);
    } else {
      await pool.query(`INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2)`, [authorId, id]);
      await pool.query(`UPDATE comments SET like_count = like_count + 1 WHERE id = $1`, [id]);
      liked = true;
    }

    const commentRes = await pool.query(`SELECT like_count FROM comments WHERE id = $1`, [id]);
    res.json({ success: true, liked, like_count: commentRes.rows[0]?.like_count || 0 });
  } catch (error: any) {
    if (error?.code === '23503' || error?.code === '22P02') return res.status(404).json({ success: false, message: 'Bình luận không tồn tại.' });
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Edit own comment (admin/mod may not rewrite other people's words - they can only delete). */
export const updateComment = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      return res.status(400).json({ success: false, message: 'Nội dung bình luận không được để trống.' });
    }

    const found = await pool.query(`SELECT user_id FROM comments WHERE id = $1 AND is_deleted = false`, [id]);
    if (found.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bình luận không tồn tại hoặc đã bị xóa.' });
    }
    if (found.rows[0].user_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Bạn chỉ có thể sửa bình luận của chính mình.' });
    }

    const upd = await pool.query(
      `UPDATE comments SET content = $1, is_edited = true WHERE id = $2 RETURNING id, content, is_edited, updated_at`,
      [content, id]
    );
    res.json({ success: true, message: 'Đã cập nhật bình luận.', data: upd.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Delete a comment (author, admin or mod). Soft delete: the row stays, replies are hidden with it, counters recounted. */
export const deleteComment = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT id, user_id, target_type, target_id, parent_id FROM comments WHERE id = $1 AND is_deleted = false FOR UPDATE`,
        [id]
      );
      if (found.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Bình luận không tồn tại hoặc đã bị xóa.' });
      }
      const comment = found.rows[0];
      if (comment.user_id !== req.user!.id && !isStaff(req)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa bình luận này.' });
      }

      // The comment plus all live descendants (replies, replies of replies)
      await client.query(`
        WITH RECURSIVE t AS (
          SELECT id FROM comments WHERE id = $1
          UNION ALL
          SELECT c.id FROM comments c JOIN t ON c.parent_id = t.id WHERE c.is_deleted = false
        )
        UPDATE comments SET is_deleted = true WHERE id IN (SELECT id FROM t) AND is_deleted = false;
      `, [id]);
      const sendCounts = await recount(client, [comment]);
      await client.query('COMMIT');
      sendCounts();
      res.json({ success: true, message: 'Đã xóa bình luận.' });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Hide every live comment of a user (and the replies under them); returns what sends the backend's counts after commit. */
export async function purgeUserComments(db: Db, userId: string): Promise<() => void> {
  const removed = await db.query(`
    WITH RECURSIVE t AS (
      SELECT id FROM comments WHERE user_id = $1 AND is_deleted = false
      UNION
      SELECT c.id FROM comments c JOIN t ON c.parent_id = t.id WHERE c.is_deleted = false
    )
    UPDATE comments SET is_deleted = true WHERE id IN (SELECT id FROM t) AND is_deleted = false
    RETURNING parent_id, target_type, target_id;
  `, [userId]);
  return removed.rowCount > 0 ? recount(db, removed.rows) : () => {};
}
