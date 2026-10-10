import { enqueueNotificationJob } from '../services/queue.service';
﻿import { Request, Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import {
  canUserManageStory, checkStoryReferences, parseStoryInput, sendClientError,
  grantPublisherRole,
} from './story.controller';
import { InputError, isUuid, optionalUrl, requiredText } from '../utils/validation';
import { insertWithUniqueSlug } from '../utils/ids';
import { indexStory } from '../services/search.service';
import { sanitizeRichText, sanitizeChapterHtml, richTextToPlain } from '../utils/richText';
import { callWorkspace, applyRevisionNow, Revision } from '../services/workspaceSync';

export function slugify(text: string) {
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
export function blocksToPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      let line = b.text || '';
      if (b.image_url) line += `\n![Minh Họa](${b.image_url})`;
      return line;
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Old plain-text body (no blocks): one paragraph block per blank-line-separated paragraph. */
function textToBlocks(text: string): ContentBlock[] {
  return text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean)
    .map((t, i) => ({ id: `b${i + 1}`, type: 'paragraph' as const, text: t }));
}

const authorOf = (req: AuthenticatedRequest) => ({ author_id: req.user!.id, author_name: req.user!.display_name || req.user!.username });

/** A workspace refusal (409 number taken / edited meanwhile / deleted, 404) is the user's to read; anything else is ours. */
function workspaceFailure(res: Response, r: { status: number; json: any }) {
  if (r.status === 409 || r.status === 404) return res.status(r.status).json({ success: false, message: r.json?.message || 'Không lưu được chương.' });
  throw new Error(`workspace ${r.status}: ${r.json?.message || ''}`);
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

    // Story owner, members of its group or collaborators publish straight away (no review)
    const isAuthorized = await canUserManageStory(uploaderId, story_id);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không phải chủ thầu của truyện này (người đăng, nhóm dịch phụ trách hoặc cộng tác viên) nên không có quyền đăng chương cho tác phẩm này.',
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
    } else if (!isDraft) {
      // Publishing writes over the public chapter with that number: an existing one is edited instead
      const takenRes = await pool.query(`SELECT 1 FROM chapters WHERE story_id = $1 AND chapter_number = $2`, [story_id, chapterNumber]);
      if (takenRes.rows.length > 0) {
        return res.status(409).json({ success: false, message: `Chương ${chapterNumber} đã có. Hãy sửa chương đó hoặc chọn số chương khác.` });
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
        ...authorOf(req),
      });
      if (r.status !== 201) return workspaceFailure(res, r);
      const rev: Revision = r.json.data;
      await applyRevisionNow(rev);
      return res.status(201).json({
        success: true,
        message: 'Đăng chương thành công và đã xuất bản cho độc giả',
        data: { id: rev.chapter_id, story_id, chapter_number: chapterNumber, title, slug: chapterSlug, version: rev.version },
      });
    }

    // Drafts stay in chapter_submissions until workspace drafts replace them (Plan/chapter-workspace.md, stage 2)
    const submissionRes = await pool.query(`
      INSERT INTO chapter_submissions (
        story_id, volume_id, chapter_number, title, slug,
        content_blocks, raw_content, word_count,
        uploader_id, group_id, approval_status, is_active, intro_note, outro_note
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, 'draft', false, $11, $12
      ) RETURNING *;
    `, [
      story_id, volume_id || null, chapterNumber, title, chapterSlug,
      JSON.stringify(blocks), fullPlainText, calculatedWordCount,
      uploaderId, story.group_id || null, introNote, outroNote,
    ]);

    res.status(201).json({
      success: true,
      message: 'Đã lưu bản nháp chương thành công',
      data: submissionRes.rows[0],
    });
  } catch (error: any) {
    if (sendClientError(res, error)) return;
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Fan-out to followers is queue work (RabbitMQ -> worker); call only after the chapter is committed. */
export function notifyChapterPublished(sub: { story_id: string; title: string; uploader_id: string | null }, chapterId: string) {
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
 * Who may edit or delete a published chapter: the chapter uploader, the story owner, or a leader/mod
 * of the story's translation group. Site admin/mod have no say here (they take the whole story down).
 * `chapter` must carry uploader_id, story_uploader_id and group_id.
 */
async function canUserModifyChapter(chapter: any, userId: string): Promise<boolean> {
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
 * Delete Chapter (chapter uploader, story owner, or a leader/mod of its group)
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

    if (!(await canUserModifyChapter(chapter, currentUserId))) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xóa chương này. Chỉ người đăng chương, chủ thầu truyện hoặc Trưởng nhóm/Mod của nhóm mới có quyền xóa.',
      });
    }

    // A deletion is a version too: readers lose the chapter, its history (and comments) stay and a story keeper
    // can bring it back from the chapter history.
    const r = await callWorkspace('POST', `/internal/chapters/${id}/delete`, authorOf(req));
    if (r.status !== 200) return workspaceFailure(res, r);
    await applyRevisionNow(r.json.data);

    res.json({
      success: true,
      message: `Đã xóa Chương ${chapter.chapter_number}: "${chapter.title}". Người giữ truyện có thể khôi phục trong lịch sử chương.`,
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
    try {
      await client.query('BEGIN');
      await checkStoryReferences(client, input, uploaderId);

      // Slug: the title, or title-2, title-3... when taken (checked against the database)
      const storyRes = await insertWithUniqueSlug(client, 'stories', baseSlug, (uniqueSlug) => client.query(`
        INSERT INTO stories (
          title, slug, original_title, synopsis, cover_image_url, banner_image_url,
          story_type, status, group_id, uploader_id,
          author_name, artist_name, original_language, approval_status, total_volumes, allow_download
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::story_type, $8::story_status, $9, $10, $11, $12, $13, 'approved', 1, $14
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
        input.allow_download ?? false,
      ]), true);
      story = storyRes.rows[0];
      await grantPublisherRole(client, uploaderId, story.group_id);

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

    res.status(201).json({
      success: true,
      message: 'Đăng bộ truyện mới thành công!',
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

    const isAuthorized = await canUserManageStory(req.user.id, storyId);
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
    if (!(await canUserModifyChapter({ ...chapter, group_id: chapter.effective_group_id }, req.user.id))) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền sửa chương này.' });
    }
    // The form edits the workspace's current version (the reading copy can trail it by an event after a rewind)
    const ws = await callWorkspace('GET', `/internal/chapters/${id}`);
    if (ws.status !== 200) return workspaceFailure(res, ws);
    const rev: Revision = ws.json.data;
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
        volume_id: rev.meta.volume_id,
        chapter_number: rev.meta.chapter_number,
        title: rev.meta.title,
        content: chapter.content,
        content_blocks: rev.blocks,
        intro_note: rev.meta.intro_note || '',
        outro_note: rev.meta.outro_note || '',
        pages: pagesRes.rows.map((r: any) => r.image_url),
        ws_version: rev.version, // send back as expected_version when saving
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
    if (!(await canUserModifyChapter({ ...chapter, group_id: chapter.effective_group_id }, req.user.id))) {
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
    // messages are kept unless the request sends them ('' clears one)
    const introNote = body.intro_note === undefined ? chapter.intro_note : chapterMessage(body.intro_note, 'Lời nhắn đầu chương');
    const outroNote = body.outro_note === undefined ? chapter.outro_note : chapterMessage(body.outro_note, 'Lời nhắn cuối chương');
    if (!blocksChanged && typeof raw_content === 'string') blocks = textToBlocks(plainText);

    if (volume_id) {
      const volRes = await pool.query(`SELECT 1 FROM volumes WHERE id = $1 AND story_id = $2`, [volume_id, chapter.story_id]);
      if (volRes.rows.length === 0) return res.status(400).json({ success: false, message: 'Tập không thuộc bộ truyện này.' });
    }
    const newVolumeId = volume_id === undefined ? chapter.volume_id : (volume_id || null);

    // Every save is a new version in the workspace; expected_version (from the edit form) stops two editors
    // from silently overwriting each other. The workspace refuses a number another live chapter has.
    const expected = Number.isInteger(body.expected_version) ? body.expected_version : 0;
    const r = await callWorkspace('POST', `/internal/chapters/${id}/revisions`, {
      meta: { title: newTitle, chapter_number: newNumber, volume_id: newVolumeId, intro_note: introNote || null, outro_note: outroNote || null },
      blocks,
      expected_version: expected,
      ...authorOf(req),
    });
    if (r.status !== 200) return workspaceFailure(res, r);
    const rev: Revision = r.json.data;
    await applyRevisionNow(rev);
    res.json({
      success: true,
      message: `Đã cập nhật chương (phiên bản ${rev.version}).`,
      data: { id, title: newTitle, chapter_number: newNumber, slug: `chuong-${newNumber}-${slugify(newTitle)}`.slice(0, 500), volume_id: newVolumeId, version: rev.version, story_slug: chapter.story_slug },
    });
  } catch (error: any) {
    if (sendClientError(res, error)) return;
    res.status(500).json({ success: false, message: error.message });
  }
};

// ---- Drafts (workspace stage 2, Plan/chapter-workspace.md) -----------------------------------------------
// Content goes through here to be sanitized; the workspace keeps the draft and checks its owner.
// Reading, discarding and pulling a draft carry no new content: the browser calls /api/ws directly.

const ownerOf = (req: AuthenticatedRequest) => ({ owner_id: req.user!.id, owner_name: req.user!.display_name || req.user!.username });

/** Pass a workspace answer on: its 4xx messages are the user's to read; anything else is ours. */
function relayWorkspace(res: Response, r: { status: number; json: any }) {
  if (r.status < 500) return res.status(r.status).json(r.json);
  throw new Error(`workspace ${r.status}: ${r.json?.message || ''}`);
}

/** Chapter fields of a draft from the editor (title may still be empty: it is only required to publish). */
async function draftMeta(body: any, storyId: string) {
  const title = body.title === undefined || body.title === null ? '' : String(body.title).trim();
  if (title.length > 500) throw new InputError('Tiêu đề chương tối đa 500 ký tự.');
  const volumeId = body.volume_id || null;
  if (volumeId) {
    if (!isUuid(volumeId)) throw new InputError('Tập không hợp lệ.');
    const vol = await pool.query(`SELECT 1 FROM volumes WHERE id = $1 AND story_id = $2`, [volumeId, storyId]);
    if (vol.rows.length === 0) throw new InputError('Tập không thuộc bộ truyện này.');
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
async function novelStory(storyId: string) {
  const r = await pool.query(`SELECT id, story_type, approval_status FROM stories WHERE id = $1`, [storyId]);
  if (r.rows.length === 0) throw new InputError('Bộ truyện không tồn tại.');
  if (r.rows[0].story_type === 'manga') throw new InputError('Truyện tranh chưa dùng bản nháp: hãy dùng trình đăng truyện tranh.');
  return r.rows[0];
}

/**
 * POST /drafts {story_id, chapter_id?} opens a draft of a published chapter (the caller's open one if any);
 * without chapter_id it starts a new chapter from the editor's fields. Contributors of the story only.
 */
export const createDraft = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body || {};
    let storyId = body.story_id;
    if (body.chapter_id !== undefined && body.chapter_id !== null) {
      if (!isUuid(body.chapter_id)) return res.status(404).json({ success: false, message: 'Chương không tồn tại.' });
      const ch = await pool.query(`SELECT story_id FROM chapters WHERE id = $1`, [body.chapter_id]);
      if (ch.rows.length === 0) return res.status(404).json({ success: false, message: 'Chương không tồn tại.' });
      storyId = ch.rows[0].story_id;
    }
    if (!isUuid(storyId)) return res.status(400).json({ success: false, message: 'Thiếu hoặc sai story_id.' });
    if (!(await canUserManageStory(req.user!.id, storyId))) {
      return res.status(403).json({ success: false, message: 'Bạn không tham gia truyện này nên không tạo được bản nháp.' });
    }
    await novelStory(storyId);
    const payload: any = { ...ownerOf(req), story_id: storyId };
    if (body.chapter_id) payload.chapter_id = body.chapter_id;
    else {
      payload.meta = await draftMeta(body, storyId);
      payload.blocks = normalizeContentBlocks(body.content_blocks);
      checkBlocksMatchStoryType('novel', payload.blocks, true);
    }
    relayWorkspace(res, await callWorkspace('POST', '/internal/drafts', payload));
  } catch (error: any) {
    if (sendClientError(res, error)) return;
    res.status(500).json({ success: false, message: error.message });
  }
};

/** PUT /drafts/:id: autosave from the editor ({...fields, content_blocks, expected_version}); the owner only. */
export const saveDraft = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Bản nháp không tồn tại.' });
    const current = await callWorkspace('GET', `/internal/drafts/${id}`);
    if (current.status !== 200) return relayWorkspace(res, current);
    const d = current.json.data;
    if (d.owner_id !== req.user!.id) return res.status(403).json({ success: false, message: 'Đây không phải bản nháp của bạn.' });
    const body = req.body || {};
    const blocks = normalizeContentBlocks(body.content_blocks);
    checkBlocksMatchStoryType('novel', blocks, true);
    relayWorkspace(res, await callWorkspace('PUT', `/internal/drafts/${id}`, {
      owner_id: req.user!.id,
      meta: await draftMeta(body, d.story_id),
      blocks,
      expected_version: Number.isInteger(body.expected_version) ? body.expected_version : 0,
    }));
  } catch (error: any) {
    if (sendClientError(res, error)) return;
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /drafts/:id/publish: the owner's draft becomes the official version. Same rights as before drafts
 * (stage 3 turns this into proposals merged by the story keepers): a new chapter needs a contributor,
 * an edit needs someone allowed to edit that chapter.
 */
export const publishDraft = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Bản nháp không tồn tại.' });
    const current = await callWorkspace('GET', `/internal/drafts/${id}`);
    if (current.status !== 200) return relayWorkspace(res, current);
    const d = current.json.data;
    if (d.owner_id !== req.user!.id) return res.status(403).json({ success: false, message: 'Đây không phải bản nháp của bạn.' });

    const story = await novelStory(d.story_id);
    if (story.approval_status === 'rejected') {
      return res.status(409).json({ success: false, message: 'Truyện đang bị gỡ: chưa đăng được chương cho tới khi được khôi phục.' });
    }
    let allowed: boolean;
    if (d.chapter_id) {
      const ch = await pool.query(CHAPTER_WITH_OWNERS_SQL, [d.chapter_id]);
      allowed = ch.rows.length > 0 && (await canUserModifyChapter({ ...ch.rows[0], group_id: ch.rows[0].effective_group_id }, req.user!.id));
    } else {
      allowed = await canUserManageStory(req.user!.id, d.story_id);
    }
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền đăng bản này (chỉ người đăng chương, chủ truyện hoặc Trưởng nhóm/Mod của nhóm sửa được chương đã đăng).' });
    }
    checkBlocksMatchStoryType('novel', d.blocks || [], false);
    // the volume may have been deleted since the draft picked it
    if (d.meta.volume_id) {
      const vol = await pool.query(`SELECT 1 FROM volumes WHERE id = $1 AND story_id = $2`, [d.meta.volume_id, d.story_id]);
      if (vol.rows.length === 0) throw new InputError('Tập đã chọn không còn: hãy chọn lại tập rồi đăng.');
    }

    const r = await callWorkspace('POST', `/internal/drafts/${id}/publish`, ownerOf(req));
    if (r.status !== 200) return relayWorkspace(res, r);
    const rev: Revision = r.json.data;
    await applyRevisionNow(rev);
    const slugRes = await pool.query(`SELECT c.slug, s.slug AS story_slug FROM chapters c JOIN stories s ON s.id = c.story_id WHERE c.id = $1`, [rev.chapter_id]);
    res.json({
      success: true,
      message: rev.version === 1 ? 'Đăng chương thành công và đã xuất bản cho độc giả' : `Đã cập nhật chương (phiên bản ${rev.version}).`,
      data: { chapter_id: rev.chapter_id, version: rev.version, slug: slugRes.rows[0]?.slug, story_slug: slugRes.rows[0]?.story_slug },
    });
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
    if (!(await canUserManageStory(req.user.id, vol.story_id))) {
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
    if (!(await canUserManageStory(req.user.id, vol.story_id))) {
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
    if (!(await canUserManageStory(req.user.id, storyId))) {
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
