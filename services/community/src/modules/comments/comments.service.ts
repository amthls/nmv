import { Injectable } from '@nestjs/common';
import { isStaff, Viewer } from '../../common/utils/auth';
import { InputError } from '../../common/utils/validation';
import { authorFields, callBackend, chapters, profiles } from '../../infra/clients/backend';
import { DbService, Queryable } from '../../infra/database/db.service';
import { commentNotifications, notify } from '../notify/notify.service';
import { CommentsRepository } from './comments.repository';

// Moved from the backend's comment.controller.ts (Plan/community.md): same routes and JSON under /api/community.

@Injectable()
export class CommentsService {
  constructor(private readonly repo: CommentsRepository, private readonly db: DbService) {}

  /**
   * Comment counters. Replies and posts are recounted here (inside the caller's transaction); stories and chapters are
   * the backend's (stories.total_comments = story page + all its chapters): returns a function that sends it fresh counts,
   * to call once committed. Recounting (not +1/-1) means a repeated or lost call cannot drift the numbers.
   */
  async recount(db: Queryable, rows: { target_type: string; target_id: string; parent_id?: string | null }[]) {
    const ids = (type: string) => [...new Set(rows.filter((r) => r.target_type === type).map((r) => r.target_id))];
    const parentIds = [...new Set(rows.map((r) => r.parent_id).filter(Boolean))];
    if (parentIds.length) await this.repo.recountReplies(db, parentIds);
    if (ids('post').length) await this.repo.recountPosts(db, ids('post'));
    return () => void this.pushCatalogCounts(ids('chapter'), ids('story'));
  }

  /** Fresh comment counts of chapters and story pages to the backend (stories.total_comments, chapters.total_comments). */
  async pushCatalogCounts(chapterIds: string[], storyIds: string[]) {
    try {
      if (chapterIds.length === 0 && storyIds.length === 0) return;
      const chs = await chapters(chapterIds);
      const allStories = [...new Set([...storyIds, ...[...chs.values()].map((c) => c.story_id)])];
      const rows = await this.repo.countsFor(chapterIds, allStories);
      const count = (type: string, id: string) => rows.find((x) => x.target_type === type && x.target_id === id)?.n || 0;
      const res = await callBackend('POST', '/internal/comment-counts', {
        chapters: chapterIds.map((id) => ({ id, count: count('chapter', id) })),
        stories: allStories.map((id) => ({ id, page_count: count('story', id) })),
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    } catch (err: any) {
      console.error('[comments] could not send comment counts to the backend:', err.message);
    }
  }

  /** Hide every live comment of a user (and the replies under them); returns what sends the backend counts after commit. */
  async purgeUserComments(db: Queryable, userId: string): Promise<() => void> {
    const removed = await this.repo.hideOfUser(db, userId);
    return removed.rowCount! > 0 ? this.recount(db, removed.rows) : () => {};
  }

  async list(query: Record<string, any>) {
    const { target_type, target_id, page = '1', limit = '50' } = query;

    if (!target_type || !target_id) throw new InputError('target_type và target_id là bắt buộc');
    if (!['chapter', 'post', 'story'].includes(String(target_type))) throw new InputError('target_type không hợp lệ.');

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 50));
    const offset = (pageNum - 1) * limitNum;

    const result = await this.repo.list(target_type, target_id, limitNum, offset);

    const people = await profiles(result.map((c) => c.user_id));
    const commentMap = new Map();
    const rootComments: any[] = [];
    const rows = result.map((c) => ({ ...c, ...authorFields(people.get(c.user_id)), replies: [] as any[] }));
    rows.forEach((comment) => commentMap.set(comment.id, comment));
    rows.forEach((comment) => {
      if (comment.parent_id && commentMap.has(comment.parent_id)) commentMap.get(comment.parent_id).replies.push(comment);
      else rootComments.push(comment);
    });

    rootComments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return { success: true, data: rootComments, total: result.length };
  }

  async create(viewer: Viewer, body: any) {
    const { target_type, target_id, parent_id, content, quoted_text } = body || {};

    if (!target_type || !target_id || typeof content !== 'string' || !content.trim()) throw new InputError('Vui lòng nhập nội dung bình luận.');
    if (!['chapter', 'post', 'story'].includes(target_type)) throw new InputError('target_type không hợp lệ.');

    const authorId = viewer.id;

    let postOwnerId: string | null = null;
    let postTitle: string | null = null;
    if (target_type === 'post') {
      const postRows = await this.repo.postTarget(target_id);
      if (postRows.length === 0) throw new InputError('Bài viết không tồn tại hoặc đã bị xóa.', 404);
      const targetPost = postRows[0];
      postOwnerId = targetPost.user_id;
      postTitle = targetPost.title;
      const isPostVisible = targetPost.approval_status === 'approved' && targetPost.is_published;
      if (!isPostVisible && targetPost.user_id !== authorId && !isStaff(viewer)) {
        throw new InputError('Bài viết không tồn tại hoặc đã bị xóa.', 404);
      }
    }

    let depth = 0;
    let rootId = null;
    let parentAuthorId: string | null = null;

    if (parent_id) {
      const parentRows = await this.repo.parentOf(parent_id);
      if (parentRows.length > 0) {
        const parent = parentRows[0];
        depth = (parent.depth || 0) + 1;
        rootId = parent.root_id || parent.id;
        parentAuthorId = parent.user_id;
      }
    }

    const newComment = await this.repo.insert(authorId, target_type, target_id, parent_id, rootId, depth, content, quoted_text);
    (await this.recount(this.db, [newComment]))();

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

    return { success: true, message: 'Bình luận thành công', data: newComment };
  }

  async like(viewer: Viewer, id: string) {
    try {
      let liked = false;
      if (await this.repo.hasLike(viewer.id, id)) {
        await this.repo.removeLike(viewer.id, id);
      } else {
        await this.repo.addLike(viewer.id, id);
        liked = true;
      }
      return { success: true, liked, like_count: await this.repo.likeCount(id) };
    } catch (error: any) {
      if (error?.code === '23503' || error?.code === '22P02') throw new InputError('Bình luận không tồn tại.', 404);
      throw error;
    }
  }

  /** Edit own comment (admin/mod may not rewrite other people's words - they can only delete). */
  async update(viewer: Viewer, id: string, body: any) {
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) throw new InputError('Nội dung bình luận không được để trống.');

    const found = await this.repo.ownerOf(id);
    if (found.length === 0) throw new InputError('Bình luận không tồn tại hoặc đã bị xóa.', 404);
    if (found[0].user_id !== viewer.id) throw new InputError('Bạn chỉ có thể sửa bình luận của chính mình.', 403);

    return { success: true, message: 'Đã cập nhật bình luận.', data: await this.repo.updateContent(id, content) };
  }

  /** Delete a comment (author, admin or mod). Soft delete: the row stays, replies are hidden with it, counters recounted. */
  async remove(viewer: Viewer, id: string) {
    const sendCounts = await this.db.withTransaction(async (tx) => {
      const found = await this.repo.lockLive(tx, id);
      if (found.length === 0) throw new InputError('Bình luận không tồn tại hoặc đã bị xóa.', 404);
      const comment = found[0];
      if (comment.user_id !== viewer.id && !isStaff(viewer)) throw new InputError('Bạn không có quyền xóa bình luận này.', 403);

      await this.repo.deleteTree(tx, id);
      return this.recount(tx, [comment]);
    });
    sendCounts();
    return { success: true, message: 'Đã xóa bình luận.' };
  }
}
