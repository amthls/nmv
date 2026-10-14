import { Injectable } from '@nestjs/common';
import { isStaff, Viewer } from '../../common/utils/auth';
import { sanitizeRichText, hasRichContent } from '../../common/utils/rich-text';
import { InputError, isUuid, optionalEnum, optionalText, optionalUrl } from '../../common/utils/validation';
import { profiles, stories } from '../../infra/clients/backend';
import { notify, postReactionNotification, postReviewNotifications } from '../notify/notify.service';
import { PostsRepository } from './posts.repository';

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
function hidePrivate<T extends { user_id: string; rejection_reason?: string | null }>(post: T, viewer?: Viewer): T {
  if (viewer?.id !== post.user_id && !isStaff(viewer)) post.rejection_reason = null;
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

const requireStaff = (viewer?: Viewer) => {
  if (!isStaff(viewer)) throw new InputError('Chỉ Admin hoặc Mod mới làm được thao tác này.', 403);
};

const targetIdsOf = (id: string | undefined, body: any): string[] => {
  const ids = id ? [id] : (body?.post_ids || body?.ids || []);
  if (!Array.isArray(ids) || ids.length === 0) throw new InputError('Vui lòng chọn ít nhất một bài viết.');
  if (ids.length > 100) throw new InputError('Mỗi lần xử lý tối đa 100 bài viết.');
  if (!ids.every(isUuid)) throw new InputError('Danh sách bài viết không hợp lệ.');
  return ids;
};

@Injectable()
export class PostsService {
  constructor(private readonly repo: PostsRepository) {}

  /** Insert with the first free slug (`base`, `base-2`, ...), retrying when another request took it meanwhile. */
  private async insertWithUniqueSlug<T>(base: string, insert: (slug: string) => Promise<T>): Promise<T> {
    const clean = base.slice(0, 480).replace(/-+$/, '') || 'bai-viet-fandom';
    for (let attempt = 0; attempt < 5; attempt++) {
      const taken = await this.repo.takenSlugs(clean);
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

  // ------------------------------------------------------------------ read

  async list(viewer: Viewer | undefined, query: Record<string, any>) {
    const { story_id, sort = 'newest', q, filter_status, category } = query;
    const page = Math.max(1, parseInt(String(query.page)) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(query.limit)) || 20));
    const offset = (page - 1) * limit;

    const viewerId = viewer?.id || null;
    // $1 is always the viewer (used for "my_reaction"); referenced here so the count query can type it
    const conditions: string[] = ['p.is_deleted = false', '($1::uuid IS NULL OR TRUE)'];
    const values: any[] = [viewerId];
    const add = (sql: (n: number) => string, v: any) => { values.push(v); conditions.push(sql(values.length)); };
    const empty = () => ({ success: true, data: [], pagination: { page, limit, total: 0, totalPages: 1 } });

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
    const total = await this.repo.count(whereClause, values);
    const rows = await this.repo.list(whereClause, orderBy, limit, offset, values);

    return {
      success: true,
      data: (await withPeople(rows)).map((p) => hidePrivate(p, viewer)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async bySlug(viewer: Viewer | undefined, slug: string) {
    const post = await this.repo.bySlug(viewer?.id || null, slug);
    const isAuthor = !!post && viewer?.id === post.user_id;
    const visible = post && post.approval_status === 'approved' && post.is_published;
    if (!post || (!visible && !isAuthor && !isStaff(viewer))) {
      throw new InputError('Bài viết không tồn tại hoặc đã bị xóa.', 404);
    }
    if (visible) this.repo.incrementViews(post.id).catch(console.error);
    return { success: true, data: hidePrivate((await withPeople([post]))[0], viewer) };
  }

  /**
   * GET /posts/sidebar : the real data for the fandom sidebars.
   *  - leaderboard: most active members of the last 30 days (posts, reactions and comments received)
   *  - stories: stories with the most approved discussions
   *  - counts: the viewer's drafts / posts
   */
  async sidebar(viewer: Viewer | undefined) {
    const viewerId = viewer?.id || null;
    const [leaders, top, counts] = await Promise.all([this.repo.leaders(), this.repo.topStories(), this.repo.viewerCounts(viewerId)]);
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
    return {
      success: true,
      data: {
        leaderboard,
        stories: storyList,
        counts: { total: c.total, drafts: viewerId ? c.drafts : 0, mine: viewerId ? c.mine : 0 },
      },
    };
  }

  // ------------------------------------------------------------------ write

  async create(viewer: Viewer, body: any) {
    const f = await readPostBody(body || {}, false);
    // posts go live immediately; moderators can still take them down (reject) afterwards
    const status = f.is_draft ? 'draft' : 'approved';
    const published = status === 'approved';

    const row = await this.insertWithUniqueSlug(slugify(f.title!) || 'bai-viet-fandom', (slug) => this.repo.insert(viewer.id, f, slug, status, published));

    const message = f.is_draft ? 'Đã lưu bản nháp.' : 'Đã đăng bài viết.';
    return { success: true, message, data: row };
  }

  /** Author only. Only the fields sent are changed. Edits publish immediately, except on a post a moderator took down. */
  async update(viewer: Viewer, id: string, body: any) {
    if (!isUuid(id)) throw new InputError('Bài viết không tồn tại.', 404);
    const post = await this.repo.findLive(id);
    if (!post) throw new InputError('Bài viết không tồn tại hoặc đã bị xóa.', 404);
    if (post.user_id !== viewer.id) throw new InputError('Bạn không có quyền chỉnh sửa bài viết của người khác.', 403);

    const f = await readPostBody(body || {}, true);
    const draft = f.is_draft ?? post.is_draft;
    // a post taken down by a moderator stays down until a moderator restores it
    const status = post.approval_status === 'rejected' ? 'rejected' : draft ? 'draft' : 'approved';
    const published = status === 'approved';

    const row = await this.repo.update(post, f, draft, status, published);

    const message = draft ? 'Đã lưu bản nháp.'
      : status === 'rejected' ? 'Đã lưu. Bài viết đang bị Ban quản trị gỡ nên chưa hiển thị lại.'
        : 'Đã cập nhật bài viết.';
    return { success: true, message, data: row };
  }

  async remove(viewer: Viewer, id: string) {
    if (!isUuid(id)) throw new InputError('Bài viết không tồn tại.', 404);
    const post = await this.repo.findLiveOwner(id);
    if (!post) throw new InputError('Bài viết không tồn tại hoặc đã bị xóa.', 404);
    // Admin/Mod don't delete other people's posts, they take them down (reject) so it can be undone
    if (post.user_id !== viewer.id) throw new InputError('Chỉ tác giả mới xóa được bài viết. Ban quản trị chỉ gỡ bài vi phạm.', 403);
    await this.repo.softDelete(post.id);
    return { success: true, message: 'Đã xóa bài viết.' };
  }

  // ------------------------------------------------------------------ moderation

  /** Staff: take a post down (reject, with an optional reason) or restore it (approve). */
  async review(viewer: Viewer, id: string | undefined, body: any, approve: boolean) {
    requireStaff(viewer);
    const ids = targetIdsOf(id, body);
    const reason = approve ? null : optionalText(body?.reason, 500, 'Lý do') ?? null;
    const rows = approve ? await this.repo.approve(viewer.id, ids) : await this.repo.reject(viewer.id, ids, reason);

    void notify(postReviewNotifications(rows, approve, viewer.id, reason));

    if (id && rows.length === 0) throw new InputError('Bài viết không tồn tại.', 404);
    return {
      success: true,
      count: rows.length,
      message: approve ? `Đã khôi phục ${rows.length} bài viết.` : `Đã gỡ ${rows.length} bài viết.`,
    };
  }

  /** POST /posts/:id/pin (staff): pin / unpin a published post at the top of the feed. */
  async togglePin(viewer: Viewer, id: string) {
    requireStaff(viewer);
    if (!isUuid(id)) throw new InputError('Bài viết không tồn tại.', 404);
    const rows = await this.repo.togglePin(id);
    if (rows.length === 0) throw new InputError('Chỉ ghim được bài viết đã duyệt.', 404);
    return { success: true, is_pinned: rows[0].is_pinned, message: rows[0].is_pinned ? 'Đã ghim bài viết.' : 'Đã bỏ ghim.' };
  }

  /** POST /posts/:id/mute : stop / resume notifications about this post (comments, replies, reactions). */
  async toggleMute(viewer: Viewer, id: string) {
    if (!isUuid(id)) throw new InputError('Bài viết không tồn tại.', 404);
    const removed = await this.repo.removeMute(viewer.id, id);
    if (removed.length > 0) return { success: true, muted: false, message: 'Đã bật lại thông báo cho bài viết này.' };
    await this.repo.addMute(viewer.id, id);
    return { success: true, muted: true, message: 'Đã tắt thông báo về bài viết này.' };
  }

  // ------------------------------------------------------------------ reactions

  async react(viewer: Viewer, id: string, body: any) {
    const userId = viewer.id;
    const { reaction } = body || {};
    if (!isUuid(id)) throw new InputError('Bài viết không tồn tại.', 404);
    if (!['like', 'love', 'haha', 'wow', 'sad', 'angry'].includes(reaction)) throw new InputError('Cảm xúc không hợp lệ', 400);

    const target = await this.repo.reactionTarget(id);
    const visible = target && target.approval_status === 'approved' && target.is_published;
    if (!target || (!visible && target.user_id !== userId && !isStaff(viewer))) {
      throw new InputError('Bài viết không tồn tại hoặc đã bị xóa.', 404);
    }

    const existing = await this.repo.reactionOf(id, userId);
    let action: 'added' | 'changed' | 'removed' = 'added';
    if (existing.length > 0) {
      if (existing[0].reaction === reaction) {
        await this.repo.deleteReaction(id, userId);
        action = 'removed';
      } else {
        await this.repo.changeReaction(id, userId, reaction);
        action = 'changed';
      }
    } else {
      await this.repo.addReaction(id, userId, reaction);
    }
    await this.repo.recountReactions(id);

    if (action !== 'removed') {
      const me = (await profiles([userId]).catch(() => new Map())).get(userId);
      void notify(postReactionNotification({
        postId: id, postTitle: target.title, postOwnerId: target.user_id, actorId: userId,
        actorName: me?.display_name || me?.username || 'Ai đó', reaction,
      }));
    }

    const summary = await this.repo.reactionSummary(id);
    return { success: true, action, data: { ...summary, my_reaction: action === 'removed' ? null : reaction } };
  }
}
