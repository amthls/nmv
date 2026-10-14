import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

export type SyncKind = 'stories' | 'chapters';

/**
 * Rows changed since (updated_at, id), oldest first: the library service's read copies (Plan/library.md).
 * updated_at comes back as Postgres text (microseconds kept) and is handed back as `since`.
 */
const LIBRARY_ROWS = {
  stories: `SELECT s.id, s.title, s.slug, s.cover_image_url, s.author_name, s.story_type::text, s.status::text, s.approval_status::text,
      s.total_chapters, s.total_views, s.total_favorites, g.name AS group_name,
      COALESCE((SELECT json_agg(json_build_object('name', t.name, 'slug', t.slug)) FROM story_tags st JOIN tags t ON t.id = st.tag_id
                WHERE st.story_id = s.id), '[]') AS tags,
      s.group_id, s.synopsis, s.last_chapter_at, s.created_at, -- the recommender's copy (library ignores them)
      s.updated_at::text AS updated_at
    FROM stories s LEFT JOIN translation_groups g ON g.id = s.group_id`,
  chapters: `SELECT c.id, c.story_id, c.title, c.slug, c.chapter_number::text, c.is_published, c.updated_at::text AS updated_at
    FROM chapters c`,
};

@Injectable()
export class LibrarySyncRepository {
  constructor(private readonly db: DbService) {}

  async byIds(kind: SyncKind, ids: string[]) {
    const t = kind === 'stories' ? 's' : 'c';
    const r = await this.db.query(`${LIBRARY_ROWS[kind]} WHERE ${t}.id = ANY($1::uuid[])`, [ids]);
    return r.rows;
  }

  /** Rows from the last 2 seconds wait for the next call (a transaction still open could commit with an older time). */
  async changedSince(kind: SyncKind, since: string, after: string, limit: number) {
    const t = kind === 'stories' ? 's' : 'c';
    const r = await this.db.query(
      `${LIBRARY_ROWS[kind]} WHERE (${t}.updated_at, ${t}.id) > ($1::timestamptz, $2::uuid) AND ${t}.updated_at < NOW() - INTERVAL '2 seconds'
     ORDER BY ${t}.updated_at, ${t}.id LIMIT $3`, [since, after, limit]);
    return r.rows;
  }

  async allIds(table: 'stories' | 'chapters'): Promise<string[]> {
    const r = await this.db.query(`SELECT id FROM ${table}`);
    return r.rows.map((row: any) => row.id);
  }
}
