import { Injectable } from '@nestjs/common';
import { slugify } from '../../common/utils/slugify';
import { applyRevisionNow } from './workspace-sync.job';
import { callWorkspace, Revision, workspaceFailure } from '../../infra/clients/workspace.client';
import { InputError, isUuid, requiredText } from '../../utils/validation';
import { canUserManageStory, clientErrors, storyRole } from '../stories/story-access';
import {
  blocksToPlainText, chapterMessage, checkBlocksMatchStoryType, ContentBlock, normalizeContentBlocks, parseChapterNumber, textToBlocks,
} from './dto/chapter-content';
import { ChaptersRepository } from './chapters.repository';

export type ChapterUser = { id: string; username: string; display_name?: string; roles?: string[] };

const authorOf = (user: ChapterUser) => ({ author_id: user.id, author_name: user.display_name || user.username });

/** Published chapters: post, read for edit, edit, delete. Every write is a new version in the workspace. */
@Injectable()
export class ChaptersService {
  constructor(private readonly repo: ChaptersRepository) {}

  /** Who may edit or delete a published chapter: the uploader, the story owner, or a leader/mod of its group. */
  private async canUserModifyChapter(chapter: any, userId: string): Promise<boolean> {
    if (chapter.uploader_id === userId || chapter.story_uploader_id === userId) return true;
    if (chapter.group_id) {
      const role = await this.repo.groupRole(chapter.group_id, userId);
      if (role && ['leader', 'mod'].includes(role)) return true;
    }
    return false;
  }

  /** POST /chapters/submissions: publish a chapter at once, or keep it as a draft submission. */
  submit(user: ChapterUser, body: any) {
    return clientErrors(async () => {
      body = body || {};
      const { story_id, volume_id, raw_content } = body;
      const isDraft = body.is_draft === true;

      if (!isUuid(story_id)) throw new InputError('Thiếu hoặc sai story_id.', 400);
      const title = requiredText(body.title, 500, 'Tiêu đề chương');
      const numberGiven = !(body.chapter_number === undefined || body.chapter_number === null || body.chapter_number === '');
      let chapterNumber = numberGiven ? parseChapterNumber(body.chapter_number) : 0;
      const blocks = normalizeContentBlocks(body.content_blocks);
      const introNote = chapterMessage(body.intro_note, 'Lời nhắn đầu chương');
      const outroNote = chapterMessage(body.outro_note, 'Lời nhắn cuối chương');
      if (volume_id && !isUuid(volume_id)) throw new InputError('Tập không hợp lệ.');

      const uploaderId = user.id;

      // Story owner, members of its group or collaborators publish straight away (no review)
      const isAuthorized = await canUserManageStory(uploaderId, story_id);
      if (!isAuthorized) {
        throw new InputError('Bạn không phải chủ thầu của truyện này (người đăng, nhóm dịch phụ trách hoặc cộng tác viên) nên không có quyền đăng chương cho tác phẩm này.', 403);
      }

      const story = await this.repo.story(story_id);
      if (!story) throw new InputError('Bộ truyện không tồn tại', 404);
      // Text chapters reach the official line through drafts: contributors propose, keepers publish (stage 3)
      if (!isDraft && story.story_type !== 'manga' && !(await storyRole(uploaderId, story_id)).keeper) {
        throw new InputError('Chỉ người giữ truyện đăng thẳng chương mới. Hãy viết nháp ở /dang-chuong và gửi đề xuất.', 403);
      }
      checkBlocksMatchStoryType(story.story_type, blocks, isDraft, typeof raw_content === 'string' ? raw_content : '');

      if (volume_id && !(await this.repo.volumeInStory(volume_id, story_id))) {
        throw new InputError('Tập không thuộc bộ truyện này.', 400);
      }

      if (!numberGiven) {
        chapterNumber = await this.repo.nextChapterNumber(story_id);
      } else if (!isDraft) {
        // Publishing writes over the public chapter with that number: an existing one is edited instead
        if (await this.repo.numberTaken(story_id, chapterNumber)) {
          throw new InputError(`Chương ${chapterNumber} đã có. Hãy sửa chương đó hoặc chọn số chương khác.`, 409);
        }
      }

      let fullPlainText = blocksToPlainText(blocks);
      if (blocks.length === 0 && typeof raw_content === 'string') fullPlainText = raw_content;
      const calculatedWordCount = fullPlainText.split(/\s+/).filter(Boolean).length;
      const chapterSlug = `chuong-${chapterNumber}-${slugify(title)}`.slice(0, 500);

      if (!isDraft) {
        // Publishing: version 1 in the workspace (the content's home), then the reading copy at once
        const r = await callWorkspace('POST', '/internal/chapters', {
          story_id,
          meta: { title, chapter_number: chapterNumber, volume_id: volume_id || null, intro_note: introNote, outro_note: outroNote },
          blocks: blocks.length === 0 && typeof raw_content === 'string' ? textToBlocks(raw_content) : blocks,
          ...authorOf(user),
        });
        if (r.status !== 201) return workspaceFailure(r);
        const rev: Revision = r.json.data;
        await applyRevisionNow(rev);
        return {
          message: 'Đăng chương thành công và đã xuất bản cho độc giả',
          data: { id: rev.chapter_id, story_id, chapter_number: chapterNumber, title, slug: chapterSlug, version: rev.version },
        };
      }

      // Drafts stay in chapter_submissions until workspace drafts replace them (Plan/chapter-workspace.md, stage 2)
      const submission = await this.repo.insertDraftSubmission({
        storyId: story_id, volumeId: volume_id || null, chapterNumber, title, slug: chapterSlug,
        blocks, plainText: fullPlainText, wordCount: calculatedWordCount,
        uploaderId, groupId: story.group_id || null, introNote, outroNote,
      });
      return { message: 'Đã lưu bản nháp chương thành công', data: submission };
    });
  }

  /** DELETE /chapters/:id: a deletion is a version too; a story keeper can restore it from the chapter history. */
  async remove(id: string, user: ChapterUser): Promise<string> {
    if (!isUuid(id)) throw new InputError('Chương không tồn tại.', 404);
    const chapter = await this.repo.forDelete(id);
    if (!chapter) throw new InputError('Chương không tồn tại hoặc đã bị xóa.', 404);

    if (!(await this.canUserModifyChapter(chapter, user.id))) {
      throw new InputError('Bạn không có quyền xóa chương này. Chỉ người đăng chương, chủ thầu truyện hoặc Trưởng nhóm/Mod của nhóm mới có quyền xóa.', 403);
    }

    const r = await callWorkspace('POST', `/internal/chapters/${id}/delete`, authorOf(user));
    if (r.status !== 200) return workspaceFailure(r);
    await applyRevisionNow(r.json.data);
    return `Đã xóa Chương ${chapter.chapter_number}: "${chapter.title}". Người giữ truyện có thể khôi phục trong lịch sử chương.`;
  }

  /** GET /chapters/:id: one chapter with its editable content (for the edit form). */
  async getForEdit(id: string, user: ChapterUser) {
    if (!isUuid(id)) throw new InputError('Chương không tồn tại.', 404);
    const chapter = await this.repo.withOwners(id);
    if (!chapter) throw new InputError('Chương không tồn tại.', 404);
    if (!(await this.canUserModifyChapter({ ...chapter, group_id: chapter.effective_group_id }, user.id))) {
      throw new InputError('Bạn không có quyền sửa chương này.', 403);
    }
    // The form edits the workspace's current version (the reading copy can trail it by an event after a rewind)
    const ws = await callWorkspace('GET', `/internal/chapters/${id}`);
    if (ws.status !== 200) return workspaceFailure(ws);
    const rev: Revision = ws.json.data;
    // Manga pages live in chapter_pages (imported chapters may have no image blocks at all)
    const pages = chapter.story_type === 'manga' ? await this.repo.mangaPages(id) : [];
    return {
      id: chapter.id,
      story_id: chapter.story_id,
      story_slug: chapter.story_slug,
      story_title: chapter.story_title,
      story_type: chapter.story_type,
      volume_id: rev.meta.volume_id,
      chapter_number: rev.meta.chapter_number,
      title: rev.meta.title,
      content: chapter.content,
      content_blocks: rev.blocks,
      intro_note: rev.meta.intro_note || '',
      outro_note: rev.meta.outro_note || '',
      pages,
      ws_version: rev.version, // send back as expected_version when saving
    };
  }

  /** PUT /chapters/:id: edit a published chapter in place. Does not re-notify followers and does not bump last_chapter_at. */
  update(id: string, user: ChapterUser, body: any) {
    return clientErrors(async () => {
      if (!isUuid(id)) throw new InputError('Chương không tồn tại.', 404);
      body = body || {};
      const { title, chapter_number, volume_id, content_blocks, raw_content } = body;

      const chapter = await this.repo.withOwners(id);
      if (!chapter) throw new InputError('Chương không tồn tại.', 404);
      if (!(await this.canUserModifyChapter({ ...chapter, group_id: chapter.effective_group_id }, user.id))) {
        throw new InputError('Bạn không có quyền sửa chương này.', 403);
      }
      // Text chapters are edited through drafts: only keepers write the official line directly (stage 3)
      if (chapter.story_type !== 'manga' && !(await storyRole(user.id, chapter.story_id)).keeper) {
        throw new InputError('Hãy sửa chương trên bản nháp và gửi đề xuất cho người giữ truyện.', 403);
      }

      const newTitle = (title ?? chapter.title).toString().trim();
      if (!newTitle) throw new InputError('Tiêu đề chương không được để trống.', 400);
      if (newTitle.length > 500) throw new InputError('Tiêu đề chương tối đa 500 ký tự.', 400);
      const newNumber = chapter_number === undefined || chapter_number === null ? Number(chapter.chapter_number) : parseChapterNumber(chapter_number);
      if (volume_id && !isUuid(volume_id)) throw new InputError('Tập không hợp lệ.');

      // Content: blocks win over raw text; keep the old body when neither is sent.
      let blocks: ContentBlock[] = chapter.content_blocks || [];
      let plainText: string = chapter.content || '';
      const blocksChanged = content_blocks !== undefined && content_blocks !== null;
      if (blocksChanged) {
        blocks = normalizeContentBlocks(content_blocks);
        checkBlocksMatchStoryType(chapter.story_type, blocks, false);
        plainText = blocksToPlainText(blocks);
      } else if (typeof raw_content === 'string') {
        if (chapter.story_type === 'manga') throw new InputError('Chương truyện tranh không sửa được bằng văn bản.');
        plainText = raw_content;
      }
      // messages are kept unless the request sends them ('' clears one)
      const introNote = body.intro_note === undefined ? chapter.intro_note : chapterMessage(body.intro_note, 'Lời nhắn đầu chương');
      const outroNote = body.outro_note === undefined ? chapter.outro_note : chapterMessage(body.outro_note, 'Lời nhắn cuối chương');
      if (!blocksChanged && typeof raw_content === 'string') blocks = textToBlocks(plainText);

      if (volume_id && !(await this.repo.volumeInStory(volume_id, chapter.story_id))) {
        throw new InputError('Tập không thuộc bộ truyện này.', 400);
      }
      const newVolumeId = volume_id === undefined ? chapter.volume_id : (volume_id || null);

      // Every save is a new version in the workspace; expected_version (from the edit form) stops two editors
      // from silently overwriting each other. The workspace refuses a number another live chapter has.
      const expected = Number.isInteger(body.expected_version) ? body.expected_version : 0;
      const r = await callWorkspace('POST', `/internal/chapters/${id}/revisions`, {
        meta: { title: newTitle, chapter_number: newNumber, volume_id: newVolumeId, intro_note: introNote || null, outro_note: outroNote || null },
        blocks,
        expected_version: expected,
        ...authorOf(user),
      });
      if (r.status !== 200) return workspaceFailure(r);
      const rev: Revision = r.json.data;
      await applyRevisionNow(rev);
      return {
        message: `Đã cập nhật chương (phiên bản ${rev.version}).`,
        data: { id, title: newTitle, chapter_number: newNumber, slug: `chuong-${newNumber}-${slugify(newTitle)}`.slice(0, 500), volume_id: newVolumeId, version: rev.version, story_slug: chapter.story_slug },
      };
    });
  }
}
