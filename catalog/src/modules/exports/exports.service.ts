import { Injectable } from '@nestjs/common';
import { InputError, isUuid } from '../../utils/validation';
import { listExportableChapters, loadBook, storyFingerprint } from './export-source';
import { ExportsRepository } from './exports.repository';

/** Chapter export for the workspace import and the EPUB/PDF source for the media service. */
@Injectable()
export class ExportsService {
  constructor(private readonly repo: ExportsRepository) {}

  /** Every published chapter with its content, in id order, for the workspace's one-time import. */
  async chapters(query: any) {
    const after = isUuid(String(query.after || '')) ? String(query.after) : '00000000-0000-0000-0000-000000000000';
    const limit = Math.min(500, Math.max(1, parseInt(String(query.limit)) || 100));
    const rows = await this.repo.chaptersAfter(after, limit);
    // record them, so the edit form's expected_version protects the very first edit too
    if (rows.length > 0) await this.repo.recordFirstVersions(rows.map((c: any) => c.id));
    return rows.map((c: any) => {
      let blocks: any[] = Array.isArray(c.content_blocks) ? c.content_blocks : [];
      // Older chapters: manga pages only in chapter_pages, or plain text only in `content`
      if (blocks.length === 0 && c.pages) {
        blocks = c.pages.map((p: any, i: number) => ({ id: `b${i + 1}`, type: 'image', image_url: p.image_url, ...(p.width && p.height ? { width: p.width, height: p.height } : {}) }));
      } else if (blocks.length === 0 && c.content) {
        blocks = String(c.content).split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t, i) => ({ id: `b${i + 1}`, type: 'paragraph', text: t }));
      }
      return {
        id: c.id,
        story_id: c.story_id,
        meta: { title: c.title, chapter_number: Number(c.chapter_number), volume_id: c.volume_id, intro_note: c.intro_note, outro_note: c.outro_note },
        blocks,
        author_id: c.uploader_id,
        author_name: c.author_name,
        created_at: c.created_at,
      };
    });
  }

  /** What the media service needs to accept an EPUB/PDF request. chapter_ids [] = the story only. */
  async source(body: any) {
    const { slug, story_id, chapter_ids } = body || {};
    const ids: string[] | null = Array.isArray(chapter_ids) ? chapter_ids.filter(isUuid) : null;
    const s = isUuid(story_id) ? await this.repo.storyById(story_id) : await this.repo.storyBySlug(String(slug || ''));
    if (!s) throw new InputError('Không tìm thấy truyện.', 404);
    const open = s.approval_status === 'approved' && s.allow_download;
    return {
      story_id: s.id,
      approved: s.approval_status === 'approved',
      allow_download: Boolean(s.allow_download),
      fingerprint: open ? await storyFingerprint(s.id) : '',
      chapters: open && !(ids && ids.length === 0) ? await listExportableChapters(s.id, ids) : [],
    };
  }

  /** The chapters' content, normalised for the EPUB/PDF writers. */
  book(body: any) {
    const { story_id, chapter_ids } = body || {};
    if (!isUuid(story_id) || !Array.isArray(chapter_ids) || !chapter_ids.every(isUuid)) {
      throw new InputError('story_id, chapter_ids', 400);
    }
    return loadBook(story_id, chapter_ids);
  }
}
