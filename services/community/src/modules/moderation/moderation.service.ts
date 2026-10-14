import { Injectable } from '@nestjs/common';
import { isStaff, Viewer } from '../../common/utils/auth';
import { InputError } from '../../common/utils/validation';
import { callBackend, profileByUsername, profiles } from '../../infra/clients/backend';
import { DbService } from '../../infra/database/db.service';
import { CommentsService } from '../comments/comments.service';
import { ModerationRepository } from './moderation.repository';

const PAGE = 30;

@Injectable()
export class ModerationService {
  constructor(
    private readonly repo: ModerationRepository,
    private readonly db: DbService,
    private readonly comments: CommentsService,
  ) {}

  /**
   * GET /moderation/removed?type=all|story|post&q=&page= (Admin/Mod): content taken down by Admin/Mod, newest first.
   * Posts are ours; removed stories come from the backend (GET /internal/stories/removed) and both lists are merged.
   * shortcut: merged per request (each side returns its first page*30 rows); keep a copy fed by story.removed events
   * when stories move to catalog (stage I). `q` matches code, title, text, or the author's exact username for posts.
   */
  async removed(viewer: Viewer, query: Record<string, any>) {
    if (!isStaff(viewer)) throw new InputError('Chỉ Admin/Mod mới xem được nội dung đã gỡ.', 403);
    const type = query.type === 'story' || query.type === 'post' ? query.type : 'all';
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
    const pattern = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const pageNum = Math.max(1, parseInt(query.page as string) || 1);
    const want = pageNum * PAGE; // enough of each side to cut this page from the merge

    const [postPart, storyPart] = await Promise.all([
      type === 'story' ? null : (async () => {
        const author = q && !/\s/.test(q) ? await profileByUsername(q).catch(() => null) : null;
        const [total, rows] = await Promise.all([
          this.repo.countRemovedPosts(pattern, author?.id ?? null),
          this.repo.removedPosts(pattern, author?.id ?? null, want),
        ]);
        const people = await profiles(rows.flatMap((r) => [r.user_id, r.removed_by]));
        return {
          total,
          rows: rows.map(({ user_id, removed_by, ...r }) => ({
            ...r,
            author_username: people.get(user_id)?.username ?? null, author_name: people.get(user_id)?.display_name ?? null,
            removed_by_username: people.get(removed_by)?.username ?? null, removed_by_name: people.get(removed_by)?.display_name ?? null,
          })),
        };
      })(),
      type === 'post' ? null : (async () => {
        const r = await callBackend('GET', `/internal/stories/removed?limit=${want}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
        if (r.status !== 200) throw new Error(`backend removed stories: HTTP ${r.status}`);
        return r.json.data as { total: number; rows: any[] };
      })(),
    ]);

    const merged = [...(postPart?.rows || []), ...(storyPart?.rows || [])]
      .sort((a, b) => (b.removed_at ? new Date(b.removed_at).getTime() : 0) - (a.removed_at ? new Date(a.removed_at).getTime() : 0));
    return {
      success: true,
      data: merged.slice((pageNum - 1) * PAGE, pageNum * PAGE),
      pagination: { page: pageNum, limit: PAGE, total: (postPart?.total || 0) + (storyPart?.total || 0) },
    };
  }

  /** identity.user.deleted with purge_content: hide the posts and comments of the account. Idempotent (processed_events). */
  async handleIdentityEvent(evt: any): Promise<string> {
    if (!evt?.event_id || typeof evt.type !== 'string' || typeof evt.data !== 'object') throw new Error('malformed event');
    let sendCounts = () => {};
    const outcome = await this.db.withTransaction(async (tx) => {
      if (!(await this.repo.markEventSeen(tx, evt.event_id, evt.type))) return 'duplicate';
      if (evt.type === 'identity.user.deleted' && evt.data.deleted_at && evt.data.purge_content) {
        await this.repo.hidePostsOf(tx, evt.data.id);
        sendCounts = await this.comments.purgeUserComments(tx, evt.data.id);
        return 'applied';
      }
      return 'skipped';
    });
    sendCounts();
    return outcome;
  }
}
