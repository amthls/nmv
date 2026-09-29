import { Request, Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sanitizeRichText, hasRichContent } from '../utils/richText';
import { enqueueNotificationJob } from '../services/queue.service';
import { insertWithUniqueSlug } from '../utils/ids';
import { postReactionNotification, postReviewNotifications } from '../services/notification.service';

function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const getPosts = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      story_id, 
      sort = 'newest', 
      q,
      filter_status 
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    const conditions: string[] = ['p.is_deleted = false'];
    const values: any[] = [];
    let paramIdx = 1;

    const currentUser = req.user;
    const userRoles = currentUser?.roles || [];
    const isAdminOrMod = userRoles.includes('admin') || userRoles.includes('mod');

    if (filter_status === 'pending') {
      if (!isAdminOrMod) {
        return res.status(403).json({
          success: false,
          message: 'Ch\u1ec9 Qu\u1ea3n tr\u1ecb vi\u00ean ho\u1eb7c Ki\u1ec3m duy\u1ec7t vi\u00ean m\u1edbi c\u00f3 th\u1ec3 xem h\u00e0ng ch\u1edd duy\u1ec7t.',
        });
      }
      conditions.push("p.approval_status = 'pending'");
    } else if (filter_status === 'drafts') {
      if (!currentUser) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: Number(page), limit: Number(limit), total: 0, totalPages: 0 }
        });
      }
      conditions.push(`p.user_id = $${paramIdx}`);
      values.push(currentUser.id);
      paramIdx++;
      conditions.push("p.is_draft = true");
    } else if (filter_status === 'mine') {
      if (!currentUser) {
        return res.json({
          success: true,
          data: [],
          pagination: { page: Number(page), limit: Number(limit), total: 0, totalPages: 0 }
        });
      }
      conditions.push(`p.user_id = $${paramIdx}`);
      values.push(currentUser.id);
      paramIdx++;
      conditions.push("p.is_draft = false");
    } else {
      conditions.push("p.is_published = true");
      conditions.push("p.approval_status = 'approved'");
    }

    if (story_id) {
      conditions.push(`p.story_id = $${paramIdx}`);
      values.push(story_id);
      paramIdx++;
    }

    if (q) {
      conditions.push(`(p.title ILIKE $${paramIdx} OR p.content ILIKE $${paramIdx})`);
      values.push(`%${q}%`);
      paramIdx++;
    }

    let orderBy = 'p.published_at DESC NULLS LAST, p.created_at DESC';
    if (sort === 'popular') {
      orderBy = 'p.reaction_count DESC, p.comment_count DESC';
    } else if (sort === 'views') {
      orderBy = 'p.view_count DESC';
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `SELECT COUNT(*) FROM posts p WHERE ${whereClause}`;
    const countRes = await pool.query(countQuery, values);
    const total = parseInt(countRes.rows[0].count, 10);

    const dataQuery = `
      SELECT 
        p.*,
        u.username as author_username,
        u.display_name as author_name,
        u.avatar_url as author_avatar,
        COALESCE(json_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '[]') as author_roles,
        s.title as story_title,
        s.slug as story_slug,
        s.cover_image_url as story_cover,
        s.story_type as story_type,
        s.author_name as story_author,
        COALESCE(
          (
            SELECT json_object_agg(reaction, cnt) 
            FROM (
              SELECT reaction, count(*) as cnt 
              FROM post_reactions 
              WHERE post_id = p.id 
              GROUP BY reaction
            ) r
          ), 
          '{}'::json
        ) as reaction_summary,
        (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'post' AND c.target_id = p.id AND c.is_deleted = false) as real_comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN stories s ON p.story_id = s.id
      WHERE ${whereClause}
      GROUP BY p.id, u.id, s.id
      ORDER BY ${orderBy}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    values.push(Number(limit), offset);
    const result = await pool.query(dataQuery, values);

    return res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)) || 1,
      },
    });
  } catch (error: any) {
    console.error('getPosts error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPostBySlug = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(
      `SELECT 
        p.*,
        u.username as author_username,
        u.display_name as author_name,
        u.avatar_url as author_avatar,
        COALESCE(json_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '[]') as author_roles,
        s.title as story_title,
        s.slug as story_slug,
        s.cover_image_url as story_cover,
        s.story_type as story_type,
        s.author_name as story_author,
        COALESCE(
          (
            SELECT json_object_agg(reaction, cnt) 
            FROM (
              SELECT reaction, count(*) as cnt 
              FROM post_reactions 
              WHERE post_id = p.id 
              GROUP BY reaction
            ) r
          ), 
          '{}'::json
        ) as reaction_summary,
        (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'post' AND c.target_id = p.id AND c.is_deleted = false) as real_comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN stories s ON p.story_id = s.id
      WHERE p.slug = $1 AND p.is_deleted = false
      GROUP BY p.id, u.id, s.id`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'B\u00e0i vi\u1ebft kh\u00f4ng t\u1ed3n t\u1ea1i ho\u1eb7c \u0111\u00e3 b\u1ecb x\u00f3a.' });
    }

    const post = result.rows[0];

    const currentUser = req.user;
    const userRoles = currentUser?.roles || [];
    const isAdminOrMod = userRoles.includes('admin') || userRoles.includes('mod');
    const isAuthor = !!currentUser && currentUser.id === post.user_id;
    const isVisibleToPublic = post.approval_status === 'approved' && post.is_published;

    if (!isVisibleToPublic && !isAuthor && !isAdminOrMod) {
      return res.status(404).json({ success: false, message: 'Bài viết không tồn tại hoặc đã bị xóa.' });
    }

    // Increment view count asynchronously
    pool.query('UPDATE posts SET view_count = view_count + 1 WHERE id = $1', [post.id]).catch(console.error);

    return res.json({
      success: true,
      data: post,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'B\u1ea1n c\u1ea7n \u0111\u0103ng nh\u1eadp \u0111\u1ec3 \u0111\u0103ng b\u00e0i vi\u1ebft.',
      });
    }

    const authorId = req.user.id;
    const userRoles = req.user.roles || [];
    const isAdminOrMod = userRoles.includes('admin') || userRoles.includes('mod');

    const { 
      title, 
      content, 
      cover_image_url, 
      story_id, 
      is_draft = false,
      images = [] 
    } = req.body;

    if (!title || !title.trim() || !content || !hasRichContent(sanitizeRichText(content))) {
      return res.status(400).json({
        success: false,
        message: 'Ti\u00eau \u0111\u1ec1 v\u00e0 n\u1ed9i dung b\u00e0i vi\u1ebft kh\u00f4ng \u0111\u01b0\u1ee3c \u0111\u1ec3 tr\u1ed1ng.',
      });
    }

    const baseSlug = slugify(title.trim()) || 'bai-viet-fandom';

    let approvalStatus = 'pending';
    let isPublished = false;

    if (is_draft) {
      approvalStatus = 'draft';
      isPublished = false;
    } else if (isAdminOrMod) {
      approvalStatus = 'approved';
      isPublished = true;
    }

    const finalCover = cover_image_url || (Array.isArray(images) && images.length > 0 ? images[0] : null);

    // Slug: the title, or title-2, title-3... when taken (checked against the database)
    const insertRes = await insertWithUniqueSlug(pool, 'posts', baseSlug, (uniqueSlug) => pool.query(
      `INSERT INTO posts (
        user_id, story_id, title, slug, content, 
        cover_image_url, images, is_draft, approval_status, 
        is_published, published_at
      ) VALUES (
        $1, $2, $3, $4, $5, 
        $6, $7::jsonb, $8, $9, 
        $10, CASE WHEN $10 = true THEN NOW() ELSE NULL END
      ) RETURNING *`,
      [
        authorId,
        story_id || null,
        title.trim(),
        uniqueSlug,
        sanitizeRichText(content),
        finalCover,
        JSON.stringify(images || []),
        Boolean(is_draft),
        approvalStatus,
        isPublished
      ]
    ));

    const message = is_draft 
      ? '\u0110\u00e3 l\u01b0u b\u1ea3n nh\u00e1p th\u00e0nh c\u00f4ng!' 
      : isAdminOrMod 
        ? '\u0110\u0103ng b\u00e0i vi\u1ebft th\u00e0nh c\u00f4ng!' 
        : '\u0110\u00e3 g\u1eedi b\u00e0i vi\u1ebft! B\u00e0i vi\u1ebft \u0111ang ch\u1edd Ki\u1ec3m duy\u1ec7t vi\u00ean duy\u1ec7t.';

    return res.status(201).json({
      success: true,
      message,
      data: insertRes.rows[0],
    });
  } catch (error: any) {
    console.error('createPost error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'B\u1ea1n ch\u01b0a \u0111\u0103ng nh\u1eadp. Vui l\u00f2ng \u0111\u0103ng nh\u1eadp \u0111\u1ec3 ch\u1ec9nh s\u1eeda b\u00e0i vi\u1ebft.',
      });
    }

    const { id } = req.params;
    const currentUserId = req.user.id;
    const userRoles = req.user.roles || [];
    const isAdminOrMod = userRoles.includes('admin') || userRoles.includes('mod');

    const checkRes = await pool.query(
      `SELECT * FROM posts WHERE id = $1 AND is_deleted = false`,
      [id]
    );

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'B\u00e0i vi\u1ebft kh\u00f4ng t\u1ed3n t\u1ea1i ho\u1eb7c \u0111\u00e3 b\u1ecb x\u00f3a.' });
    }

    const post = checkRes.rows[0];

    // Strict ownership & permission check
    if (post.user_id !== currentUserId && !isAdminOrMod) {
      return res.status(403).json({
        success: false,
        message: 'B\u1ea1n kh\u00f4ng ph\u1ea3i l\u00e0 ng\u01b0\u1eddi \u0111\u0103ng b\u00e0i vi\u1ebft n\u00e0y v\u00e0 kh\u00f4ng c\u00f3 quy\u1ec1n ch\u1ec9nh s\u1eeda b\u00e0i vi\u1ebft c\u1ee7a ng\u01b0\u1eddi kh\u00e1c.',
      });
    }

    const { 
      title, 
      content, 
      cover_image_url, 
      story_id, 
      is_draft = false,
      images = [] 
    } = req.body;

    if (content !== undefined && content !== null && content !== '' && !hasRichContent(sanitizeRichText(content))) {
      return res.status(400).json({ success: false, message: 'Nội dung bài viết không được để trống.' });
    }

    let approvalStatus = post.approval_status;
    let isPublished = post.is_published;

    if (is_draft) {
      approvalStatus = 'draft';
      isPublished = false;
    } else if (isAdminOrMod) {
      approvalStatus = 'approved';
      isPublished = true;
    } else if (post.approval_status === 'approved' || post.approval_status === 'rejected') {
      approvalStatus = 'pending';
      isPublished = false;
    }

    const finalCover = cover_image_url || (Array.isArray(images) && images.length > 0 ? images[0] : null);

    const updateRes = await pool.query(
      `UPDATE posts SET
        title = COALESCE($1, title),
        content = COALESCE($2, content),
        cover_image_url = $3,
        story_id = $4,
        images = $5::jsonb,
        is_draft = $6,
        approval_status = $7,
        is_published = $8,
        updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        title ? title.trim() : null,
        content ? sanitizeRichText(content) : null,
        finalCover,
        story_id || null,
        JSON.stringify(images || []),
        Boolean(is_draft),
        approvalStatus,
        isPublished,
        id
      ]
    );

    return res.json({
      success: true,
      message: 'C\u1eadp nh\u1eadt b\u00e0i vi\u1ebft th\u00e0nh c\u00f4ng!',
      data: updateRes.rows[0],
    });
  } catch (error: any) {
    console.error('updatePost error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'B\u1ea1n ch\u01b0a \u0111\u0103ng nh\u1eadp. Vui l\u00f2ng \u0111\u0103ng nh\u1eadp \u0111\u1ec3 th\u1ef1c hi\u1ec7n x\u00f3a.',
      });
    }

    const { id } = req.params;
    const currentUserId = req.user.id;
    const userRoles = req.user.roles || [];
    const isAdminOrMod = userRoles.includes('admin') || userRoles.includes('mod');

    const checkRes = await pool.query(`SELECT id, user_id FROM posts WHERE id = $1 AND is_deleted = false`, [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'B\u00e0i vi\u1ebft kh\u00f4ng t\u1ed3n t\u1ea1i ho\u1eb7c \u0111\u00e3 b\u1ecb x\u00f3a.' });
    }

    const post = checkRes.rows[0];

    // Strict ownership & permission check
    if (post.user_id !== currentUserId && !isAdminOrMod) {
      return res.status(403).json({
        success: false,
        message: 'B\u1ea1n kh\u00f4ng c\u00f3 quy\u1ec1n x\u00f3a b\u00e0i vi\u1ebft n\u00e0y. Ch\u1ec9 t\u00e1c gi\u1ea3 b\u00e0i vi\u1ebft ho\u1eb7c Admin/Mod m\u1edbi c\u00f3 quy\u1ec1n x\u00f3a.',
      });
    }

    await pool.query(`UPDATE posts SET is_deleted = true, updated_at = NOW() WHERE id = $1`, [id]);

    return res.json({
      success: true,
      message: '\u0110\u00e3 x\u00f3a b\u00e0i vi\u1ebft th\u00e0nh c\u00f4ng!',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approvePost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'B\u1ea1n ch\u01b0a \u0111\u0103ng nh\u1eadp.' });
    }

    const userRoles = req.user.roles || [];
    if (!userRoles.includes('admin') && !userRoles.includes('mod')) {
      return res.status(403).json({
        success: false,
        message: 'Ch\u1ec9 Qu\u1ea3n tr\u1ecb vi\u00ean (Admin) ho\u1eb7c Ki\u1ec3m duy\u1ec7t vi\u00ean (Mod) m\u1edbi c\u00f3 quy\u1ec1n duy\u1ec7t b\u00e0i vi\u1ebft.',
      });
    }

    const { id } = req.params;
    const adminId = req.user.id;

    const updateRes = await pool.query(
      `UPDATE posts SET
        approval_status = 'approved',
        approved_by = $1,
        approved_at = NOW(),
        is_published = true,
        published_at = COALESCE(published_at, NOW()),
        updated_at = NOW()
       WHERE id = $2 AND is_deleted = false
       RETURNING *`,
      [adminId, id]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'B\u00e0i vi\u1ebft kh\u00f4ng t\u1ed3n t\u1ea1i.' });
    }

    enqueueNotificationJob({ kind: 'notify', items: postReviewNotifications(updateRes.rows, true, adminId) })
      .catch((err: any) => console.error('[Notification] enqueue failed:', err.message));

    return res.json({
      success: true,
      message: '\u0110\u00e3 duy\u1ec7t b\u00e0i vi\u1ebft th\u00e0nh c\u00f4ng!',
      data: updateRes.rows[0],
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectPost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'B\u1ea1n ch\u01b0a \u0111\u0103ng nh\u1eadp.' });
    }

    const userRoles = req.user.roles || [];
    if (!userRoles.includes('admin') && !userRoles.includes('mod')) {
      return res.status(403).json({
        success: false,
        message: 'Ch\u1ec9 Qu\u1ea3n tr\u1ecb vi\u00ean (Admin) ho\u1eb7c Ki\u1ec3m duy\u1ec7t vi\u00ean (Mod) m\u1edbi c\u00f3 quy\u1ec1n t\u1eeb ch\u1ed1i b\u00e0i vi\u1ebft.',
      });
    }

    const { id } = req.params;

    const rejectRes = await pool.query(
      `UPDATE posts SET 
        approval_status = 'rejected',
        is_published = false,
        updated_at = NOW()
       WHERE id = $1 AND is_deleted = false
       RETURNING id, user_id, title`,
      [id]
    );

    enqueueNotificationJob({ kind: 'notify', items: postReviewNotifications(rejectRes.rows, false, req.user.id) })
      .catch((err: any) => console.error('[Notification] enqueue failed:', err.message));

    return res.json({
      success: true,
      message: '\u0110\u00e3 t\u1eeb ch\u1ed1i b\u00e0i vi\u1ebft!',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Batch / Bulk approval for Admin & Mod
export const bulkApprovePosts = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'B\u1ea1n ch\u01b0a \u0111\u0103ng nh\u1eadp.' });
    }

    const userRoles = req.user.roles || [];
    if (!userRoles.includes('admin') && !userRoles.includes('mod')) {
      return res.status(403).json({
        success: false,
        message: 'Ch\u1ec9 Qu\u1ea3n tr\u1ecb vi\u00ean (Admin) ho\u1eb7c Ki\u1ec3m duy\u1ec7t vi\u00ean (Mod) m\u1edbi c\u00f3 quy\u1ec1n duy\u1ec7t b\u00e0i vi\u1ebft.',
      });
    }

    const { ids, post_ids } = req.body;
    const targetIds: string[] = ids || post_ids || [];

    if (!Array.isArray(targetIds) || targetIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vui l\u00f2ng ch\u1ecdn \u00edt nh\u1ea5t m\u1ed9t b\u00e0i vi\u1ebft \u0111\u1ec3 duy\u1ec7t.',
      });
    }

    const adminId = req.user.id;

    const updateRes = await pool.query(
      `UPDATE posts SET
        approval_status = 'approved',
        approved_by = $1,
        approved_at = NOW(),
        is_published = true,
        published_at = COALESCE(published_at, NOW()),
        updated_at = NOW()
       WHERE id = ANY($2::uuid[]) AND is_deleted = false
       RETURNING id, user_id, title`,
      [adminId, targetIds]
    );

    enqueueNotificationJob({ kind: 'notify', items: postReviewNotifications(updateRes.rows, true, adminId) })
      .catch((err: any) => console.error('[Notification] enqueue failed:', err.message));

    return res.json({
      success: true,
      message: `\u0110\u00e3 duy\u1ec7t th\u00e0nh c\u00f4ng ${updateRes.rowCount} b\u00e0i vi\u1ebft!`,
      count: updateRes.rowCount,
    });
  } catch (error: any) {
    console.error('bulkApprovePosts error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Batch / Bulk rejection for Admin & Mod
export const bulkRejectPosts = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'B\u1ea1n ch\u01b0a \u0111\u0103ng nh\u1eadp.' });
    }

    const userRoles = req.user.roles || [];
    if (!userRoles.includes('admin') && !userRoles.includes('mod')) {
      return res.status(403).json({
        success: false,
        message: 'Ch\u1ec9 Qu\u1ea3n tr\u1ecb vi\u00ean (Admin) ho\u1eb7c Ki\u1ec3m duy\u1ec7t vi\u00ean (Mod) m\u1edbi c\u00f3 quy\u1ec1n t\u1eeb ch\u1ed1i b\u00e0i vi\u1ebft.',
      });
    }

    const { ids, post_ids } = req.body;
    const targetIds: string[] = ids || post_ids || [];

    if (!Array.isArray(targetIds) || targetIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vui l\u00f2ng ch\u1ecdn \u00edt nh\u1ea5t m\u1ed9t b\u00e0i vi\u1ebft \u0111\u1ec3 t\u1eeb ch\u1ed1i.',
      });
    }

    const updateRes = await pool.query(
      `UPDATE posts SET
        approval_status = 'rejected',
        is_published = false,
        updated_at = NOW()
       WHERE id = ANY($1::uuid[]) AND is_deleted = false
       RETURNING id, user_id, title`,
      [targetIds]
    );

    enqueueNotificationJob({ kind: 'notify', items: postReviewNotifications(updateRes.rows, false, req.user.id) })
      .catch((err: any) => console.error('[Notification] enqueue failed:', err.message));

    return res.json({
      success: true,
      message: `\u0110\u00e3 t\u1eeb ch\u1ed1i ${updateRes.rowCount} b\u00e0i vi\u1ebft!`,
      count: updateRes.rowCount,
    });
  } catch (error: any) {
    console.error('bulkRejectPosts error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reactToPost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'B\u1ea1n ch\u01b0a \u0111\u0103ng nh\u1eadp' });
    }

    const { id } = req.params;
    const authorId = req.user.id;
    const { reaction } = req.body;

    const validReactions = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
    if (!validReactions.includes(reaction)) {
      return res.status(400).json({ success: false, message: 'C\u1ea3m x\u00fac kh\u00f4ng h\u1ee3p l\u1ec7' });
    }

    const postRes = await pool.query(
      `SELECT user_id, title, approval_status, is_published FROM posts WHERE id = $1 AND is_deleted = false`,
      [id]
    );
    if (postRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'B\u00e0i vi\u1ebft kh\u00f4ng t\u1ed3n t\u1ea1i ho\u1eb7c \u0111\u00e3 b\u1ecb x\u00f3a.' });
    }
    const targetPost = postRes.rows[0];
    const userRoles = req.user.roles || [];
    const isAdminOrMod = userRoles.includes('admin') || userRoles.includes('mod');
    const isPostVisible = targetPost.approval_status === 'approved' && targetPost.is_published;
    if (!isPostVisible && targetPost.user_id !== authorId && !isAdminOrMod) {
      return res.status(404).json({ success: false, message: 'B\u00e0i vi\u1ebft kh\u00f4ng t\u1ed3n t\u1ea1i ho\u1eb7c \u0111\u00e3 b\u1ecb x\u00f3a.' });
    }

    const existing = await pool.query(
      `SELECT * FROM post_reactions WHERE post_id = $1 AND user_id = $2`,
      [id, authorId]
    );

    let action = 'added';
    if (existing.rows.length > 0) {
      if (existing.rows[0].reaction === reaction) {
        await pool.query(`DELETE FROM post_reactions WHERE post_id = $1 AND user_id = $2`, [id, authorId]);
        action = 'removed';
      } else {
        await pool.query(`UPDATE post_reactions SET reaction = $1::reaction_type WHERE post_id = $2 AND user_id = $3`, [reaction, id, authorId]);
        action = 'changed';
      }
    } else {
      await pool.query(`INSERT INTO post_reactions (post_id, user_id, reaction) VALUES ($1, $2, $3::reaction_type)`, [id, authorId, reaction]);
      action = 'added';
    }

    await pool.query(`
      UPDATE posts 
      SET reaction_count = (SELECT count(*) FROM post_reactions WHERE post_id = $1)
      WHERE id = $1
    `, [id]);

    if (action !== 'removed') {
      enqueueNotificationJob({
        kind: 'notify',
        items: postReactionNotification({
          postId: id,
          postTitle: targetPost.title,
          postOwnerId: targetPost.user_id,
          actorId: authorId,
          actorName: req.user.display_name || req.user.username,
          reaction,
        }),
      }).catch((err: any) => console.error('[Notification] enqueue failed:', err.message));
    }

    const summaryRes = await pool.query(`
      SELECT 
        (SELECT count(*) FROM post_reactions WHERE post_id = $1) as reaction_count,
        COALESCE(
          (
            SELECT json_object_agg(reaction, count)
            FROM (
              SELECT reaction, count(*) as count
              FROM post_reactions
              WHERE post_id = $1
              GROUP BY reaction
            ) r_sub
          ), '{}'::json
        ) as reaction_summary
    `, [id]);

    return res.json({
      success: true,
      action,
      data: summaryRes.rows[0],
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};