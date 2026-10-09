import { Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sanitizeRichText, hasRichContent } from '../utils/richText';
import { enqueueNotificationJob } from '../services/queue.service';
import { insertWithUniqueSlug } from '../utils/ids';
import { InputError, isUuid, optionalEnum, optionalText, optionalUrl } from '../utils/validation';
import { clientDbError } from '../utils/dbErrors';
import { postReactionNotification, postReviewNotifications } from '../services/notification.service';

export const POST_CATEGORIES = ['discussion', 'review', 'fanart', 'theory', 'news', 'question'] as const;
const MAX_IMAGES = 10;

function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const isStaff = (req: AuthenticatedRequest) => {
  const roles = req.user?.roles || [];
  return roles.includes('admin') || roles.includes('mod');
};

const fail = (res: Response, error: any, label: string) => {
  if (error instanceof InputError) return res.status(error.status).json({ success: false, message: error.message });
  const clientErr = clientDbError(error);
  if (clientErr) return res.status(clientErr.status).json({ success: false, message: clientErr.message });
  console.error(`${label} error:`, error);
  return res.status(500).json({ success: false, message: error.message });
};

/** Post columns + author, linked story, reaction summary and the viewer's own reaction ($1 = viewer id or null). */
const POST_SELECT = `
  SELECT
    p.*,
    u.username AS author_username,
    u.display_name AS author_name,
    u.avatar_url AS author_avatar,
    COALESCE((SELECT json_agg(ur.role) FROM user_roles ur WHERE ur.user_id = u.id), '[]') AS author_roles,
    s.title AS story_title,
    s.slug AS story_slug,
    s.cover_image_url AS story_cover,
    s.story_type AS story_type,
    s.author_name AS story_author,
    COALESCE((
      SELECT json_object_agg(reaction, cnt) FROM (
        SELECT reaction, count(*) AS cnt FROM post_reactions WHERE post_id = p.id GROUP BY reaction
      ) r
    ), '{}'::json) AS reaction_summary,
    (SELECT pr.reaction FROM post_reactions pr WHERE pr.post_id = p.id AND pr.user_id = $1::uuid) AS my_reaction,
    (SELECT COUNT(*)::int FROM comments c WHERE c.target_type = 'post' AND c.target_id = p.id AND c.is_deleted = false) AS real_comment_count,
    EXISTS (SELECT 1 FROM post_notification_mutes m WHERE m.post_id = p.id AND m.user_id = $1::uuid) AS notifications_muted
  FROM posts p
  JOIN users u ON p.user_id = u.id
  LEFT JOIN stories s ON p.story_id = s.id`;

/** Only the author and staff see why a post was refused. */
function hidePrivate<T extends { user_id: string; rejection_reason?: string | null }>(post: T, req: AuthenticatedRequest): T {
  if (req.user?.id !== post.user_id && !isStaff(req)) post.rejection_reason = null;
  return post;
}

/** Validated post fields from a request body; `partial` leaves out what wasn't sent. */
async function readPostBody(body: any, partial: boolean) {
  const out: {
    title?: string; content?: string; category?: string; story_id?: string | null; images?: string[]; is_draft?: boolean;
  } = {};

  if (!partial || body.title !== undefined) {
    const title = optionalText(body.title, 200, 'Tiêu đề');
    if (!title) throw new InputError('Tiêu đề bài viết không được để trống.');
    out.title = title;
  }
  if (!partial || body.content !== undefined) {
    if (typeof body.content !== 'string') throw new InputError('Nội dung bài viết không được để trống.');
    const content = sanitizeRichText(body.content) || '';
    if (!hasRichContent(content)) throw new InputError('Nội dung bài viết không được để trống.');
    if (content.length > 100_000) throw new InputError('Nội dung bài viết quá dài.');
    out.content = content;
  }
  if (!partial || body.category !== undefined) {
    out.category = optionalEnum(body.category, POST_CATEGORIES, 'Chuyên mục') || 'discussion';
  }
  if (!partial || body.story_id !== undefined) {
    if (body.story_id === null || body.story_id === '' || body.story_id === undefined) out.story_id = null;
    else {
      if (!isUuid(body.story_id)) throw new InputError('Truyện được gắn không hợp lệ.');
      const s = await pool.query(`SELECT 1 FROM stories WHERE id = $1 AND approval_status = 'approved'`, [body.story_id]);
      if (s.rows.length === 0) throw new InputError('Truyện được gắn không tồn tại.');
      out.story_id = body.story_id;
    }
  }
  if (!partial || body.images !== undefined) {
    const list = body.images ?? [];
    if (!Array.isArray(list)) throw new InputError('Danh sách ảnh không hợp lệ.');
    if (list.length > MAX_IMAGES) throw new InputError(`Mỗi bài viết tối đa ${MAX_IMAGES} ảnh.`);
    out.images = list.map((u: unknown) => optionalUrl(u, 'Ảnh')).filter(Boolean) as string[];
  }
  if (!partial || body.is_draft !== undefined) out.is_draft = body.is_draft === true;
  return out;
}

// ------------------------------------------------------------------ read

export const getPosts = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { story_id, sort = 'newest', q, filter_status, category } = req.query;
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit)) || 20));
    const offset = (page - 1) * limit;

    const viewerId = req.user?.id || null;
    // $1 is always the viewer (used for "my_reaction"); referenced here so the count query can type it
    const conditions: string[] = ['p.is_deleted = false', '($1::uuid IS NULL OR TRUE)'];
    const values: any[] = [viewerId];
    const add = (sql: (n: number) => string, v: any) => { values.push(v); conditions.push(sql(values.length)); };
    const empty = () => res.json({ success: true, data: [], pagination: { page, limit, total: 0, totalPages: 1 } });

    let publicFeed = false;
    if (filter_status === 'pending') {
      if (!isStaff(req)) {
        return res.status(403).json({ success: false, message: 'Chỉ Quản trị viên hoặc Kiểm duyệt viên mới có thể xem hàng chờ duyệt.' });
      }
      conditions.push("p.approval_status = 'pending'");
    } else if (filter_status === 'drafts') {
      if (!viewerId) return empty();
      add((n) => `p.user_id = $${n}`, viewerId);
      conditions.push('p.is_draft = true');
    } else if (filter_status === 'mine') {
      if (!viewerId) return empty();
      add((n) => `p.user_id = $${n}`, viewerId);
      conditions.push('p.is_draft = false');
    } else {
      publicFeed = true;
      conditions.push('p.is_published = true', "p.approval_status = 'approved'");
    }

    if (story_id) {
      if (!isUuid(story_id)) return empty();
      add((n) => `p.story_id = $${n}`, story_id);
    }
    if (category && category !== 'all') {
      if (!POST_CATEGORIES.includes(category as any)) return empty();
      add((n) => `p.category = $${n}`, category);
    }
    if (typeof q === 'string' && q.trim()) {
      add((n) => `(p.title ILIKE $${n} OR p.content ILIKE $${n})`, `%${q.trim().slice(0, 100)}%`);
    }

    // "hot": engagement that fades with age (Hacker News style)
    const HOT = `((p.reaction_count + 2 * p.comment_count + p.view_count / 50.0 + 1)
                 / power(EXTRACT(EPOCH FROM (NOW() - COALESCE(p.published_at, p.created_at))) / 3600 + 2, 1.3))`;
    const orders: Record<string, string> = {
      newest: 'COALESCE(p.published_at, p.created_at) DESC',
      hot: `${HOT} DESC`,
      popular: `${HOT} DESC`, // old name for "hot"
      top: 'p.reaction_count DESC, p.comment_count DESC, p.published_at DESC',
      views: 'p.view_count DESC, p.published_at DESC',
    };
    let orderBy = orders[String(sort)] || orders.newest;
    // pinned posts head the main feed (not searches or filtered views)
    if (publicFeed && !q && !story_id && (!category || category === 'all')) orderBy = `p.is_pinned DESC, ${orderBy}`;

    const whereClause = conditions.join(' AND ');
    const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM posts p WHERE ${whereClause}`, values);
    const total = countRes.rows[0].n;

    const result = await pool.query(
      `${POST_SELECT} WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
      values,
    );

    return res.json({
      success: true,
      data: result.rows.map((p) => hidePrivate(p, req)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error: any) {
    return fail(res, error, 'getPosts');
  }
};

export const getPostBySlug = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(`${POST_SELECT} WHERE p.slug = $2 AND p.is_deleted = false`, [req.user?.id || null, req.params.slug]);
    const post = result.rows[0];
    const isAuthor = !!post && req.user?.id === post.user_id;
    const visible = post && post.approval_status === 'approved' && post.is_published;
    if (!post || (!visible && !isAuthor && !isStaff(req))) {
      return res.status(404).json({ success: false, message: 'Bài viết không tồn tại hoặc đã bị xóa.' });
    }
    if (visible) pool.query('UPDATE posts SET view_count = view_count + 1 WHERE id = $1', [post.id]).catch(console.error);
    return res.json({ success: true, data: hidePrivate(post, req) });
  } catch (error: any) {
    return fail(res, error, 'getPostBySlug');
  }
};

/**
 * GET /posts/sidebar : the real data for the fandom sidebars.
 *  - leaderboard: most active members of the last 30 days (posts, reactions and comments received)
 *  - stories: stories with the most approved discussions
 *  - counts: the viewer's drafts / posts, and the moderation queue for staff
 */
export const getFandomSidebar = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const viewerId = req.user?.id || null;
    const [leaders, stories, counts] = await Promise.all([
      pool.query(`
        SELECT u.username, u.display_name, u.avatar_url,
          COALESCE((SELECT json_agg(ur.role) FROM user_roles ur WHERE ur.user_id = u.id), '[]') AS roles,
          count(p.id)::int AS posts,
          COALESCE(sum(p.reaction_count), 0)::int AS reactions,
          COALESCE(sum(p.comment_count), 0)::int AS comments
        FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.is_deleted = false AND p.approval_status = 'approved' AND p.is_published
          AND p.published_at > NOW() - INTERVAL '30 days'
          AND u.deleted_at IS NULL AND COALESCE(u.is_banned, false) = false
        GROUP BY u.id
        ORDER BY count(p.id) * 3 + COALESCE(sum(p.reaction_count), 0) + COALESCE(sum(p.comment_count), 0) * 2 DESC
        LIMIT 5`),
      pool.query(`
        SELECT s.id, s.title, s.slug, s.cover_image_url, s.story_type, count(p.id)::int AS post_count
        FROM posts p JOIN stories s ON s.id = p.story_id
        WHERE p.is_deleted = false AND p.approval_status = 'approved' AND p.is_published AND s.approval_status = 'approved'
        GROUP BY s.id
        ORDER BY count(p.id) DESC, max(p.published_at) DESC
        LIMIT 12`),
      pool.query(`
        SELECT
          (SELECT count(*)::int FROM posts WHERE is_deleted = false AND approval_status = 'pending') AS pending,
          (SELECT count(*)::int FROM posts WHERE is_deleted = false AND is_draft AND user_id = $1::uuid) AS drafts,
          (SELECT count(*)::int FROM posts WHERE is_deleted = false AND NOT is_draft AND user_id = $1::uuid) AS mine,
          (SELECT count(*)::int FROM posts WHERE is_deleted = false AND approval_status = 'approved' AND is_published) AS total`,
        [viewerId]),
    ]);
    const c = counts.rows[0];
    return res.json({
      success: true,
      data: {
        leaderboard: leaders.rows,
        stories: stories.rows,
        counts: { total: c.total, drafts: viewerId ? c.drafts : 0, mine: viewerId ? c.mine : 0, pending: isStaff(req) ? c.pending : null },
      },
    });
  } catch (error: any) {
    return fail(res, error, 'getFandomSidebar');
  }
};

// ------------------------------------------------------------------ write

export const createPost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: 'Bạn cần đăng nhập để đăng bài viết.' });
    const f = await readPostBody(req.body || {}, false);
    const staff = isStaff(req);
    // posts go live immediately; moderators can still hide them (reject) afterwards
    const status = f.is_draft ? 'draft' : 'approved';
    const published = status === 'approved';

    const insertRes = await insertWithUniqueSlug(pool, 'posts', slugify(f.title!) || 'bai-viet-fandom', (slug) => pool.query(
      `INSERT INTO posts (user_id, story_id, title, slug, content, category, cover_image_url, images, is_draft,
                          approval_status, is_published, published_at, approved_by, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11,
               CASE WHEN $11 THEN NOW() END, $12::uuid, CASE WHEN $11 THEN NOW() END)
       RETURNING *`,
      [req.user!.id, f.story_id, f.title, slug, f.content, f.category, f.images![0] || null, JSON.stringify(f.images),
        f.is_draft, status, published, published && staff ? req.user!.id : null],
    ));

    const message = f.is_draft ? 'Đã lưu bản nháp.' : 'Đã đăng bài viết.';
    return res.status(201).json({ success: true, message, data: insertRes.rows[0] });
  } catch (error: any) {
    return fail(res, error, 'createPost');
  }
};

/** Only the fields sent are changed. Edits publish immediately, except on a post a moderator hid. */
export const updatePost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    if (!isUuid(req.params.id)) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại.' });
    const checkRes = await pool.query(`SELECT * FROM posts WHERE id = $1 AND is_deleted = false`, [req.params.id]);
    const post = checkRes.rows[0];
    if (!post) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại hoặc đã bị xóa.' });
    const staff = isStaff(req);
    if (post.user_id !== req.user.id && !staff) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền chỉnh sửa bài viết của người khác.' });
    }

    const f = await readPostBody(req.body || {}, true);
    const draft = f.is_draft ?? post.is_draft;
    let status: string = post.approval_status;
    if (draft) status = 'draft';
    else if (staff) status = 'approved';
    // a post hidden by a moderator goes to them for another look when its author edits it;
    // everything else is published straight away
    else if (status === 'rejected' || status === 'pending') status = 'pending';
    else status = 'approved';
    const published = status === 'approved';

    const updateRes = await pool.query(
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
    );

    const message = draft ? 'Đã lưu bản nháp.'
      : status === 'pending' ? 'Đã cập nhật! Bài viết được gửi lại để Ban quản trị duyệt.'
        : 'Đã cập nhật bài viết.';
    return res.json({ success: true, message, data: updateRes.rows[0] });
  } catch (error: any) {
    return fail(res, error, 'updatePost');
  }
};

export const deletePost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    if (!isUuid(req.params.id)) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại.' });
    const checkRes = await pool.query(`SELECT id, user_id FROM posts WHERE id = $1 AND is_deleted = false`, [req.params.id]);
    const post = checkRes.rows[0];
    if (!post) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại hoặc đã bị xóa.' });
    if (post.user_id !== req.user.id && !isStaff(req)) {
      return res.status(403).json({ success: false, message: 'Chỉ tác giả bài viết hoặc Admin/Mod mới có quyền xóa.' });
    }
    await pool.query(`UPDATE posts SET is_deleted = true, is_pinned = false, updated_at = NOW() WHERE id = $1`, [post.id]);
    return res.json({ success: true, message: 'Đã xóa bài viết.' });
  } catch (error: any) {
    return fail(res, error, 'deletePost');
  }
};

// ------------------------------------------------------------------ moderation

const requireStaff = (req: AuthenticatedRequest, res: Response) => {
  if (!req.user?.id) { res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' }); return false; }
  if (!isStaff(req)) { res.status(403).json({ success: false, message: 'Chỉ Admin hoặc Mod mới làm được thao tác này.' }); return false; }
  return true;
};

const targetIdsOf = (req: AuthenticatedRequest): string[] => {
  const ids = req.params.id ? [req.params.id] : (req.body?.post_ids || req.body?.ids || []);
  if (!Array.isArray(ids) || ids.length === 0) throw new InputError('Vui lòng chọn ít nhất một bài viết.');
  if (ids.length > 100) throw new InputError('Mỗi lần xử lý tối đa 100 bài viết.');
  if (!ids.every(isUuid)) throw new InputError('Danh sách bài viết không hợp lệ.');
  return ids;
};

async function review(req: AuthenticatedRequest, res: Response, approve: boolean) {
  try {
    if (!requireStaff(req, res)) return;
    const ids = targetIdsOf(req);
    const reason = approve ? null : optionalText(req.body?.reason, 500, 'Lý do') ?? null;
    const rows = (approve
      ? await pool.query(
        `UPDATE posts SET approval_status = 'approved', approved_by = $1, approved_at = NOW(), is_published = true, is_draft = false,
           published_at = COALESCE(published_at, NOW()), rejection_reason = NULL, updated_at = NOW()
         WHERE id = ANY($2::uuid[]) AND is_deleted = false AND approval_status <> 'draft'
         RETURNING id, user_id, title`, [req.user!.id, ids])
      : await pool.query(
        `UPDATE posts SET approval_status = 'rejected', is_published = false, is_pinned = false, rejection_reason = $2, updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND is_deleted = false AND approval_status <> 'draft'
         RETURNING id, user_id, title`, [ids, reason])).rows;

    enqueueNotificationJob({ kind: 'notify', items: postReviewNotifications(rows, approve, req.user!.id, reason) })
      .catch((err: any) => console.error('[Notification] enqueue failed:', err.message));

    if (req.params.id && rows.length === 0) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại.' });
    return res.json({
      success: true,
      count: rows.length,
      message: approve ? `Đã duyệt ${rows.length} bài viết.` : `Đã từ chối ${rows.length} bài viết.`,
    });
  } catch (error: any) {
    return fail(res, error, approve ? 'approvePost' : 'rejectPost');
  }
}

export const approvePost = (req: AuthenticatedRequest, res: Response) => review(req, res, true);
export const rejectPost = (req: AuthenticatedRequest, res: Response) => review(req, res, false);
export const bulkApprovePosts = (req: AuthenticatedRequest, res: Response) => review(req, res, true);
export const bulkRejectPosts = (req: AuthenticatedRequest, res: Response) => review(req, res, false);

/** POST /posts/:id/pin (staff): pin / unpin a published post at the top of the feed. */
export const togglePinPost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!requireStaff(req, res)) return;
    if (!isUuid(req.params.id)) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại.' });
    const r = await pool.query(
      `UPDATE posts SET is_pinned = NOT is_pinned WHERE id = $1 AND is_deleted = false AND approval_status = 'approved'
       RETURNING is_pinned`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Chỉ ghim được bài viết đã duyệt.' });
    return res.json({ success: true, is_pinned: r.rows[0].is_pinned, message: r.rows[0].is_pinned ? 'Đã ghim bài viết.' : 'Đã bỏ ghim.' });
  } catch (error: any) {
    return fail(res, error, 'togglePinPost');
  }
};

/** POST /posts/:id/mute : stop / resume notifications about this post (comments, replies, reactions). */
export const togglePostMute = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    if (!isUuid(req.params.id)) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại.' });
    const removed = await pool.query(`DELETE FROM post_notification_mutes WHERE user_id = $1 AND post_id = $2 RETURNING 1`, [req.user.id, req.params.id]);
    if (removed.rows.length > 0) {
      return res.json({ success: true, muted: false, message: 'Đã bật lại thông báo cho bài viết này.' });
    }
    await pool.query(
      `INSERT INTO post_notification_mutes (user_id, post_id) SELECT $1, id FROM posts WHERE id = $2 AND is_deleted = false ON CONFLICT DO NOTHING`,
      [req.user.id, req.params.id]);
    return res.json({ success: true, muted: true, message: 'Đã tắt thông báo về bài viết này.' });
  } catch (error: any) {
    return fail(res, error, 'togglePostMute');
  }
};

// ------------------------------------------------------------------ reactions

export const reactToPost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập' });
    const { id } = req.params;
    const userId = req.user.id;
    const { reaction } = req.body || {};
    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại.' });
    if (!['like', 'love', 'haha', 'wow', 'sad', 'angry'].includes(reaction)) {
      return res.status(400).json({ success: false, message: 'Cảm xúc không hợp lệ' });
    }

    const postRes = await pool.query(`SELECT user_id, title, approval_status, is_published FROM posts WHERE id = $1 AND is_deleted = false`, [id]);
    const target = postRes.rows[0];
    const visible = target && target.approval_status === 'approved' && target.is_published;
    if (!target || (!visible && target.user_id !== userId && !isStaff(req))) {
      return res.status(404).json({ success: false, message: 'Bài viết không tồn tại hoặc đã bị xóa.' });
    }

    const existing = await pool.query(`SELECT reaction FROM post_reactions WHERE post_id = $1 AND user_id = $2`, [id, userId]);
    let action: 'added' | 'changed' | 'removed' = 'added';
    if (existing.rows.length > 0) {
      if (existing.rows[0].reaction === reaction) {
        await pool.query(`DELETE FROM post_reactions WHERE post_id = $1 AND user_id = $2`, [id, userId]);
        action = 'removed';
      } else {
        await pool.query(`UPDATE post_reactions SET reaction = $1::reaction_type WHERE post_id = $2 AND user_id = $3`, [reaction, id, userId]);
        action = 'changed';
      }
    } else {
      await pool.query(`INSERT INTO post_reactions (post_id, user_id, reaction) VALUES ($1, $2, $3::reaction_type)`, [id, userId, reaction]);
    }
    await pool.query(`UPDATE posts SET reaction_count = (SELECT count(*) FROM post_reactions WHERE post_id = $1) WHERE id = $1`, [id]);

    if (action !== 'removed') {
      enqueueNotificationJob({
        kind: 'notify',
        items: postReactionNotification({
          postId: id, postTitle: target.title, postOwnerId: target.user_id, actorId: userId,
          actorName: req.user.display_name || req.user.username, reaction,
        }),
      }).catch((err: any) => console.error('[Notification] enqueue failed:', err.message));
    }

    const summaryRes = await pool.query(`
      SELECT (SELECT count(*)::int FROM post_reactions WHERE post_id = $1) AS reaction_count,
        COALESCE((SELECT json_object_agg(reaction, n) FROM (
          SELECT reaction, count(*) AS n FROM post_reactions WHERE post_id = $1 GROUP BY reaction) r), '{}'::json) AS reaction_summary`, [id]);
    return res.json({ success: true, action, data: { ...summaryRes.rows[0], my_reaction: action === 'removed' ? null : reaction } });
  } catch (error: any) {
    return fail(res, error, 'reactToPost');
  }
};
