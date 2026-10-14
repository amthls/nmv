import { Injectable } from '@nestjs/common';
import { callWorkspace, Revision } from '../../infra/clients/workspace.client';
import { dmBlocked, sendDraftCard } from '../../infra/clients/messaging.client';
import { draftNotifications } from '../../infra/notification/notification.service';
import { enqueueNotificationJob } from '../../infra/queue/queue.service';
import { InputError, isUuid, requiredText } from '../../utils/validation';
import { canUserManageStory, clientErrors, storyRole } from '../stories/story-access';
import { checkBlocksMatchStoryType, chapterMessage, normalizeContentBlocks, parseChapterNumber } from '../chapters/dto/chapter-content';
import { applyRevisionNow } from '../chapters/workspace-sync.job';
import { DraftsRepository } from './drafts.repository';

export type DraftUser = { id: string; username: string; display_name?: string; roles?: string[] };

/** What a route answers: the HTTP status and the JSON (a workspace answer is passed on as it came). */
export type Reply = { status: number; body: any };

const ok = (body: any): Reply => ({ status: 200, body });
const refuse = (status: number, message: string): Reply => ({ status, body: { success: false, message } });

const ownerOf = (user: DraftUser) => ({ owner_id: user.id, owner_name: user.display_name || user.username });
const draftLabel = (d: any) => (d.chapter_id ? `sửa Chương ${Number(d.meta.chapter_number)}` : `Chương ${Number(d.meta.chapter_number)} (mới)`);
const BLOCKED_MESSAGE = 'Không thể gửi tin nhắn cho người này.';

/** Pass a workspace answer on: its 4xx messages are the user's to read; anything else is ours. */
function relayWorkspace(r: { status: number; json: any }): Reply {
  if (r.status < 500) return { status: r.status, body: r.json };
  throw new Error(`workspace ${r.status}: ${r.json?.message || ''}`);
}

/**
 * Chapter drafts (workspace stage 2+): content passes the HTML filter here; the workspace keeps the draft and checks
 * its owner. Reading, discarding and pulling a draft carry no new content: the browser calls /api/ws directly.
 */
@Injectable()
export class DraftsService {
  constructor(private readonly repo: DraftsRepository) {}

  /** Chapter fields of a draft from the editor (title may still be empty: it is only required to publish). */
  private async draftMeta(body: any, storyId: string) {
    const title = body.title === undefined || body.title === null ? '' : String(body.title).trim();
    if (title.length > 500) throw new InputError('Tiêu đề chương tối đa 500 ký tự.');
    const volumeId = body.volume_id || null;
    if (volumeId) {
      if (!isUuid(volumeId)) throw new InputError('Tập không hợp lệ.');
      if (!(await this.repo.volumeInStory(volumeId, storyId))) throw new InputError('Tập không thuộc bộ truyện này.');
    }
    const numberGiven = !(body.chapter_number === undefined || body.chapter_number === null || body.chapter_number === '');
    return {
      title,
      chapter_number: numberGiven ? parseChapterNumber(body.chapter_number) : 0,
      volume_id: volumeId,
      intro_note: chapterMessage(body.intro_note, 'Lời nhắn đầu chương'),
      outro_note: chapterMessage(body.outro_note, 'Lời nhắn cuối chương'),
    };
  }

  /** Novel stories only for now: manga chapters are uploaded and edited as pages (dang-truyen-tranh). */
  private async novelStory(storyId: string) {
    const story = await this.repo.storyForDraft(storyId);
    if (!story) throw new InputError('Bộ truyện không tồn tại.');
    if (story.story_type === 'manga') throw new InputError('Truyện tranh chưa dùng bản nháp: hãy dùng trình đăng truyện tranh.');
    return story;
  }

  /** Load draft {id} from the workspace; a Reply instead when it is missing or the workspace refuses. */
  private async workspaceDraft(id: string): Promise<{ draft: any } | { reply: Reply }> {
    if (!isUuid(id)) return { reply: refuse(404, 'Bản nháp không tồn tại.') };
    const current = await callWorkspace('GET', `/internal/drafts/${id}`);
    if (current.status !== 200) return { reply: relayWorkspace(current) };
    return { draft: current.json.data };
  }

  /** Notify about a proposal through the queue (never fails the request). */
  private async notifyDraft(event: 'submitted' | 'returned' | 'merged' | 'offered' | 'transferred', d: any, recipients: string[], user: DraftUser, note?: string | null) {
    try {
      const storyTitle = await this.repo.storyTitle(d.story_id);
      const items = draftNotifications({
        event, draftId: d.id, round: d.last_round, recipientIds: recipients, actorId: user.id,
        actorName: user.display_name || user.username, chapterLabel: draftLabel(d), storyTitle: storyTitle || '', note,
      });
      if (items.length > 0) await enqueueNotificationJob({ kind: 'notify', items });
    } catch (err: any) {
      console.error('[Drafts] notification failed:', err.message);
    }
  }

  /**
   * POST /drafts {story_id, chapter_id?} opens a draft of a published chapter (the caller's open one if any);
   * without chapter_id it starts a new chapter from the editor's fields. Contributors of the story only.
   */
  create(user: DraftUser, body: any) {
    return clientErrors(async (): Promise<Reply> => {
      body = body || {};
      let storyId = body.story_id;
      if (body.chapter_id !== undefined && body.chapter_id !== null) {
        if (!isUuid(body.chapter_id)) return refuse(404, 'Chương không tồn tại.');
        const found = await this.repo.chapterStoryId(body.chapter_id);
        if (!found) return refuse(404, 'Chương không tồn tại.');
        storyId = found;
      }
      if (!isUuid(storyId)) return refuse(400, 'Thiếu hoặc sai story_id.');
      if (!(await canUserManageStory(user.id, storyId))) {
        return refuse(403, 'Bạn không tham gia truyện này nên không tạo được bản nháp.');
      }
      await this.novelStory(storyId);
      const payload: any = { ...ownerOf(user), story_id: storyId };
      if (body.chapter_id) payload.chapter_id = body.chapter_id;
      else {
        payload.meta = await this.draftMeta(body, storyId);
        payload.blocks = normalizeContentBlocks(body.content_blocks);
        checkBlocksMatchStoryType('novel', payload.blocks, true);
      }
      return relayWorkspace(await callWorkspace('POST', '/internal/drafts', payload));
    });
  }

  /** PUT /drafts/:id: autosave from the editor ({...fields, content_blocks, expected_version}); the owner only. */
  save(id: string, user: DraftUser, body: any) {
    return clientErrors(async (): Promise<Reply> => {
      if (!isUuid(id)) return refuse(404, 'Bản nháp không tồn tại.');
      const current = await callWorkspace('GET', `/internal/drafts/${id}`);
      if (current.status !== 200) return relayWorkspace(current);
      const d = current.json.data;
      // someone the draft is shared with for editing must still take part in the story (the workspace checks the share and the lock)
      if (d.owner_id !== user.id && !(await storyRole(user.id, d.story_id)).contributor) {
        return refuse(403, 'Bạn không có quyền sửa bản nháp này.');
      }
      body = body || {};
      const blocks = normalizeContentBlocks(body.content_blocks);
      checkBlocksMatchStoryType('novel', blocks, true);
      return relayWorkspace(await callWorkspace('PUT', `/internal/drafts/${id}`, {
        owner_id: user.id,
        meta: await this.draftMeta(body, d.story_id),
        blocks,
        expected_version: Number.isInteger(body.expected_version) ? body.expected_version : 0,
      }));
    });
  }

  /**
   * POST /drafts/:id/publish: into the official line. Story keepers only (owner, group leader/mod): their own draft
   * (a direct edit), or a proposal sent by a contributor (merged by diff3 when the official version moved meanwhile).
   */
  publish(id: string, user: DraftUser, body: any) {
    return clientErrors(async (): Promise<Reply> => {
      const loaded = await this.workspaceDraft(id);
      if ('reply' in loaded) return loaded.reply;
      const d = loaded.draft;
      const own = d.owner_id === user.id;
      if (!own && d.status !== 'submitted' && d.status !== 'scheduled') return refuse(403, 'Đây không phải bản nháp của bạn.');

      const story = await this.novelStory(d.story_id);
      if (story.approval_status === 'rejected') {
        return refuse(409, 'Truyện đang bị gỡ: chưa đăng được chương cho tới khi được khôi phục.');
      }
      const role = await storyRole(user.id, d.story_id);
      if (!role.keeper) {
        return refuse(403, own
          ? 'Chỉ người giữ truyện (chủ truyện, Trưởng nhóm/Mod nhóm) đưa thẳng vào bản chính. Hãy bấm "Gửi đề xuất" để họ duyệt.'
          : 'Chỉ người giữ truyện (chủ truyện, Trưởng nhóm/Mod nhóm) gộp được đề xuất.');
      }
      checkBlocksMatchStoryType('novel', d.blocks || [], false);
      // the volume may have been deleted since the draft picked it
      if (d.meta.volume_id && !(await this.repo.volumeInStory(d.meta.volume_id, d.story_id))) {
        throw new InputError('Tập đã chọn không còn: hãy chọn lại tập rồi đăng.');
      }

      // {publish_at}: publish at that time instead (stage 4c); the workspace holds the draft and publishes it then
      if (body?.publish_at) {
        const at = new Date(body.publish_at);
        if (Number.isNaN(at.getTime())) throw new InputError('Giờ đăng không hợp lệ.');
        const sr = await callWorkspace('POST', `/internal/drafts/${d.id}/schedule`, { ...ownerOf(user), publish_at: at.toISOString() });
        if (sr.status !== 200) return relayWorkspace(sr);
        return ok({
          success: true,
          message: `Đã hẹn đăng lúc ${at.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}. Trước giờ đó vẫn đổi giờ hoặc hủy hẹn được.`,
          data: sr.json.data,
        });
      }

      const r = await callWorkspace('POST', `/internal/drafts/${d.id}/publish`, ownerOf(user));
      if (r.status !== 200) return relayWorkspace(r);
      const rev: Revision = r.json.data;
      await applyRevisionNow(rev);
      if (!own) this.notifyDraft('merged', d, [d.owner_id], user);
      const slugs = await this.repo.chapterAndStorySlug(rev.chapter_id);
      return ok({
        success: true,
        message: !own ? `Đã gộp đề xuất (phiên bản ${rev.version}).`
          : rev.version === 1 ? 'Đăng chương thành công và đã xuất bản cho độc giả' : `Đã cập nhật chương (phiên bản ${rev.version}).`,
        data: { chapter_id: rev.chapter_id, version: rev.version, slug: slugs?.slug, story_slug: slugs?.story_slug },
      });
    });
  }

  /** POST /drafts/:id/submit {note?}: the owner (a contributor of the story) proposes the draft to the keepers. */
  submit(id: string, user: DraftUser, body: any) {
    return clientErrors(async (): Promise<Reply> => {
      const loaded = await this.workspaceDraft(id);
      if ('reply' in loaded) return loaded.reply;
      const d = loaded.draft;
      if (d.owner_id !== user.id) return refuse(403, 'Đây không phải bản nháp của bạn.');
      const role = await storyRole(user.id, d.story_id);
      if (!role.contributor) return refuse(403, 'Bạn không còn tham gia truyện này nên không gửi đề xuất được.');
      checkBlocksMatchStoryType('novel', d.blocks || [], false);
      const note = typeof body?.note === 'string' ? body.note : '';
      const r = await callWorkspace('POST', `/internal/drafts/${d.id}/submit`, { ...ownerOf(user), note });
      if (r.status !== 200) return relayWorkspace(r);
      this.notifyDraft('submitted', r.json.data, role.keeperIds, user, note);
      return ok({ success: true, message: 'Đã gửi đề xuất cho người giữ truyện.', data: r.json.data });
    });
  }

  /** POST /drafts/:id/withdraw: the owner takes a proposal back to keep editing. */
  async withdraw(id: string, user: DraftUser): Promise<Reply> {
    const loaded = await this.workspaceDraft(id);
    if ('reply' in loaded) return loaded.reply;
    const d = loaded.draft;
    if (d.owner_id !== user.id) return refuse(403, 'Đây không phải bản nháp của bạn.');
    const r = await callWorkspace('POST', `/internal/drafts/${d.id}/withdraw`, ownerOf(user));
    if (r.status !== 200) return relayWorkspace(r);
    return ok({ success: true, message: 'Đã rút đề xuất, bạn có thể sửa tiếp.', data: r.json.data });
  }

  /** POST /drafts/:id/return {note?}: a keeper sends a proposal back to its author (see the paragraph comments). */
  async giveBack(id: string, user: DraftUser, body: any): Promise<Reply> {
    const loaded = await this.workspaceDraft(id);
    if ('reply' in loaded) return loaded.reply;
    const d = loaded.draft;
    const role = await storyRole(user.id, d.story_id);
    if (!role.keeper) return refuse(403, 'Chỉ người giữ truyện trả lại được đề xuất.');
    const note = typeof body?.note === 'string' ? body.note : '';
    const r = await callWorkspace('POST', `/internal/drafts/${d.id}/return`, { ...ownerOf(user), note });
    if (r.status !== 200) return relayWorkspace(r);
    this.notifyDraft('returned', d, [d.owner_id], user, note);
    return ok({ success: true, message: 'Đã trả lại đề xuất cho người viết.', data: r.json.data });
  }

  // ---- Working together on drafts (stage 4a) ----

  /** The person named in a share / hand-over, who must take part in the draft's story. Deleted accounts can't. */
  private async draftRecipient(d: any, username: unknown, me: string): Promise<{ partner: any } | { reply: Reply }> {
    const name = typeof username === 'string' ? username.trim().replace(/^@/, '') : '';
    const partner = name ? await this.repo.activeUserByUsername(name) : null;
    if (!partner) return { reply: refuse(404, 'Người dùng không tồn tại.') };
    if (partner.id === me) return { reply: refuse(400, 'Đây là bạn rồi.') };
    if (!(await storyRole(partner.id, d.story_id)).contributor) {
      return { reply: refuse(400, `${partner.display_name || partner.username} không tham gia truyện này (không phải thành viên nhóm hay cộng tác viên).`) };
    }
    return { partner };
  }

  /**
   * POST /drafts/:id/share {username, can_edit, message?}: the owner shares the draft with someone in the story and
   * sends them its card in a direct message (they can view it, make their own copy, and edit it in turn if can_edit).
   */
  share(id: string, user: DraftUser, body: any) {
    return clientErrors(async (): Promise<Reply> => {
      const loaded = await this.workspaceDraft(id);
      if ('reply' in loaded) return loaded.reply;
      const d = loaded.draft;
      const me = user.id;
      if (d.owner_id !== me) return refuse(403, 'Chỉ chủ bản nháp chia sẻ được.');
      const found = await this.draftRecipient(d, body?.username, me);
      if ('reply' in found) return found.reply;
      const partner = found.partner;
      if (await dmBlocked(me, partner.id)) return refuse(403, BLOCKED_MESSAGE);
      const canEdit = body?.can_edit === true;
      const r = await callWorkspace('POST', `/internal/drafts/${d.id}/shares`, {
        owner_id: me, user_id: partner.id, user_name: partner.display_name || partner.username, can_edit: canEdit,
      });
      if (r.status !== 200) return relayWorkspace(r);
      const text = typeof body?.message === 'string' && body.message.trim()
        ? requiredText(body.message, 2000, 'Lời nhắn')
        : canEdit ? 'Mình chia sẻ bản nháp này, bạn sửa giúp nhé (sửa lần lượt, mỗi lúc một người).' : 'Mình chia sẻ bản nháp này, bạn xem giúp nhé.';
      await sendDraftCard(me, partner.id, text, d.id);
      return ok({ success: true, message: `Đã chia sẻ với ${partner.display_name || partner.username} qua tin nhắn.`, data: r.json.data });
    });
  }

  /** POST /drafts/:id/transfer {username}: the owner hands an open draft over to someone else in the story. */
  async transfer(id: string, user: DraftUser, body: any): Promise<Reply> {
    const loaded = await this.workspaceDraft(id);
    if ('reply' in loaded) return loaded.reply;
    const d = loaded.draft;
    const me = user.id;
    if (d.owner_id !== me) return refuse(403, 'Chỉ chủ bản nháp giao được.');
    const found = await this.draftRecipient(d, body?.username, me);
    if ('reply' in found) return found.reply;
    const partner = found.partner;
    const r = await callWorkspace('POST', `/internal/drafts/${d.id}/transfer`, {
      owner_id: me, to_id: partner.id, to_name: partner.display_name || partner.username,
    });
    if (r.status !== 200) return relayWorkspace(r);
    this.notifyDraft('transferred', d, [partner.id], user);
    return ok({ success: true, message: `Đã giao bản nháp cho ${partner.display_name || partner.username}.`, data: r.json.data });
  }

  /** POST /drafts/:id/offer: a helper sends their copy back to the owner of the draft it was copied from. */
  async offer(id: string, user: DraftUser): Promise<Reply> {
    const loaded = await this.workspaceDraft(id);
    if ('reply' in loaded) return loaded.reply;
    const d = loaded.draft;
    if (d.owner_id !== user.id) return refuse(403, 'Đây không phải bản sao của bạn.');
    const r = await callWorkspace('POST', `/internal/drafts/${d.id}/offer`, ownerOf(user));
    if (r.status !== 200) return relayWorkspace(r);
    this.notifyDraft('offered', { ...d, id: d.copied_from }, [r.json.data.original_owner_id], user);
    return ok({ success: true, message: 'Đã gửi bản sửa cho chủ nháp.', data: r.json.data });
  }
}
