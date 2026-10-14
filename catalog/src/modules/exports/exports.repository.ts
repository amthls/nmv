import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

/** SQL of what other services pull out of the catalog: chapters for the workspace import, story download flags. */
@Injectable()
export class ExportsRepository {
  constructor(private readonly db: DbService) {}

  async chaptersAfter(after: string, limit: number) {
    const r = await this.db.query(`
    SELECT c.id, c.story_id, c.title, c.chapter_number, c.volume_id, c.intro_note, c.outro_note, c.content, c.content_blocks,
           c.uploader_id, COALESCE(u.display_name, u.username) AS author_name, COALESCE(c.updated_at, c.created_at) AS created_at,
           (SELECT json_agg(json_build_object('image_url', p.image_url, 'width', p.width, 'height', p.height) ORDER BY p.page_number)
              FROM chapter_pages p WHERE p.chapter_id = c.id) AS pages
    FROM chapters c LEFT JOIN users u ON u.id = c.uploader_id
    WHERE c.id > $1 ORDER BY c.id LIMIT $2`, [after, limit]);
    return r.rows;
  }

  /** Each exported chapter becomes (or already is) version 1 in the workspace. */
  async recordFirstVersions(ids: string[]) {
    await this.db.query(`INSERT INTO ws_chapter_versions (chapter_id, version) SELECT unnest($1::uuid[]), 1 ON CONFLICT DO NOTHING`, [ids]);
  }

  async storyById(id: string) {
    const r = await this.db.query(`SELECT id, allow_download, approval_status FROM stories WHERE id = $1`, [id]);
    return r.rows[0] || null;
  }

  async storyBySlug(slug: string) {
    const r = await this.db.query(`SELECT id, allow_download, approval_status FROM stories WHERE slug = $1`, [slug]);
    return r.rows[0] || null;
  }
}
