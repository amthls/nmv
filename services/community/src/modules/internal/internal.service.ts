import { Injectable } from '@nestjs/common';
import { InternalRepository } from './internal.repository';

const UUID_LIKE = /^[0-9a-f-]{36}$/i;

/** The backend calls (X-Internal-Auth signed with INTERNAL_KEY_COMMUNITY). A null result means "answer 404 {success:false}". */
@Injectable()
export class InternalService {
  constructor(private readonly repo: InternalRepository) {}

  /** GET /internal/codes/:kind/:no?me=<uuid>&staff=1 -> {path} of a P- / RP- smart code (hidden = 404, like unknown). */
  async resolveCode(kind: string, noParam: string, query: Record<string, any>) {
    const no = Number(noParam);
    const staff = query.staff === '1';
    const me = typeof query.me === 'string' && UUID_LIKE.test(query.me) ? query.me : null;
    let path: string | null = null;
    if (Number.isSafeInteger(no) && kind === 'post') path = await this.repo.postPath(no, me, staff);
    else if (Number.isSafeInteger(no) && kind === 'report' && staff) path = await this.repo.reportPath(no);
    return path ? { success: true, data: { path } } : null;
  }

  /** GET /internal/users/:id/stats -> what a profile shows about the posts and comments of someone. */
  async userStats(id: string) {
    if (!UUID_LIKE.test(id)) return null;
    return { success: true, data: await this.repo.userStats(id) };
  }

  /**
   * POST /internal/comments/purge {story_id, chapter_ids}: a story was deleted. Its comments go with it and posts about it
   * lose the link (as the backend did in the same transaction).
   */
  async purgeStoryComments(body: any) {
    const storyId = typeof body?.story_id === 'string' ? body.story_id : null;
    const chapterIds = Array.isArray(body?.chapter_ids) ? body.chapter_ids.filter((x: unknown) => typeof x === 'string') : [];
    const deleted = await this.repo.deleteStoryComments(storyId, chapterIds);
    await this.repo.unlinkStoryPosts(storyId);
    return { success: true, data: { deleted } };
  }
}
