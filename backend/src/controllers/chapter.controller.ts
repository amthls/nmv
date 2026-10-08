import { enqueueNotificationJob } from '../services/queue.service';
﻿import { Request, Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import {
  canUserManageStory, checkStoryReferences, parseStoryInput, sendClientError,
  storyApprovalFor, grantPublisherRole, notifyGroupStoryPending,
} from './story.controller';
import { InputError, isUuid, optionalUrl, requiredText } from '../utils/validation';
import { insertWithUniqueSlug } from '../utils/ids';
import { indexStory } from '../services/search.service';
import { sanitizeRichText, sanitizeChapterHtml, richTextToPlain } from '../utils/richText';

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

export interface ContentBlock {
  id: string;
  type: 'paragraph' | 'heading' | 'image' | 'separator';
  text?: string;
  note?: string; // Translator Note on this line
  image_url?: string; // Inline illustration at this line (or one manga page)
  html?: string; // formatted block from the chapter editor (sanitized); `text` is its plain text
  width?: number; // pixel size of image_url, when known
  height?: number;
}

const pixelSize = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= 100000 ? (v as number) : undefined);

type Db = { query: (text: string, params?: any[]) => Promise<any> };

const BLOCK_TYPES = ['paragraph', 'heading', 'image', 'separator'];

/** Validates chapter content blocks from the editor and keeps only the fields the reader uses. */
function normalizeContentBlocks(input: unknown): ContentBlock[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 5000) throw new InputError('Nội dung chương không hợp lệ.');
  return input.map((raw: any, idx: number) => {
    if (!raw || typeof raw !== 'object') throw new InputError(`Đoạn ${idx + 1} không hợp lệ.`);
    const { text, note } = raw;
    if (text !== undefined && text !== null && typeof text !== 'string') throw new InputError(`Đoạn ${idx + 1} không hợp lệ.`);
    if (note !== undefined && note !== null && typeof note !== 'string') throw new InputError(`Ghi chú đoạn ${idx + 1} không hợp lệ.`);
    if ((text || '').length > 50000) throw new InputError(`Đoạn ${idx + 1} quá dài.`);
    const block: ContentBlock = {
      id: typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id : `b${idx + 1}`,
      type: BLOCK_TYPES.includes(raw.type) ? raw.type : 'paragraph',
    };
    if (text) block.text = text;
    if (note && note.trim()) block.note = note.trim().slice(0, 5000);
    if (raw.html !== undefined && raw.html !== null) {
      if (typeof raw.html !== 'string' || raw.html.length > 100000) throw new InputError(`Đoạn ${idx + 1} không hợp lệ.`);
      let html = sanitizeChapterHtml(raw.html);
      const isTable = /^<figure[^>]*>\s*<table/i.test(html);
      if (/^<figure/i.test(html) && !isTable && !/<img\s/i.test(html)) html = ''; // its image was not one of ours
      if (html) {
        block.html = html;
        // the plain text always follows the formatted version (search, word count, bookmarks, exports)
        const plain = /^<figure/i.test(html) && !isTable ? '' : richTextToPlain(html);
        if (plain) block.text = plain;
        else delete block.text;
        const tag = (html.match(/^<([a-z0-9]+)/i)?.[1] || '').toLowerCase();
        block.type = tag === 'hr' ? 'separator' : tag === 'figure' && !isTable ? 'image' : /^h[2-4]$/.test(tag) ? 'heading' : 'paragraph';
        if (tag === 'figure' && !isTable && raw.image_url === undefined) raw.image_url = html.match(/<img[^>]*\ssrc="([^"]+)"/i)?.[1];
      }
    }
    const imageUrl = optionalUrl(raw.image_url, `Ảnh minh họa đoạn ${idx + 1}`);
    if (imageUrl) {
      block.image_url = imageUrl;
      const width = pixelSize(raw.width);
      const height = pixelSize(raw.height);
      if (width && height) { block.width = width; block.height = height; }
    }
    return block;
  });
}

/**
 * A manga chapter is a list of page images; a novel chapter is text (illustrations hang off paragraphs).
 * Stops a text chapter landing in a manga (the reader would show no pages) and the reverse.
 */
function checkBlocksMatchStoryType(storyType: string, blocks: ContentBlock[], isDraft: boolean, rawText = '') {
  const hasText = (b: ContentBlock) => Boolean(b.text && b.text.trim());
  if (storyType === 'manga') {
    if (blocks.some((b) => !b.image_url || hasText(b))) {
      throw new InputError('Đây là truyện tranh: chương chỉ gồm các trang ảnh. Hãy dùng trình đăng truyện tranh.');
    }
    if (!isDraft && blocks.length === 0) throw new InputError('Chương truyện tranh cần ít nhất một trang ảnh.');
    return;
  }
  if (blocks.length > 0 && !blocks.some(hasText)) {
    throw new InputError('Đây là truyện chữ: chương cần có nội dung văn bản. Chương chỉ gồm trang ảnh hãy đăng vào truyện tranh.');
  }
  if (!isDraft && blocks.length === 0 && !rawText.trim()) throw new InputError('Nội dung chương đang trống.');
}

/** Plain text of the blocks (inline images as markdown) for search, word count and the `content` column. */
function blocksToPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      let line = b.text || '';
      if (b.image_url) line += `\n![Minh Họa](${b.image_url})`;
      return line;
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Optional translator message shown before / after the chapter text (rich text, may be cleared). */
function chapterMessage(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 50000) throw new InputError(`${label} không hợp lệ.`);
  return sanitizeRichText(value) || null;
}

/** Chapter numbers may be decimal (e.g. 10.5 for an extra) but never negative. */
function parseChapterNumber(value: unknown): number {
  const num = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num) || num < 0 || num >= 1e8) {
    throw new InputError('Số chương phải là số từ 0 trở lên.');
  }
  return Math.round(num * 100) / 100;
}

export const submitChapter = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Bạn chưa đăng nhập. Vui lòng đăng nhập để đăng chương truyện.',
      });
    }

    const body = req.body || {};
    const { story_id, volume_id, raw_content } = body;
    const isDraft = body.is_draft === true;

    if (!isUuid(story_id)) {
      return res.status(400).json({ success: false, message: 'Thiếu hoặc sai story_id.' });
    }
    const title = requiredText(body.title, 500, 'Tiêu đề chương');
    const numberGiven = !(body.chapter_number === undefined || body.chapter_number === null || body.chapter_number === '');
    let chapterNumber = numberGiven ? parseChapterNumber(body.chapter_number) : 0;
    const blocks = normalizeContentBlocks(body.content_blocks);
    const introNote = chapterMessage(body.intro_note, 'Lời nhắn đầu chương');
    const outroNote = chapterMessage(body.outro_note, 'Lời nhắn cuối chương');
    if (volume_id && !isUuid(volume_id)) throw new InputError('Tập không hợp lệ.');

    const uploaderId = req.user.id;
    const userRoles = req.user.roles || [];

    // Check permissions: ONLY Story Owner, Assigned Group Members, or Admin/Mod
    const isAuthorized = await canUserManageStory(uploaderId, story_id, userRoles);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không phải chủ thầu của truyện này (người đăng, nhóm dịch phụ trách hoặc Admin/Mod) nên không có quyền đăng chương cho tác phẩm này.',
      });
    }

    const storyRes = await pool.query(`SELECT * FROM stories WHERE id = $1`, [story_id]);
    if (storyRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bộ truyện không tồn tại' });
    }
    const story = storyRes.rows[0];
    checkBlocksMatchStoryType(story.story_type, blocks, isDraft, typeof raw_content === 'string' ? raw_content : '');

    if (volume_id) {
      const volRes = await pool.query(`SELECT 1 FROM volumes WHERE id = $1 AND story_id = $2`, [volume_id, story_id]);
      if (volRes.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Tập không thuộc bộ truyện này.' });
      }
    }

    if (!numberGiven) {
      // Next free number after every chapter and pending/draft submission of this story
      const nextRes = await pool.query(`
        SELECT FLOOR(COALESCE(MAX(n), 0)) + 1 AS next FROM (
          SELECT chapter_number AS n FROM chapters WHERE story_id = $1
          UNION ALL
          SELECT chapter_number FROM chapter_submissions WHERE story_id = $1
        ) all_numbers
      `, [story_id]);
      chapterNumber = Number(nextRes.rows[0].next);
    }

    let fullPlainText = blocksToPlainText(blocks);
    if (blocks.length === 0 && typeof raw_content === 'string') fullPlainText = raw_content;
    const calculatedWordCount = fullPlainText.split(/\s+/).filter(Boolean).length;

    const chapterSlug = `chuong-${chapterNumber}-${slugify(title)}`.slice(0, 500);
    // Always the story's own group: a group_id from the request must not decide who may self-approve
    const actualGroupId = story.group_id;

    // Check if uploader is leader/mod of the group or site admin/mod
    let isLeader = false;
    if (userRoles.includes('admin') || userRoles.includes('mod') || story.uploader_id === uploaderId) {
      isLeader = true;
    } else if (actualGroupId) {
      const memRes = await pool.query(`
        SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
      `, [actualGroupId, uploaderId]);
      if (memRes.rows.length > 0 && ['leader', 'mod'].includes(memRes.rows[0].role)) {
        isLeader = true;
      }
    }

    const initialApproval = isDraft ? 'draft' : (isLeader ? 'approved' : 'pending');

    // Submission and (when approved) the public chapter are written together or not at all
    const client = await pool.connect();
    let submission: any;
    let publishedChapterId: string | undefined;
    try {
      await client.query('BEGIN');
      const submissionRes = await client.query(`
        INSERT INTO chapter_submissions (
          story_id, volume_id, chapter_number, title, slug,
          content_blocks, raw_content, word_count,
          uploader_id, group_id, approval_status, is_active, intro_note, outro_note
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14
        ) RETURNING *;
      `, [
        story_id,
        volume_id || null,
        chapterNumber,
        title,
        chapterSlug,
        JSON.stringify(blocks),
        fullPlainText,
        calculatedWordCount,
        uploaderId,
        actualGroupId || null,
        initialApproval,
        initialApproval === 'approved',
        introNote,
        outroNote,
      ]);
      submission = submissionRes.rows[0];

      if (initialApproval === 'approved') {
        publishedChapterId = await syncSubmissionToPublicChapter(client, submission);
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    if (publishedChapterId) notifyChapterPublished(submission, publishedChapterId);

    res.status(201).json({
      success: true,
      message: isDraft
        ? 'Đã lưu bản nháp chương thành công'
        : (initialApproval === 'approved'
            ? 'Đăng chương thành công và đã xuất bản cho độc giả'
            : 'Đã nộp bản dịch chương, vui lòng chờ Trưởng nhóm hoặc Chủ thầu duyệt'),
      data: submission,
    });
  } catch (error: any) {
    if (sendClientError(res, error)) return;
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Publishes a submission as the public chapter (run inside the caller's transaction). */
async function syncSubmissionToPublicChapter(db: Db, sub: any): Promise<string | undefined> {
  // Extract line annotations and inline images
  const translatorNotes = sub.content_blocks
    ? sub.content_blocks.filter((b: any) => b.note).map((b: any) => ({ text: b.text, note: b.note }))
    : [];

  const chapterRes = await db.query(`
    INSERT INTO chapters (
      story_id, volume_id, chapter_number, title, slug,
      content, content_blocks, word_count, is_published,
      approval_status, uploader_id, group_id, translator_notes, intro_note, outro_note, published_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::jsonb, $8, true, 'approved', $9, $10, $11::jsonb, $12, $13, NOW()
    )
    ON CONFLICT (story_id, chapter_number) DO UPDATE SET
      volume_id = EXCLUDED.volume_id,
      title = EXCLUDED.title,
      slug = EXCLUDED.slug,
      content = EXCLUDED.content,
      content_blocks = EXCLUDED.content_blocks,
      word_count = EXCLUDED.word_count,
      uploader_id = EXCLUDED.uploader_id,
      group_id = EXCLUDED.group_id,
      translator_notes = EXCLUDED.translator_notes,
      intro_note = EXCLUDED.intro_note,
      outro_note = EXCLUDED.outro_note,
      updated_at = NOW()
    RETURNING id;
  `, [
    sub.story_id,
    sub.volume_id || null,
    sub.chapter_number,
    sub.title,
    sub.slug,
    sub.raw_content,
    JSON.stringify(sub.content_blocks || []),
    sub.word_count,
    sub.uploader_id,
    sub.group_id,
    JSON.stringify(translatorNotes),
    sub.intro_note || null,
    sub.outro_note || null,
  ]);

  const chapterId = chapterRes.rows[0]?.id;

  // Rebuild inline-image pages (a new version may have fewer images than the old one)
  if (chapterId) await db.query(`DELETE FROM chapter_pages WHERE chapter_id = $1`, [chapterId]);
  if (chapterId && Array.isArray(sub.content_blocks)) {
    const inlineImages = sub.content_blocks.filter((b: any) => b.image_url);
    for (let i = 0; i < inlineImages.length; i++) {
      await db.query(`
        INSERT INTO chapter_pages (chapter_id, page_number, image_url, width, height)
        VALUES ($1, $2, $3, $4, $5);
      `, [chapterId, i + 1, inlineImages[i].image_url, inlineImages[i].width || null, inlineImages[i].height || null]);
    }
  }

  // Update story total chapters and last_chapter_at
  await db.query(`
    UPDATE stories SET
      total_chapters = (SELECT count(*) FROM chapters WHERE story_id = $1 AND is_published = true),
      last_chapter_at = NOW(),
      updated_at = NOW()
    WHERE id = $1;
  `, [sub.story_id]);

  // Mark this submission as active
  await db.query(`
    UPDATE chapter_submissions SET is_active = (id = $1)
    WHERE story_id = $2 AND chapter_number = $3;
  `, [sub.id, sub.story_id, sub.chapter_number]);

  return chapterId;
}

/** Fan-out to followers is queue work (RabbitMQ -> worker); call only after the chapter is committed. */
function notifyChapterPublished(sub: any, chapterId: string) {
  enqueueNotificationJob({
    kind: 'chapter_published',
    storyId: sub.story_id,
    chapterId,
    chapterTitle: sub.title,
    uploaderId: sub.uploader_id || null,
  }).catch((err: any) => {
    console.error('[Notification] Failed to enqueue chapter notifications:', err);
  });
}

/**
 * Who may edit or delete a published chapter: Admin/Mod, the chapter uploader,
 * the story owner, or a leader/mod of the story's translation group.
 * `chapter` must carry uploader_id, story_uploader_id and group_id.
 */
async function canUserModifyChapter(chapter: any, userId: string, userRoles: string[]): Promise<boolean> {
  if (userRoles.includes('admin') || userRoles.includes('mod')) return true;
  if (chapter.uploader_id === userId || chapter.story_uploader_id === userId) return true;
  if (chapter.group_id) {
    const gRes = await pool.query(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [chapter.group_id, userId]
    );
    if (gRes.rows.length > 0 && ['leader', 'mod'].includes(gRes.rows[0].role)) return true;
  }
  return false;
}

/**
 * Delete Chapter (Admin, Mod, Story Owner, or Chapter Uploader)
 */
export const deleteChapter = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(404).json({ success: false, message: 'Chương không tồn tại.' });
    }
    const currentUserId = req.user.id;
    const userRoles = req.user.roles || [];

    const chapterRes = await pool.query(
      `SELECT c.id, c.title, c.chapter_number, c.story_id, c.uploader_id, s.uploader_id as story_uploader_id, s.group_id
       FROM chapters c
       JOIN stories s ON c.story_id = s.id
       WHERE c.id = $1`,
      [id]
    );

    if (chapterRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chương không tồn tại hoặc đã bị xóa.' });
    }

    const chapter = chapterRes.rows[0];

    if (!(await canUserModifyChapter(chapter, currentUserId, userRoles))) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xóa chương này. Chỉ người đăng chương, chủ thầu truyện hoặc Admin/Mod mới có quyền xóa.',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Delete chapter pages, submissions, comments
      await client.query(`DELETE FROM chapter_pages WHERE chapter_id = $1`, [id]);
      await client.query(`DELETE FROM chapter_submissions WHERE story_id = $1 AND chapter_number = $2`, [chapter.story_id, chapter.chapter_number]);
      await client.query(`DELETE FROM comments WHERE target_type = 'chapter' AND target_id = $1`, [id]);
      await client.query(`DELETE FROM reading_history WHERE chapter_id = $1`, [id]);
      await client.query(`DELETE FROM story_views WHERE chapter_id = $1`, [id]);

      // 2. Delete chapter
      await client.query(`DELETE FROM chapters WHERE id = $1`, [id]);

      // 3. Update story total_chapters count
      await client.query(`
        UPDATE stories SET
          total_chapters = (SELECT count(*) FROM chapters WHERE story_id = $1 AND is_published = true),
          updated_at = NOW()
        WHERE id = $1;
      `, [chapter.story_id]);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({
      success: true,
      message: `Đã xóa Chương ${chapter.chapter_number}: "${chapter.title}" thành công!`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Chapter submissions (unpublished translations) for review. Signed-in only: site admin/mod see
 * everything; otherwise the caller must be a member of the requested group or the owner of the
 * requested story. The list never includes the chapter text itself.
 */
export const getChapterSubmissions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    const { story_id, chapter_number, group_id, status } = req.query;

    if ((story_id !== undefined && !isUuid(story_id)) || (group_id !== undefined && !isUuid(group_id))) {
      return res.status(400).json({ success: false, message: 'Tham số không hợp lệ.' });
    }
    if (status !== undefined && !['pending', 'approved', 'rejected'].includes(String(status))) {
      return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ.' });
    }
    if (chapter_number !== undefined && !Number.isFinite(Number(chapter_number))) {
      return res.status(400).json({ success: false, message: 'Số chương không hợp lệ.' });
    }

    const userRoles = req.user.roles || [];
    if (!userRoles.includes('admin') && !userRoles.includes('mod')) {
      let allowed = false;
      if (group_id) {
        const mem = await pool.query(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [group_id, req.user.id]);
        allowed = mem.rows.length > 0;
      } else if (story_id) {
        const own = await pool.query(`SELECT 1 FROM stories WHERE id = $1 AND uploader_id = $2`, [story_id, req.user.id]);
        allowed = own.rows.length > 0;
      }
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'Chỉ thành viên nhóm dịch mới xem được các bản dịch đang chờ duyệt.' });
      }
    }

    const params: any[] = [];
    let conditions = 'WHERE 1=1';

    if (story_id) {
      params.push(story_id);
      conditions += ` AND cs.story_id = $${params.length}::uuid`;
    }

    if (chapter_number) {
      params.push(chapter_number);
      conditions += ` AND cs.chapter_number = $${params.length}`;
    }

    if (group_id) {
      params.push(group_id);
      conditions += ` AND cs.group_id = $${params.length}::uuid`;
    }

    if (status) {
      params.push(status);
      conditions += ` AND cs.approval_status = $${params.length}`;
    }

    const result = await pool.query(`
      SELECT 
        cs.id, cs.story_id, cs.volume_id, cs.chapter_number, cs.title, cs.slug, cs.word_count,
        cs.uploader_id, cs.group_id, cs.approval_status, cs.approved_by, cs.approved_at,
        cs.rejection_reason, cs.is_active, cs.created_at, cs.updated_at,
        u.username as uploader_username,
        u.display_name as uploader_name,
        u.avatar_url as uploader_avatar,
        s.title as story_title,
        s.slug as story_slug,
        g.name as group_name,
        v.title as volume_title
      FROM chapter_submissions cs
      JOIN users u ON cs.uploader_id = u.id
      JOIN stories s ON cs.story_id = s.id
      LEFT JOIN translation_groups g ON cs.group_id = g.id
      LEFT JOIN volumes v ON cs.volume_id = v.id
      ${conditions}
      ORDER BY cs.chapter_number ASC, cs.created_at DESC
      LIMIT 500;
    `, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Can this user approve/reject a chapter submission for a given story/group?
 * Mirrors the "leader" check already used in submitChapter: site admin/mod,
 * the story owner ("chủ thầu"), or a leader/mod of the group the submission
 * belongs to.
 */
async function canUserApproveSubmission(userId: string, userRoles: string[], storyId: string, groupId: string | null): Promise<boolean> {
  if (userRoles.includes('admin') || userRoles.includes('mod')) return true;

  const storyRes = await pool.query(`SELECT uploader_id FROM stories WHERE id = $1`, [storyId]);
  if (storyRes.rows.length > 0 && storyRes.rows[0].uploader_id === userId) return true;

  if (groupId) {
    const memRes = await pool.query(`
      SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
    `, [groupId, userId]);
    if (memRes.rows.length > 0 && ['leader', 'mod'].includes(memRes.rows[0].role)) return true;
  }

  return false;
}

export const approveChapterSubmission = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const { id } = req.params;
    const leaderId = req.user.id;
    const userRoles = req.user.roles || [];
    if (!isUuid(id)) {
      return res.status(404).json({ success: false, message: 'Bản dịch không tồn tại' });
    }

    const subRes = await pool.query(`SELECT * FROM chapter_submissions WHERE id = $1`, [id]);
    if (subRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bản dịch không tồn tại' });
    }

    const submission = subRes.rows[0];

    const isAuthorized = await canUserApproveSubmission(leaderId, userRoles, submission.story_id, submission.group_id);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Trưởng nhóm, Chủ thầu của truyện hoặc Admin/Mod mới có quyền duyệt bản dịch này.',
      });
    }

    // Approve and publish together; notify followers only once it is committed
    const client = await pool.connect();
    let chapterId: string | undefined;
    try {
      await client.query('BEGIN');
      await client.query(`
        UPDATE chapter_submissions SET
          approval_status = 'approved',
          approved_by = $1,
          approved_at = NOW(),
          rejection_reason = NULL,
          is_active = true,
          updated_at = NOW()
        WHERE id = $2;
      `, [leaderId, id]);
      chapterId = await syncSubmissionToPublicChapter(client, submission);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    if (chapterId) notifyChapterPublished(submission, chapterId);

    res.json({
      success: true,
      message: `Đã duyệt bản dịch Chương ${submission.chapter_number} làm phiên bản chính thức cho độc giả!`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectChapterSubmission = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    const subRes = await pool.query(`SELECT * FROM chapter_submissions WHERE id = $1`, [id]);
    if (subRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bản dịch không tồn tại' });
    }

    const submission = subRes.rows[0];

    const isAuthorized = await canUserApproveSubmission(userId, userRoles, submission.story_id, submission.group_id);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Trưởng nhóm, Chủ thầu của truyện hoặc Admin/Mod mới có quyền từ chối bản dịch này.',
      });
    }

    if (submission.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Không thể từ chối bản dịch đang là phiên bản chính thức. Hãy duyệt một bản dịch khác thay thế trước.',
      });
    }

    await pool.query(`
      UPDATE chapter_submissions SET
        approval_status = 'rejected',
        approved_by = $1,
        approved_at = NOW(),
        rejection_reason = $2,
        is_active = false,
        updated_at = NOW()
      WHERE id = $3;
    `, [userId, reason?.trim() || null, id]);

    res.json({
      success: true,
      message: `Đã từ chối bản dịch Chương ${submission.chapter_number} của "${submission.title}"`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createStory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Bạn chưa đăng nhập. Vui lòng đăng nhập để đăng truyện mới.',
      });
    }

    const input = parseStoryInput(req.body || {}, true);
    const uploaderId = req.user.id;
    const title = input.title as string;

    const baseSlug = slugify(title) || 'truyen-moi';

    // Story, its default volume and its tags are created together or not at all
    const client = await pool.connect();
    let story: any;
    let approvalStatus: 'approved' | 'pending' = 'approved';
    try {
      await client.query('BEGIN');
      await checkStoryReferences(client, input, uploaderId, req.user.roles || []);
      // No admin review: own stories go live at once; group stories wait for the group's leader/mod
      approvalStatus = await storyApprovalFor(client, uploaderId, req.user.roles || [], input.group_id ?? null);

      // Slug: the title, or title-2, title-3... when taken (checked against the database)
      const storyRes = await insertWithUniqueSlug(client, 'stories', baseSlug, (uniqueSlug) => client.query(`
        INSERT INTO stories (
          title, slug, original_title, synopsis, cover_image_url, banner_image_url,
          story_type, status, group_id, uploader_id,
          author_name, artist_name, original_language, approval_status, total_volumes, allow_download
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::story_type, $8::story_status, $9, $10, $11, $12, $13, $14::approval_status, 1, $15
        ) RETURNING *;
      `, [
        title,
        uniqueSlug,
        input.original_title ?? null,
        input.synopsis ?? null,
        input.cover_image_url ?? null,
        input.banner_image_url ?? null,
        input.story_type ?? 'novel',
        input.status ?? 'ongoing',
        input.group_id ?? null,
        uploaderId,
        input.author_name ?? null,
        input.artist_name ?? null,
        input.original_language ?? 'ja',
        approvalStatus,
        input.allow_download ?? false,
      ]), true);
      story = storyRes.rows[0];
      if (approvalStatus === 'approved') {
        await grantPublisherRole(client, uploaderId, story.group_id);
      }

      // Every story starts with Volume 1
      await client.query(
        `INSERT INTO volumes (story_id, title, volume_number) VALUES ($1, 'Tập 1', 1) ON CONFLICT DO NOTHING`,
        [story.id]
      );

      if (input.tags && input.tags.length > 0) {
        await client.query(
          `INSERT INTO story_tags (story_id, tag_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [story.id, input.tags]
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    await indexStory(story.id);
    if (approvalStatus === 'pending') notifyGroupStoryPending(story);

    res.status(201).json({
      success: true,
      message: approvalStatus === 'pending'
        ? 'Đã gửi truyện! Truyện sẽ hiển thị sau khi Trưởng nhóm hoặc Phó nhóm duyệt.'
        : 'Đăng bộ truyện mới thành công!',
      data: story,
    });
  } catch (error: any) {
    if (sendClientError(res, error)) return;
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createVolume = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const { storyId } = req.params;
    const { title, volume_number, cover_image_url, description } = req.body;

    const isAuthorized = await canUserManageStory(req.user.id, storyId, req.user.roles || []);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không phải chủ thầu của truyện này để thêm tập mới.',
      });
    }

    // No number given: take the next free one. A taken number is refused (updateVolume edits volumes).
    let num: number;
    if (volume_number === undefined || volume_number === null || volume_number === '') {
      const maxRes = await pool.query(`SELECT COALESCE(MAX(volume_number), 0) + 1 AS next FROM volumes WHERE story_id = $1`, [storyId]);
      num = Number(maxRes.rows[0].next);
    } else {
      num = Number(volume_number);
      if (!Number.isInteger(num) || num < 1 || num > 100000) {
        return res.status(400).json({ success: false, message: 'Số tập không hợp lệ.' });
      }
    }
    const volTitle = (typeof title === 'string' && title.trim()) ? title.trim().slice(0, 500) : `Tập ${num}`;
    const coverUrl = optionalUrl(cover_image_url, 'Ảnh bìa tập') ?? null;
    const desc = typeof description === 'string' ? description.trim() || null : null;

    const volRes = await pool.query(`
      INSERT INTO volumes (story_id, title, volume_number, cover_image_url, description)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (story_id, volume_number) DO NOTHING
      RETURNING *;
    `, [storyId, volTitle, num, coverUrl, desc]);
    if (volRes.rows.length === 0) {
      return res.status(409).json({ success: false, message: `Tập ${num} đã tồn tại trong bộ truyện này.` });
    }

    // Update total_volumes
    await pool.query(`
      UPDATE stories SET total_volumes = (SELECT count(*) FROM volumes WHERE story_id = $1)
      WHERE id = $1;
    `, [storyId]);

    res.status(201).json({
      success: true,
      message: `Tạo ${volTitle} thành công`,
      data: volRes.rows[0],
    });
  } catch (error: any) {
    if (sendClientError(res, error)) return;
    res.status(500).json({ success: false, message: error.message });
  }
};


const CHAPTER_WITH_OWNERS_SQL = `
  SELECT c.*, s.uploader_id AS story_uploader_id, s.slug AS story_slug, s.title AS story_title, s.story_type,
         COALESCE(c.group_id, s.group_id) AS effective_group_id
  FROM chapters c
  JOIN stories s ON c.story_id = s.id
  WHERE c.id = $1
`;

/**
 * Load one chapter with its editable content (for the edit form).
 */
export const getChapterForEdit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(404).json({ success: false, message: 'Chương không tồn tại.' });
    }
    const chRes = await pool.query(CHAPTER_WITH_OWNERS_SQL, [id]);
    if (chRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chương không tồn tại.' });
    }
    const chapter = chRes.rows[0];
    if (!(await canUserModifyChapter({ ...chapter, group_id: chapter.effective_group_id }, req.user.id, req.user.roles || []))) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền sửa chương này.' });
    }
    // Manga pages live in chapter_pages (imported chapters may have no image blocks at all)
    const pagesRes = chapter.story_type === 'manga'
      ? await pool.query(`SELECT image_url FROM chapter_pages WHERE chapter_id = $1 ORDER BY page_number`, [id])
      : { rows: [] };
    res.json({
      success: true,
      data: {
        id: chapter.id,
        story_id: chapter.story_id,
        story_slug: chapter.story_slug,
        story_title: chapter.story_title,
        story_type: chapter.story_type,
        volume_id: chapter.volume_id,
        chapter_number: chapter.chapter_number,
        title: chapter.title,
        content: chapter.content,
        content_blocks: chapter.content_blocks || [],
        intro_note: chapter.intro_note || '',
        outro_note: chapter.outro_note || '',
        pages: pagesRes.rows.map((r: any) => r.image_url),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Edit a published chapter in place (title, number, volume, content).
 * Does not re-notify followers and does not bump last_chapter_at.
 */
export const updateChapter = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(404).json({ success: false, message: 'Chương không tồn tại.' });
    }
    const { title, chapter_number, volume_id, content_blocks, raw_content } = req.body || {};
    const body = req.body || {};

    const chRes = await pool.query(CHAPTER_WITH_OWNERS_SQL, [id]);
    if (chRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chương không tồn tại.' });
    }
    const chapter = chRes.rows[0];
    if (!(await canUserModifyChapter({ ...chapter, group_id: chapter.effective_group_id }, req.user.id, req.user.roles || []))) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền sửa chương này.' });
    }

    const newTitle = (title ?? chapter.title).toString().trim();
    if (!newTitle) {
      return res.status(400).json({ success: false, message: 'Tiêu đề chương không được để trống.' });
    }
    if (newTitle.length > 500) {
      return res.status(400).json({ success: false, message: 'Tiêu đề chương tối đa 500 ký tự.' });
    }
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
    const wordCount = plainText.split(/\s+/).filter(Boolean).length;
    const translatorNotes = blocks.filter((b: any) => b.note).map((b: any) => ({ text: b.text, note: b.note }));
    const newSlug = `chuong-${newNumber}-${slugify(newTitle)}`;
    // messages are kept unless the request sends them ('' clears one)
    const introNote = body.intro_note === undefined ? chapter.intro_note : chapterMessage(body.intro_note, 'Lời nhắn đầu chương');
    const outroNote = body.outro_note === undefined ? chapter.outro_note : chapterMessage(body.outro_note, 'Lời nhắn cuối chương');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (volume_id) {
        const volRes = await client.query(`SELECT 1 FROM volumes WHERE id = $1 AND story_id = $2`, [volume_id, chapter.story_id]);
        if (volRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: 'Tập không thuộc bộ truyện này.' });
        }
      }
      if (newNumber !== Number(chapter.chapter_number)) {
        const dup = await client.query(
          `SELECT 1 FROM chapters WHERE story_id = $1 AND chapter_number = $2 AND id <> $3`,
          [chapter.story_id, newNumber, id]
        );
        if (dup.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ success: false, message: `Chương ${newNumber} đã tồn tại trong bộ truyện này.` });
        }
      }

      const newVolumeId = volume_id === undefined ? chapter.volume_id : (volume_id || null);
      const updRes = await client.query(`
        UPDATE chapters SET
          title = $1, chapter_number = $2, slug = $3, volume_id = $4,
          content = $5, content_blocks = $6::jsonb, word_count = $7, translator_notes = $8::jsonb,
          intro_note = $10, outro_note = $11, updated_at = NOW()
        WHERE id = $9
        RETURNING id, title, chapter_number, slug, volume_id, word_count, updated_at;
      `, [newTitle, newNumber, newSlug, newVolumeId, plainText, JSON.stringify(blocks), wordCount, JSON.stringify(translatorNotes), id, introNote, outroNote]);

      // Rebuild inline-image pages, only when the content itself changed (a title edit keeps the pages as they are)
      if (blocksChanged) {
        await client.query(`DELETE FROM chapter_pages WHERE chapter_id = $1`, [id]);
        const inlineImages = blocks.filter((b: any) => b.image_url);
        for (let i = 0; i < inlineImages.length; i++) {
          await client.query(
            `INSERT INTO chapter_pages (chapter_id, page_number, image_url, width, height) VALUES ($1, $2, $3, $4, $5)`,
            [id, i + 1, inlineImages[i].image_url, inlineImages[i].width || null, inlineImages[i].height || null]
          );
        }
      }

      // Keep the active submission row in sync so a later re-approve does not resurrect old text
      await client.query(`
        UPDATE chapter_submissions SET
          title = $1, chapter_number = $2, slug = $3, volume_id = $4,
          content_blocks = $5::jsonb, raw_content = $6, word_count = $7,
          intro_note = $10, outro_note = $11, updated_at = NOW()
        WHERE story_id = $8 AND chapter_number = $9 AND is_active = true;
      `, [newTitle, newNumber, newSlug, newVolumeId, JSON.stringify(blocks), plainText, wordCount, chapter.story_id, chapter.chapter_number, introNote, outroNote]);

      await client.query(`UPDATE stories SET updated_at = NOW() WHERE id = $1`, [chapter.story_id]);

      await client.query('COMMIT');
      res.json({ success: true, message: 'Đã cập nhật chương.', data: { ...updRes.rows[0], story_slug: chapter.story_slug } });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (sendClientError(res, error)) return;
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Edit a volume (title, description, cover).
 */
export const updateVolume = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }
    const { id } = req.params;
    const volRes = await pool.query(`SELECT * FROM volumes WHERE id = $1`, [id]);
    if (volRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tập không tồn tại.' });
    }
    const vol = volRes.rows[0];
    if (!(await canUserManageStory(req.user.id, vol.story_id, req.user.roles || []))) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền sửa tập của truyện này.' });
    }

    const { title, description, cover_image_url } = req.body;
    if (title !== undefined && !String(title).trim()) {
      return res.status(400).json({ success: false, message: 'Tên tập không được để trống.' });
    }
    const updRes = await pool.query(`
      UPDATE volumes SET
        title = $1, description = $2, cover_image_url = $3, updated_at = NOW()
      WHERE id = $4 RETURNING *;
    `, [
      title === undefined ? vol.title : String(title).trim(),
      description === undefined ? vol.description : (description || null),
      cover_image_url === undefined ? vol.cover_image_url : (cover_image_url || null),
      id,
    ]);
    res.json({ success: true, message: 'Đã cập nhật tập.', data: updRes.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a volume. Its chapters are kept and simply become "unassigned" (volume_id = NULL).
 */
export const deleteVolume = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }
    const { id } = req.params;
    const volRes = await pool.query(`SELECT * FROM volumes WHERE id = $1`, [id]);
    if (volRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tập không tồn tại.' });
    }
    const vol = volRes.rows[0];
    if (!(await canUserManageStory(req.user.id, vol.story_id, req.user.roles || []))) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa tập của truyện này.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE chapter_submissions SET volume_id = NULL WHERE volume_id = $1`, [id]);
      const moved = await client.query(`UPDATE chapters SET volume_id = NULL WHERE volume_id = $1`, [id]);
      await client.query(`DELETE FROM volumes WHERE id = $1`, [id]);
      await client.query(
        `UPDATE stories SET total_volumes = (SELECT count(*) FROM volumes WHERE story_id = $1) WHERE id = $1`,
        [vol.story_id]
      );
      await client.query('COMMIT');
      res.json({
        success: true,
        message: `Đã xóa "${vol.title}". ${moved.rowCount} chương của tập được giữ lại và chuyển sang "chưa phân tập".`,
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Re-order volumes of a story. Body: { order: [volumeId, ...] } (must list every volume once).
 * volume_number and sort_order are rewritten as 1..n in that order.
 */
export const reorderVolumes = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }
    const { storyId } = req.params;
    const { order } = req.body;
    if (!(await canUserManageStory(req.user.id, storyId, req.user.roles || []))) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền sắp xếp tập của truyện này.' });
    }
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, message: 'Thiếu danh sách thứ tự tập (order).' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(`SELECT id FROM volumes WHERE story_id = $1`, [storyId]);
      const existingIds = new Set<string>(existing.rows.map((r) => r.id));
      if (order.length !== existingIds.size || new Set(order).size !== order.length || !order.every((v: string) => existingIds.has(v))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Danh sách phải gồm đúng tất cả các tập của truyện, mỗi tập một lần.' });
      }
      // Two phases: (story_id, volume_number) is UNIQUE, so park numbers out of range first.
      await client.query(`UPDATE volumes SET volume_number = volume_number + 100000 WHERE story_id = $1`, [storyId]);
      for (let i = 0; i < order.length; i++) {
        await client.query(
          `UPDATE volumes SET volume_number = $1, sort_order = $1, updated_at = NOW() WHERE id = $2 AND story_id = $3`,
          [i + 1, order[i], storyId]
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const result = await pool.query(`SELECT * FROM volumes WHERE story_id = $1 ORDER BY volume_number`, [storyId]);
    res.json({ success: true, message: 'Đã sắp xếp lại các tập.', data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
