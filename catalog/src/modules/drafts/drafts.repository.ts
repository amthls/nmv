import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

/** SQL the draft routes need beside the workspace's own (stories, volumes, users). */
@Injectable()
export class DraftsRepository {
  constructor(private readonly db: DbService) {}

  async volumeInStory(volumeId: string, storyId: string): Promise<boolean> {
    const vol = await this.db.query(`SELECT 1 FROM volumes WHERE id = $1 AND story_id = $2`, [volumeId, storyId]);
    return vol.rows.length > 0;
  }

  async chapterStoryId(chapterId: string): Promise<string | null> {
    const ch = await this.db.query(`SELECT story_id FROM chapters WHERE id = $1`, [chapterId]);
    return ch.rows[0]?.story_id ?? null;
  }

  async storyForDraft(storyId: string) {
    const r = await this.db.query(`SELECT id, story_type, approval_status FROM stories WHERE id = $1`, [storyId]);
    return r.rows[0] || null;
  }

  async storyTitle(storyId: string): Promise<string | undefined> {
    const story = await this.db.query(`SELECT title FROM stories WHERE id = $1`, [storyId]);
    return story.rows[0]?.title;
  }

  async chapterAndStorySlug(chapterId: string) {
    const slugRes = await this.db.query(`SELECT c.slug, s.slug AS story_slug FROM chapters c JOIN stories s ON s.id = c.story_id WHERE c.id = $1`, [chapterId]);
    return slugRes.rows[0];
  }

  async activeUserByUsername(username: string) {
    const r = await this.db.query(`SELECT id, username, display_name FROM users WHERE username = $1 AND deleted_at IS NULL`, [username]);
    return r.rows[0];
  }
}
