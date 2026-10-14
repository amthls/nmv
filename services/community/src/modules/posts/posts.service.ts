import { Response } from 'express';
import { pool } from './config';
import { AuthedRequest, isStaff } from './auth';
import { sanitizeRichText, hasRichContent } from './richText';
import { InputError, isUuid, optionalEnum, optionalText, optionalUrl } from './validation';
import { clientDbError } from './dbErrors';
import { profiles, stories } from './backend';
import { notify, postReactionNotification, postReviewNotifications } from './notify';

// Moved from the backend's post.controller.ts (Plan/community.md): same routes and JSON under /api/community.

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

/** Insert with the first free slug (`base`, `base-2`, ...), retrying when another request took it meanwhile. */
async function insertWithUniqueSlug<T>(base: string, insert: (slug: string) => Promise<T>): Promise<T> {
  const clean = base.slice(0, 480).replace(/-+$/, '') || 'bai-viet-fandom';
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = new Set((await pool.query(`SELECT slug FROM posts WHERE slug = $1 OR slug LIKE $2`, [clean, `${clean}-%`])).rows.map((r: any) => r.slug));
    let slug = clean;
    for (let n = 2; taken.has(slug); n++) slug = `${clean}-${n}`;
    try {
      return await insert(slug);
    } catch (err: any) {
      if (err?.code === '23505' && String(err.constraint || '').includes('slug')) continue;
      throw err;
    }
  }
  throw new Error(`Không tìm được slug trống cho "${base}"`);
}

export const fail = (res: Response, error: any, label: string) => {
  if (error instanceof InputError) return res.status(error.status).json({ success: false, message: error.message });
  const clientErr = clientDbError(error);
  if (clientErr) return res.status(clientErr.status).json({ success: false, message: clientErr.message });
  console.error(`${label} error:`, error);
  return res.status(500).json({ success: false, message: error.message });
};

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

/** Adds the author and the linked story fields the backend's JOINs used to give. */
async function withPeople(rows: any[]) {
  const [people, linked] = await Promise.all([profiles(rows.map((p) => p.user_id)), stories(rows.map((p) => p.story_id))]);
  return rows.map((p) => {
    const u = people.get(p.user_id);
    const s = linked.get(p.story_id);
    return {
      ...p,
      author_username: u?.username ?? null, author_name: u ? u.display_name : 'Người dùng đã xóa',
      author_avatar: u?.avatar_url ?? null, author_roles: u?.roles ?? [],
      story_title: s?.title ?? null, story_slug: s?.slug ?? null, story_cover: s?.cover_image_url ?? null,
      story_type: s?.story_type ?? null, story_author: s?.author_name ?? null,
    };
  });
}

/** Only the author and staff see why a post was refused. */
function hidePrivate<T extends { user_id: string; rejection_reason?: string | null }>(post: T, req: AuthedRequest): T {
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
      const s = (await stories([body.story_id])).get(body.story_id);
      if (!s || s.approval_status !== 'approved') throw new InputError('Truyện được gắn không tồn tại.');
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

export const getPosts = async (req: AuthedRequest, res: Response) => {
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
    if (filter_status === 'drafts') {
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

    const result = await pool.query(`${POST_SELECT} WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, values);

    return res.json({
      success: true,
      data: (await withPeople(result.rows)).map((p) => hidePrivate(p, req)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error: any) {
    return fail(res, error, 'getPosts');
  }
};

export const getPostBySlug = async (req: AuthedRequest, res: Response) => {
  try {
    const result = await pool.query(`${POST_SELECT} WHERE p.slug = $2 AND p.is_deleted = false`, [req.user?.id || null, req.params.slug]);
    const post = result.rows[0];
    const isAuthor = !!post && req.user?.id === post.user_id;
    const visible = post && post.approval_status === 'approved' && post.is_published;
    if (!post || (!visible && !isAuthor && !isStaff(req))) {
      return res.status(404).json({ success: false, message: 'Bài viết không tồn tại hoặc đã bị xóa.' });
    }
    if (visible) pool.query('UPDATE posts SET view_count = view_count + 1 WHERE id = $1', [post.id]).catch(console.error);
    return res.json({ success: true, data: hidePrivate((await withPeople([post]))[0], req) });
  } catch (error: any) {
    return fail(res, error, 'getPostBySlug');
  }
};

/**
 * GET /posts/sidebar : the real data for the fandom sidebars.
 *  - leaderboard: most active members of the last 30 days (posts, reactions and comments received)
 *  - stories: stories with the most approved discussions
 *  - counts: the viewer's drafts / posts
 */
export const getFandomSidebar = async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user?.id || null;
    const [leaders, top, counts] = await Promise.all([
      // a few extra: deleted or banned people are dropped after asking the backend
      pool.query(`
        SELECT p.user_id, count(p.id)::int AS posts,
          COALESCE(sum(p.reaction_count), 0)::int AS reactions, COALESCE(sum(p.comment_count), 0)::int AS comments
        FROM posts p
        WHERE p.is_deleted = false AND p.approval_status = 'approved' AND p.is_published AND p.published_at > NOW() - INTERVAL '30 days'
        GROUP BY p.user_id
        ORDER BY count(p.id) * 3 + COALESCE(sum(p.reaction_count), 0) + COALESCE(sum(p.comment_count), 0) * 2 DESC
        LIMIT 20`),
      pool.query(`
        SELECT story_id, count(*)::int AS post_count
        FROM posts WHERE story_id IS NOT NULL AND is_deleted = false AND approval_status = 'approved' AND is_published
        GROUP BY story_id ORDER BY count(*) DESC, max(published_at) DESC LIMIT 30`),
      pool.query(`
        SELECT
          (SELECT count(*)::int FROM posts WHERE is_deleted = false AND is_draft AND user_id = $1::uuid) AS drafts,
          (SELECT count(*)::int FROM posts WHERE is_deleted = false AND NOT is_draft AND user_id = $1::uuid) AS mine,
          (SELECT count(*)::int FROM posts WHERE is_deleted = false AND approval_status = 'approved' AND is_published) AS total`,
        [viewerId]),
    ]);
    const [people, linked] = await Promise.all([profiles(leaders.rows.map((r) => r.user_id)), stories(top.rows.map((r) => r.story_id))]);
    const leaderboard = leaders.rows
      .map((r) => ({ r, u: people.get(r.user_id) }))
      .filter(({ u }) => u && !u.deleted && !u.is_banned)
      .slice(0, 5)
      .map(({ r, u }) => ({
        username: u!.username, display_name: u!.display_name, avatar_url: u!.avatar_url, roles: u!.roles,
        posts: r.posts, reactions: r.reactions, comments: r.comments,
      }));
    const storyList = top.rows
      .map((r) => ({ r, s: linked.get(r.story_id) }))
      .filter(({ s }) => s && s.approval_status === 'approved')
      .slice(0, 12)
      .map(({ r, s }) => ({ id: s!.id, title: s!.title, slug: s!.slug, cover_image_url: s!.cover_image_url, story_type: s!.story_type, post_count: r.post_count }));
    const c = counts.rows[0];
    return res.json({
      success: true,
      data: {
        leaderboard,
        stories: storyList,
        counts: { total: c.total, drafts: viewerId ? c.drafts : 0, mine: viewerId ? c.mine : 0 },
      },
    });
  } catch (error: any) {
    return fail(res, error, 'getFandomSidebar');
  }
};

// ------------------------------------------------------------------ write

export const createPost = async (req: AuthedRequest, res: Response) => {
  try {
    const f = await readPostBody(req.body || {}, false);
    // posts go live immediately; moderators can still take them down (reject) afterwards
    const status = f.is_draft ? 'draft' : 'approved';
    const published = status === 'approved';

    const insertRes = await insertWithUniqueSlug(slugify(f.title!) || 'bai-viet-fandom', (slug) => pool.query(
      `INSERT INTO posts (user_id, story_id, title, slug, content, category, cover_image_url, images, is_draft,
                          approval_status, is_published, published_at, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11,
               CASE WHEN $11 THEN NOW() END, CASE WHEN $11 THEN NOW() END)
       RETURNING *`,
      [req.user!.id, f.story_id, f.title, slug, f.content, f.category, f.images![0] || null, JSON.stringify(f.images),
        f.is_draft, status, published],
    ));

    const message = f.is_draft ? 'Đã lưu bản nháp.' : 'Đã đăng bài viết.';
    return res.status(201).json({ success: true, message, data: insertRes.rows[0] });
  } catch (error: any) {
    return fail(res, error, 'createPost');
  }
};

/** Author only. Only the fields sent are changed. Edits publish immediately, except on a post a moderator took down. */
export const updatePost = async (req: AuthedRequest, res: Response) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại.' });
    const checkRes = await pool.query(`SELECT * FROM posts WHERE id = $1 AND is_deleted = false`, [req.params.id]);
    const post = checkRes.rows[0];
    if (!post) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại hoặc đã bị xóa.' });
    if (post.user_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền chỉnh sửa bài viết của người khác.' });
    }

    const f = await readPostBody(req.body || {}, true);
    const draft = f.is_draft ?? post.is_draft;
    // a post taken down by a moderator stays down until a moderator restores it
    const status = post.approval_status === 'rejected' ? 'rejected' : draft ? 'draft' : 'approved';
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
      : status === 'rejected' ? 'Đã lưu. Bài viết đang bị Ban quản trị gỡ nên chưa hiển thị lại.'
        : 'Đã cập nhật bài viết.';
    return res.json({ success: true, message, data: updateRes.rows[0] });
  } catch (error: any) {
    return fail(res, error, 'updatePost');
  }
};

export const deletePost = async (req: AuthedRequest, res: Response) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại.' });
    const checkRes = await pool.query(`SELECT id, user_id FROM posts WHERE id = $1 AND is_deleted = false`, [req.params.id]);
    const post = checkRes.rows[0];
    if (!post) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại hoặc đã bị xóa.' });
    // Admin/Mod don't delete other people's posts, they take them down (reject) so it can be undone
    if (post.user_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Chỉ tác giả mới xóa được bài viết. Ban quản trị chỉ gỡ bài vi phạm.' });
    }
    await pool.query(`UPDATE posts SET is_deleted = true, is_pinned = false, updated_at = NOW() WHERE id = $1`, [post.id]);
    return res.json({ success: true, message: 'Đã xóa bài viết.' });
  } catch (error: any) {
    return fail(res, error, 'deletePost');
  }
};

// ------------------------------------------------------------------ moderation

const requireStaff = (req: AuthedRequest, res: Response) => {
  if (!isStaff(req)) { res.status(403).json({ success: false, message: 'Chỉ Admin hoặc Mod mới làm được thao tác này.' }); return false; }
  return true;
};

const targetIdsOf = (req: AuthedRequest): string[] => {
  const ids = req.params.id ? [req.params.id] : (req.body?.post_ids || req.body?.ids || []);
  if (!Array.isArray(ids) || ids.length === 0) throw new InputError('Vui lòng chọn ít nhất một bài viết.');
  if (ids.length > 100) throw new InputError('Mỗi lần xử lý tối đa 100 bài viết.');
  if (!ids.every(isUuid)) throw new InputError('Danh sách bài viết không hợp lệ.');
  return ids;
};

async function review(req: AuthedRequest, res: Response, approve: boolean) {
  try {
    if (!requireStaff(req, res)) return;
    const ids = targetIdsOf(req);
    const reason = approve ? null : optionalText(req.body?.reason, 500, 'Lý do') ?? null;
    const rows = (approve
      ? await pool.query(
        `UPDATE posts SET approval_status = 'approved', approved_by = $1, approved_at = NOW(), is_published = true, is_draft = false,
           published_at = COALESCE(published_at, NOW()), rejection_reason = NULL, removed_by = NULL, removed_at = NULL, updated_at = NOW()
         WHERE id = ANY($2::uuid[]) AND is_deleted = false AND approval_status = 'rejected'
         RETURNING id, user_id, title`, [req.user!.id, ids])
      : await pool.query(
        `UPDATE posts SET approval_status = 'rejected', is_published = false, is_pinned = false, rejection_reason = $2,
           removed_by = $3, removed_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND is_deleted = false AND approval_status <> 'draft'
         RETURNING id, user_id, title`, [ids, reason, req.user!.id])).rows;

    void notify(postReviewNotifications(rows, approve, req.user!.id, reason));

    if (req.params.id && rows.length === 0) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại.' });
    return res.json({
      success: true,
      count: rows.length,
      message: approve ? `Đã khôi phục ${rows.length} bài viết.` : `Đã gỡ ${rows.length} bài viết.`,
    });
  } catch (error: any) {
    return fail(res, error, approve ? 'approvePost' : 'rejectPost');
  }
}

/** Staff: take a post down (reject, with an optional reason) or restore it (approve). */
export const approvePost = (req: AuthedRequest, res: Response) => review(req, res, true);
export const rejectPost = (req: AuthedRequest, res: Response) => review(req, res, false);

/** POST /posts/:id/pin (staff): pin / unpin a published post at the top of the feed. */
export const togglePinPost = async (req: AuthedRequest, res: Response) => {
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
export const togglePostMute = async (req: AuthedRequest, res: Response) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ success: false, message: 'Bài viết không tồn tại.' });
    const removed = await pool.query(`DELETE FROM post_notification_mutes WHERE user_id = $1 AND post_id = $2 RETURNING 1`, [req.user!.id, req.params.id]);
    if (removed.rows.length > 0) {
      return res.json({ success: true, muted: false, message: 'Đã bật lại thông báo cho bài viết này.' });
    }
    await pool.query(
      `INSERT INTO post_notification_mutes (user_id, post_id) SELECT $1, id FROM posts WHERE id = $2 AND is_deleted = false ON CONFLICT DO NOTHING`,
      [req.user!.id, req.params.id]);
    return res.json({ success: true, muted: true, message: 'Đã tắt thông báo về bài viết này.' });
  } catch (error: any) {
    return fail(res, error, 'togglePostMute');
  }
};

// ------------------------------------------------------------------ reactions

export const reactToPost = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
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
        await pool.query(`UPDATE post_reactions SET reaction = $1 WHERE post_id = $2 AND user_id = $3`, [reaction, id, userId]);
        action = 'changed';
      }
    } else {
      await pool.query(`INSERT INTO post_reactions (post_id, user_id, reaction) VALUES ($1, $2, $3)`, [id, userId, reaction]);
    }
    await pool.query(`UPDATE posts SET reaction_count = (SELECT count(*) FROM post_reactions WHERE post_id = $1) WHERE id = $1`, [id]);

    if (action !== 'removed') {
      const me = (await profiles([userId]).catch(() => new Map())).get(userId);
      void notify(postReactionNotification({
        postId: id, postTitle: target.title, postOwnerId: target.user_id, actorId: userId,
        actorName: me?.display_name || me?.username || 'Ai đó', reaction,
      }));
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
