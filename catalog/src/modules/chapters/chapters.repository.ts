import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

/** SQL of published chapters (the reading copy) and of chapter drafts kept in chapter_submissions. */
@Injectable()
export class ChaptersRepository {
  constructor(private readonly db: DbService) {}

  async story(storyId: string) {
    const storyRes = await this.db.query(`SELECT * FROM stories WHERE id = $1`, [storyId]);
    return storyRes.rows[0] || null;
  }

  async volumeInStory(volumeId: string, storyId: string): Promise<boolean> {
    const volRes = await this.db.query(`SELECT 1 FROM volumes WHERE id = $1 AND story_id = $2`, [volumeId, storyId]);
    return volRes.rows.length > 0;
  }

  /** Next free number after every chapter and pending/draft submission of the story. */
  async nextChapterNumber(storyId: string): Promise<number> {
    const nextRes = await this.db.query(`
        SELECT FLOOR(COALESCE(MAX(n), 0)) + 1 AS next FROM (
          SELECT chapter_number AS n FROM chapters WHERE story_id = $1
          UNION ALL
          SELECT chapter_number FROM chapter_submissions WHERE story_id = $1
        ) all_numbers
      `, [storyId]);
    return Number(nextRes.rows[0].next);
  }

  async numberTaken(storyId: string, chapterNumber: number): Promise<boolean> {
    const takenRes = await this.db.query(`SELECT 1 FROM chapters WHERE story_id = $1 AND chapter_number = $2`, [storyId, chapterNumber]);
    return takenRes.rows.length > 0;
  }

  async insertDraftSubmission(p: {
    storyId: string; volumeId: string | null; chapterNumber: number; title: string; slug: string;
    blocks: unknown; plainText: string; wordCount: number; uploaderId: string; groupId: string | null;
    introNote: string | null; outroNote: string | null;
  }) {
    const submissionRes = await this.db.query(`
      INSERT INTO chapter_submissions (
        story_id, volume_id, chapter_number, title, slug,
        content_blocks, raw_content, word_count,
        uploader_id, group_id, approval_status, is_active, intro_note, outro_note
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, 'draft', false, $11, $12
      ) RETURNING *;
    `, [
      p.storyId, p.volumeId, p.chapterNumber, p.title, p.slug,
      JSON.stringify(p.blocks), p.plainText, p.wordCount,
      p.uploaderId, p.groupId, p.introNote, p.outroNote,
    ]);
    return submissionRes.rows[0];
  }

  /** The member's role in a translation group, or null when not a member. */
  async groupRole(groupId: string, userId: string): Promise<string | null> {
    const gRes = await this.db.query(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId]
    );
    return gRes.rows[0]?.role ?? null;
  }

  async forDelete(id: string) {
    const chapterRes = await this.db.query(
      `SELECT c.id, c.title, c.chapter_number, c.story_id, c.uploader_id, s.uploader_id as story_uploader_id, s.group_id
       FROM chapters c
       JOIN stories s ON c.story_id = s.id
       WHERE c.id = $1`,
      [id]
    );
    return chapterRes.rows[0] || null;
  }

  async withOwners(id: string) {
    const chRes = await this.db.query(`
  SELECT c.*, s.uploader_id AS story_uploader_id, s.slug AS story_slug, s.title AS story_title, s.story_type,
         COALESCE(c.group_id, s.group_id) AS effective_group_id
  FROM chapters c
  JOIN stories s ON c.story_id = s.id
  WHERE c.id = $1
`, [id]);
    return chRes.rows[0] || null;
  }

  async mangaPages(chapterId: string): Promise<string[]> {
    const pagesRes = await this.db.query(`SELECT image_url FROM chapter_pages WHERE chapter_id = $1 ORDER BY page_number`, [chapterId]);
    return pagesRes.rows.map((r: any) => r.image_url);
  }
}
