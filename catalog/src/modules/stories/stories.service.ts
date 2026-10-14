import { Injectable } from '@nestjs/common';
import { cachedPublic } from '../../middlewares/cache';
import { publishBehavior } from '../../services/behaviorEvents';
import { callLibrary, libraryData } from '../../services/libraryClient';
import { enqueueNotificationJob } from '../../services/queue.service';
import { indexStory, searchStoryIds } from '../search/search.client';
import { recordView } from '../../services/viewCounter';
import { InputError, isUuid, optionalText } from '../../utils/validation';
import { parseStoryInput, StoryInput } from './dto/story-input';
import { trendingStories } from './hot-shelf.job';
import { purgeStory, REMOVED_PURGE_DAYS } from './story-purge.job';
import { canUserManageStory, checkStoryReferences, clientErrors, grantPublisherRole, storyRole } from './story-access';
import { StoriesRepository } from './stories.repository';

export type StoryUser = { id: string; username: string; display_name?: string; roles?: string[] };

/** Stories: lists, pages, edits, collaborators, take-downs. */
@Injectable()
export class StoriesService {
  constructor(private readonly repo: StoriesRepository) {}

  manageable(user: StoryUser) {
    return this.repo.manageable(user.id);
  }

  trending() {
    return trendingStories();
  }

  recentlyUpdated() {
    return this.repo.recentlyUpdated();
  }

  featuredIllustrations() {
    return this.repo.featuredIllustrations();
  }

  async explore(query: any) {
    const { q, type, status, tags, exclude_tags, language, min_chapters, sort: sortParam, page = '1', limit = '24' } = query;

    // Bound what one request can ask for: deep OFFSETs and huge search strings are cheap DoS vectors
    const pageNum = Math.min(1000, Math.max(1, parseInt(page as string) || 1));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 24));
    const offset = (pageNum - 1) * limitNum;
    if (typeof q === 'string' && q.length > 120) throw new InputError('Từ khóa tìm kiếm quá dài (tối đa 120 ký tự).', 400);

    // Ranked story ids from Elasticsearch; null means "not available" -> SQL ILIKE fallback.
    let rankedIds: string[] | null = null;
    if (q && typeof q === 'string' && q.trim()) rankedIds = await searchStoryIds(q.trim());

    const { total, rows } = await this.repo.explore({
      q, type, status, tags, exclude_tags, language, min_chapters, sortParam, rankedIds, limitNum, offset,
    });
    const totalPages = Math.ceil(total / limitNum);
    return {
      success: true,
      data: rows,
      pagination: {
        page: pageNum, limit: limitNum, total, totalPages,
        hasNextPage: pageNum < totalPages, hasPrevPage: pageNum > 1,
      },
    };
  }

  async getBySlug(slug: string, user: StoryUser | undefined, visitorId: string | null) {
    // the shared part comes from the cache (Plan/load.md A5); follow state, rights and the approval check below are
    // worked out per request
    const story: any = await cachedPublic(`story:${slug}`, 60, () => this.repo.loadPublicStory(slug));
    if (!story) throw new InputError('Không tìm thấy truyện', 404);

    const currentUserId = user?.id;
    const currentUserRoles: string[] = user?.roles || [];
    if (currentUserId) {
      // followed? the library service's (the page still opens if it is down)
      const fav = await libraryData(`/internal/favorites/${currentUserId}/${story.id}`, 2000).catch(() => null);
      story.is_favorite = Boolean(fav?.is_favorite);
      story.favorite_category = fav?.category || null;
      story.can_manage = await canUserManageStory(currentUserId, story.id);
    } else {
      story.is_favorite = false;
      story.favorite_category = null;
      story.can_manage = false;
    }

    // A story taken down by Admin/Mod (approval_status 'rejected') stays visible to its team and to Admin/Mod
    story.can_moderate = currentUserRoles.includes('admin') || currentUserRoles.includes('mod');
    if (story.approval_status && story.approval_status !== 'approved' && !story.can_manage && !story.can_moderate) {
      throw new InputError('Không tìm thấy truyện', 404);
    }

    publishBehavior({ userId: currentUserId, visitorId, storyId: story.id });
    return story;
  }

  async getChapter(slug: string, chapterSlug: string, user: StoryUser | undefined, visitorId: string | null) {
    // the shared part comes from the cache (Plan/load.md A5); history, behaviour and the view count stay per request
    const found = await cachedPublic(`chapter:${slug}:${chapterSlug}`, 60, () => this.repo.loadPublicChapter(slug, chapterSlug));
    if (!found?.chapter) throw new InputError(found?.missing || 'Không tìm thấy chương', 404);
    const chapter = found.chapter;
    const story = chapter.story;

    // Tự động sinh bản ghi log đọc truyện nếu người dùng đã đăng nhập
    const currentUserId = user?.id;
    if (currentUserId) {
      // reading history: the library service's (in the background; reading never waits for it)
      callLibrary('POST', '/internal/history', { user_id: currentUserId, chapter_id: chapter.id })
        .then((r) => { if (r.status !== 200) throw new Error(`HTTP ${r.status}`); })
        .catch((err) => console.error('[library] reading history not saved:', err.message));
    }

    publishBehavior({ userId: currentUserId, visitorId, storyId: story.id, chapterId: chapter.id });
    recordView(story.id, chapter.id);
    return chapter;
  }

  /** Update story metadata, owner or assigned group (story team only). */
  update(id: string, user: StoryUser, body: any) {
    return clientErrors(async () => {
      if (!isUuid(id)) throw new InputError('Truyện không tồn tại.', 404);
      const input = parseStoryInput(body || {}, false);

      if (!(await canUserManageStory(user.id, id))) {
        throw new InputError('Bạn không phải chủ thầu của truyện này (người đăng, nhóm dịch hoặc cộng tác viên) nên không có quyền chỉnh sửa.', 403);
      }

      // Only fields that were sent are changed; sending null/'' clears an optional field
      const columns: [keyof StoryInput, string][] = [
        ['title', 'title'], ['original_title', 'original_title'], ['synopsis', 'synopsis'],
        ['cover_image_url', 'cover_image_url'], ['banner_image_url', 'banner_image_url'],
        ['story_type', 'story_type'], ['status', 'status'], ['author_name', 'author_name'],
        ['artist_name', 'artist_name'], ['original_language', 'original_language'], ['group_id', 'group_id'],
        ['allow_download', 'allow_download'],
      ];
      const sets: string[] = [];
      const params: any[] = [];
      for (const [key, column] of columns) {
        if (input[key] === undefined) continue;
        params.push(input[key]);
        const cast = column === 'story_type' ? '::story_type' : column === 'status' ? '::story_status' : '';
        sets.push(`${column} = $${params.length}${cast}`);
      }
      sets.push('updated_at = NOW()');
      params.push(id);

      const story = await this.repo.updateInTransaction(
        id, sets, params,
        async (tx, current) => {
          await checkStoryReferences(tx, input, user.id);
          // Chapters are stored as text or as page images depending on the type, so it is fixed once content exists
          if (current && input.story_type !== undefined && input.story_type !== current.story_type) {
            if (await this.repo.hasChapters(tx, id)) {
              throw new InputError('Truyện đã có chương nên không thể đổi giữa truyện chữ và truyện tranh.', 409);
            }
          }
          // Imported stories belong to their original site: they are never offered as downloads
          if (input.allow_download === true && current?.source_name) {
            throw new InputError('Truyện được nhập tự động từ trang khác nên không thể bật tải xuống.');
          }
        },
        async (updated, current, tx) => {
          if (updated.group_id !== current?.group_id) await grantPublisherRole(tx, updated.uploader_id, updated.group_id);
          if (input.tags !== undefined) await this.repo.replaceTags(tx, id, input.tags);
        },
      );
      if (!story) throw new InputError('Truyện không tồn tại.', 404);

      await indexStory(id);
      return story;
    });
  }

  /** Delete a story for good: the uploader only. Admin/Mod take stories down instead (setRemoved), which can be undone. */
  async remove(id: string, user: StoryUser) {
    if (!isUuid(id)) throw new InputError('Truyện không tồn tại.', 404);
    const story = await this.repo.titleAndUploader(id);
    if (!story) throw new InputError('Truyện không tồn tại hoặc đã bị xóa.', 404);
    if (story.uploader_id !== user.id) {
      throw new InputError('Chỉ người đăng truyện mới xóa được truyện. Ban quản trị chỉ gỡ truyện vi phạm.', 403);
    }
    await purgeStory(id);
    return story.title as string;
  }

  collaborators(storyId: string) {
    return this.repo.collaborators(storyId);
  }

  /** Add a collaborator (by username or id) to a story; only the story team may. */
  async addCollaborator(storyId: string, user: StoryUser, body: any) {
    const { identifier, role = 'collaborator' } = body;
    if (!identifier) throw new InputError('Vui lòng cung cấp username hoặc email thành viên.', 400);

    if (!(await canUserManageStory(user.id, storyId))) {
      throw new InputError('Bạn không có quyền quản lý cộng tác viên của bộ truyện này.', 403);
    }
    const target = await this.repo.findActiveUser(identifier.trim());
    if (!target) throw new InputError('Không tìm thấy người dùng này.', 404);

    await this.repo.upsertCollaborator(storyId, target.id, role);
    return { target, role };
  }

  async removeCollaborator(storyId: string, collaboratorId: string, user: StoryUser) {
    if (!(await canUserManageStory(user.id, storyId))) {
      throw new InputError('Bạn không có quyền quản lý cộng tác viên của bộ truyện này.', 403);
    }
    await this.repo.deleteCollaborator(storyId, collaboratorId);
  }

  /**
   * Admin/Mod: take a story down (soft, `reason` optional) or restore it. A removed story has approval_status
   * 'rejected', so every public list, search and recommendation skips it; it is listed on the "Đã gỡ" page.
   */
  setRemoved(id: string, remove: boolean, user: StoryUser, body: any) {
    return clientErrors(async () => {
      const roles = user.roles || [];
      if (!roles.includes('admin') && !roles.includes('mod')) throw new InputError('Chỉ Admin hoặc Mod mới làm được thao tác này.', 403);
      if (!isUuid(id)) throw new InputError('Truyện không tồn tại.', 404);
      const reason = remove ? optionalText(body?.reason, 500, 'Lý do') ?? null : null;
      const story = await this.repo.setRemoved(id, remove, reason, user.id);
      if (!story) throw new InputError(remove ? 'Truyện không tồn tại hoặc đã bị gỡ.' : 'Truyện không ở trạng thái bị gỡ.', 409);

      await indexStory(id);
      if (story.uploader_id !== user.id) {
        enqueueNotificationJob({ kind: 'notify', items: [{
          userId: story.uploader_id, type: remove ? 'story_removed' : 'story_restored',
          title: remove ? 'Truyện của bạn đã bị Ban quản trị gỡ' : 'Truyện của bạn đã được khôi phục',
          message: `"${story.title}"${reason ? ` · Lý do: ${reason}` : ''}`
            + (remove ? ` · Truyện sẽ bị xóa hẳn sau ${REMOVED_PURGE_DAYS} ngày nếu không được khôi phục.` : ''),
          referenceType: 'story', referenceId: story.id, senderId: user.id,
          dedupeKey: `story-${remove ? 'removed' : 'restored'}:${story.id}:${Date.now()}`,
        }] }).catch((err: any) => console.error('[Stories] remove notification failed:', err.message));
      }
      return remove ? `Đã gỡ truyện "${story.title}".` : `Đã khôi phục truyện "${story.title}".`;
    });
  }

  // Service-to-service

  permissions(user: string, story: string) {
    return storyRole(user, story);
  }

  brief(body: any) {
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter(isUuid).slice(0, 1000) : []);
    return this.repo.brief(ids(body?.story_ids), ids(body?.chapter_ids));
  }

  removedList(query: any) {
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
    const pattern = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 3000);
    return this.repo.removed(pattern, limit, REMOVED_PURGE_DAYS);
  }

  async commentCounts(body: any) {
    const chapters = Array.isArray(body?.chapters) ? body.chapters.filter((c: any) => isUuid(c?.id) && Number.isInteger(c.count)) : [];
    const stories = Array.isArray(body?.stories) ? body.stories.filter((s: any) => isUuid(s?.id) && Number.isInteger(s.page_count)) : [];
    await this.repo.setCommentCounts(chapters, stories);
  }

  async favoriteCounts(body: any) {
    const list = Array.isArray(body?.stories) ? body.stories.filter((s: any) => isUuid(s?.id) && Number.isInteger(s.count)) : [];
    await this.repo.setFavoriteCounts(list);
  }
}
