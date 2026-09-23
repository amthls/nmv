import { Request, Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { enqueueNotificationJob } from '../services/queue.service';
import { commentNotifications } from '../services/notification.service';

export const getComments = async (req: Request, res: Response) => {
  try {
    const { target_type, target_id, page = '1', limit = '50' } = req.query;

    if (!target_type || !target_id) {
      return res.status(400).json({ success: false, message: 'target_type và target_id là bắt buộc' });
    }

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 50));
    const offset = (pageNum - 1) * limitNum;

    const result = await pool.query(`
      SELECT 
        c.id, c.user_id, c.target_type, c.target_id, c.parent_id, c.root_id, c.depth,
        c.content, c.is_edited, c.quoted_text, c.like_count, c.reply_count, c.created_at,
        u.username, u.display_name, u.avatar_url,
        (
          SELECT array_agg(role::text) 
          FROM user_roles 
          WHERE user_id = u.id
        ) as roles
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.target_type = $1::comment_target_type 
        AND c.target_id = $2::uuid 
        AND c.is_deleted = false
      ORDER BY c.created_at ASC
      LIMIT $3 OFFSET $4;
    `, [target_type, target_id, limitNum, offset]);

    const commentMap = new Map();
    const rootComments: any[] = [];

    result.rows.forEach((comment) => {
      comment.replies = [];
      commentMap.set(comment.id, comment);
    });

    result.rows.forEach((comment) => {
      if (comment.parent_id && commentMap.has(comment.parent_id)) {
        commentMap.get(comment.parent_id).replies.push(comment);
      } else {
        rootComments.push(comment);
      }
    });

    rootComments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({
      success: true,
      data: rootComments,
      total: result.rows.length,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createComment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để bình luận.' });
    }

    const { target_type, target_id, parent_id, content, quoted_text } = req.body;

    if (!target_type || !target_id || !content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập nội dung bình luận.' });
    }

    const authorId = req.user.id;

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
      const userRoles = req.user.roles || [];
      const isAdminOrMod = userRoles.includes('admin') || userRoles.includes('mod');
      const isPostVisible = targetPost.approval_status === 'approved' && targetPost.is_published;
      if (!isPostVisible && targetPost.user_id !== authorId && !isAdminOrMod) {
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
        // Note: reply_count on the parent is incremented by the trg_comment_counts DB trigger,
        // do not increment it again here or counts double.
      }
    }

    const insertRes = await pool.query(`
      INSERT INTO comments (
        user_id, target_type, target_id, parent_id, root_id, depth, content, quoted_text
      ) VALUES (
        $1, $2::comment_target_type, $3::uuid, $4, $5, $6, $7, $8
      ) RETURNING *;
    `, [authorId, target_type, target_id, parent_id || null, rootId || null, depth, content.trim(), quoted_text || null]);

    const newComment = insertRes.rows[0];

    const userRes = await pool.query(`
      SELECT u.username, u.display_name, u.avatar_url,
        (SELECT array_agg(role::text) FROM user_roles WHERE user_id = u.id) as roles
      FROM users u WHERE u.id = $1;
    `, [authorId]);

    const user = userRes.rows[0];
    newComment.username = user?.username || req.user.username;
    newComment.display_name = user?.display_name || req.user.display_name;
    newComment.avatar_url = user?.avatar_url || req.user.avatar_url;
    newComment.roles = user?.roles || req.user.roles;
    newComment.replies = [];

    // Who should hear about this comment is decided here; delivery happens through the queue
    enqueueNotificationJob({
      kind: 'notify',
      items: commentNotifications({
        commentId: newComment.id,
        actorId: authorId,
        actorName: newComment.display_name || newComment.username || 'Ai đó',
        content,
        targetType: target_type,
        targetId: target_id,
        postOwnerId,
        postTitle,
        parentAuthorId,
      }),
    }).catch((err: any) => console.error('[Notification] enqueue failed:', err.message));

    // Note: comment_count / total_comments on the target are incremented by the
    // trg_comment_counts DB trigger, do not increment them again here or counts double.

    res.status(201).json({
      success: true,
      message: 'Bình luận thành công',
      data: newComment,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const likeComment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }

    const { id } = req.params;
    const authorId = req.user.id;

    const checkRes = await pool.query(`SELECT * FROM comment_likes WHERE user_id = $1 AND comment_id = $2`, [authorId, id]);

    let liked = false;
    if (checkRes.rows.length > 0) {
      await pool.query(`DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2`, [authorId, id]);
      await pool.query(`UPDATE comments SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`, [id]);
      liked = false;
    } else {
      await pool.query(`INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2)`, [authorId, id]);
      await pool.query(`UPDATE comments SET like_count = like_count + 1 WHERE id = $1`, [id]);
      liked = true;
    }

    const commentRes = await pool.query(`SELECT like_count FROM comments WHERE id = $1`, [id]);

    res.json({
      success: true,
      liked,
      like_count: commentRes.rows[0]?.like_count || 0,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Edit own comment (admin/mod may not rewrite other people's words - they can only delete).
 */
export const updateComment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }
    const { id } = req.params;
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      return res.status(400).json({ success: false, message: 'Nội dung bình luận không được để trống.' });
    }

    const found = await pool.query(`SELECT user_id FROM comments WHERE id = $1 AND is_deleted = false`, [id]);
    if (found.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bình luận không tồn tại hoặc đã bị xóa.' });
    }
    if (found.rows[0].user_id !== req.user.id) {
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

/**
 * Delete a comment (author, admin or mod). Soft delete: the row stays, replies are hidden with it,
 * and the denormalised counters that the INSERT trigger raised are lowered again.
 */
export const deleteComment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }
    const { id } = req.params;
    const roles = req.user.roles || [];
    const isModerator = roles.includes('admin') || roles.includes('mod');

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
      if (comment.user_id !== req.user.id && !isModerator) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa bình luận này.' });
      }

      // The comment plus all live descendants (replies, replies of replies)
      const tree = await client.query(`
        WITH RECURSIVE t AS (
          SELECT id FROM comments WHERE id = $1
          UNION ALL
          SELECT c.id FROM comments c JOIN t ON c.parent_id = t.id WHERE c.is_deleted = false
        )
        UPDATE comments SET is_deleted = true WHERE id IN (SELECT id FROM t) AND is_deleted = false
        RETURNING id;
      `, [id]);
      const removed = tree.rowCount || 0;

      if (comment.parent_id) {
        await client.query(`UPDATE comments SET reply_count = GREATEST(0, reply_count - 1) WHERE id = $1`, [comment.parent_id]);
      }
      if (comment.target_type === 'chapter') {
        await client.query(`UPDATE chapters SET total_comments = GREATEST(0, total_comments - $2) WHERE id = $1`, [comment.target_id, removed]);
        await client.query(
          `UPDATE stories SET total_comments = GREATEST(0, total_comments - $2)
           WHERE id = (SELECT story_id FROM chapters WHERE id = $1)`,
          [comment.target_id, removed]
        );
      } else if (comment.target_type === 'story') {
        await client.query(`UPDATE stories SET total_comments = GREATEST(0, total_comments - $2) WHERE id = $1`, [comment.target_id, removed]);
      } else if (comment.target_type === 'post') {
        await client.query(`UPDATE posts SET comment_count = GREATEST(0, comment_count - $2) WHERE id = $1`, [comment.target_id, removed]);
      }

      await client.query('COMMIT');
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
