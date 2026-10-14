import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../../infra/database/db.service';
import { insertWithUniqueSlug } from '../../utils/ids';
import type { StoryInput } from './dto/story-input';

export type ExploreOptions = {
  q?: unknown; type?: unknown; status?: unknown; tags?: unknown; exclude_tags?: unknown; language?: unknown;
  min_chapters?: unknown; sortParam?: unknown; rankedIds: string[] | null; limitNum: number; offset: number;
};

/** SQL of stories, their lists and pages, collaborators and take-downs. */
@Injectable()
export class StoriesRepository {
  constructor(private readonly db: DbService) {}

  /** Stories the user may manage: uploaded, owned by one of their groups, or as collaborator. */
  async manageable(userId: string) {
    const result = await this.db.query(`
      SELECT DISTINCT
        s.id, s.title, s.slug, s.cover_image_url, s.story_type, s.status, s.total_chapters,
        s.uploader_id, s.group_id, g.name as group_name, g.slug as group_slug
      FROM stories s
      LEFT JOIN translation_groups g ON s.group_id = g.id
      LEFT JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = $1
      LEFT JOIN story_collaborators sc ON sc.story_id = s.id AND sc.user_id = $1
      WHERE s.approval_status = 'approved'
        AND (s.uploader_id = $1 OR gm.user_id IS NOT NULL OR sc.user_id IS NOT NULL)
      ORDER BY s.title ASC
      LIMIT 500; -- shortcut: the workspace shelf holds at most 500 stories; add search/paging if someone manages more
    `, [userId]);
    return result.rows;
  }

  async recentlyUpdated() {
    const result = await this.db.query(`
      SELECT 
        s.id, s.title, s.slug, s.original_title, s.synopsis,
        s.cover_image_url, s.banner_image_url, s.story_type, s.status,
        s.original_language, s.translated_language, s.author_name, s.artist_name,
        s.total_chapters, s.total_volumes,
        s.total_views, s.total_favorites, s.total_bookmarks, s.total_comments,
        s.last_chapter_at, s.created_at,
        u.username as uploader_username,
        u.display_name as uploader_name,
        g.name as group_name,
        g.slug as group_slug,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug)
          ) FILTER (WHERE t.id IS NOT NULL), '[]'
        ) as tags,
        (
          SELECT json_build_object('title', c.title, 'chapter_number', c.chapter_number, 'slug', c.slug, 'published_at', c.published_at)
          FROM chapters c
          WHERE c.story_id = s.id AND c.is_published = true
          ORDER BY c.chapter_number DESC LIMIT 1
        ) as latest_chapter,
        (
          SELECT json_agg(cp.image_url ORDER BY cp.page_number ASC)
          FROM chapter_pages cp
          JOIN chapters c2 ON cp.chapter_id = c2.id
          WHERE c2.story_id = s.id
          LIMIT 6
        ) as illustrations
      FROM stories s
      JOIN users u ON s.uploader_id = u.id
      LEFT JOIN translation_groups g ON s.group_id = g.id
      LEFT JOIN story_tags st ON s.id = st.story_id
      LEFT JOIN tags t ON st.tag_id = t.id
      WHERE s.approval_status = 'approved'
      GROUP BY s.id, u.id, g.id
      ORDER BY s.last_chapter_at DESC NULLS LAST, s.created_at DESC
      LIMIT 16;
`);
    return result.rows;
  }

  async featuredIllustrations() {
    const result = await this.db.query(`
      SELECT 
        cp.id as page_id,
        cp.image_url,
        cp.page_number,
        c.id as chapter_id,
        c.title as chapter_title,
        c.slug as chapter_slug,
        c.chapter_number,
        s.id as story_id,
        s.title as story_title,
        s.slug as story_slug,
        s.cover_image_url as story_cover
      FROM chapter_pages cp
      JOIN chapters c ON cp.chapter_id = c.id
      JOIN stories s ON c.story_id = s.id
      WHERE s.approval_status = 'approved' AND c.is_published = true
      ORDER BY s.total_views DESC, cp.page_number ASC
      LIMIT 24;
`);
    return result.rows;
  }

  /** The explore/list page: total and one page of rows (filters and sort as the query string gave them). */
  async explore(o: ExploreOptions) {
    const { q, type, status, tags, exclude_tags, language, min_chapters, sortParam, rankedIds, limitNum, offset } = o as any;
    const baseQuery = `
      FROM stories s
      JOIN users u ON s.uploader_id = u.id
      LEFT JOIN translation_groups g ON s.group_id = g.id
      LEFT JOIN story_tags st ON s.id = st.story_id
      LEFT JOIN tags t ON st.tag_id = t.id
      WHERE s.approval_status = 'approved'
    `;

    const params: any[] = [];
    let conditions = '';

    // rankedIds: ranked story ids from Elasticsearch; null means "not available" -> SQL ILIKE fallback.
    if (q && typeof q === 'string' && q.trim()) {
      if (rankedIds !== null) {
        params.push(rankedIds);
        conditions += ` AND s.id = ANY($${params.length}::uuid[])`;
      } else {
        params.push(`%${q.trim()}%`);
        conditions += ` AND (
          s.title ILIKE $${params.length} OR 
          s.original_title ILIKE $${params.length} OR 
          s.author_name ILIKE $${params.length} OR 
          s.artist_name ILIKE $${params.length}
        )`;
      }
    }
    const rankedIdsParam = rankedIds !== null ? params.length : 0;

    // Relevance order is the default when searching; otherwise newest-updated first.
    const sort = sortParam || (rankedIds !== null ? 'relevance' : 'updated');

    if (type && type !== 'all') {
      params.push(type);
      conditions += ` AND s.story_type = $${params.length}::story_type`;
    }

    if (status && status !== 'all') {
      params.push(status);
      conditions += ` AND s.status = $${params.length}::story_status`;
    }

    if (language && language !== 'all') {
      params.push(language);
      conditions += ` AND s.original_language = $${params.length}`;
    }

    if (min_chapters && parseInt(min_chapters as string) > 0) {
      params.push(parseInt(min_chapters as string));
      conditions += ` AND s.total_chapters >= $${params.length}`;
    }

    if (tags && typeof tags === 'string' && tags.trim()) {
      const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      if (tagList.length > 0) {
        params.push(tagList);
        conditions += ` AND s.id IN (
          SELECT st2.story_id 
          FROM story_tags st2 
          JOIN tags t2 ON st2.tag_id = t2.id 
          WHERE t2.slug = ANY($${params.length}::text[])
          GROUP BY st2.story_id 
          HAVING COUNT(DISTINCT t2.slug) = ${tagList.length}
        )`;
      }
    }

    if (exclude_tags && typeof exclude_tags === 'string' && exclude_tags.trim()) {
      const excludeList = exclude_tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      if (excludeList.length > 0) {
        params.push(excludeList);
        conditions += ` AND s.id NOT IN (
          SELECT st3.story_id 
          FROM story_tags st3 
          JOIN tags t3 ON st3.tag_id = t3.id 
          WHERE t3.slug = ANY($${params.length}::text[])
        )`;
      }
    }

    let orderBy = 's.last_chapter_at DESC NULLS LAST, s.created_at DESC';
    switch (sort) {
      case 'relevance':
        orderBy = rankedIdsParam
          ? `array_position($${rankedIdsParam}::uuid[], s.id)`
          : 's.last_chapter_at DESC NULLS LAST, s.created_at DESC';
        break;
      case 'views':
        orderBy = 's.total_views DESC, s.total_favorites DESC';
        break;
      case 'favorites':
        orderBy = 's.total_favorites DESC, s.total_views DESC';
        break;
      case 'newest':
        orderBy = 's.created_at DESC';
        break;
      case 'title_asc':
        orderBy = 's.title ASC';
        break;
      case 'title_desc':
        orderBy = 's.title DESC';
        break;
      case 'updated':
      default:
        orderBy = 's.last_chapter_at DESC NULLS LAST, s.created_at DESC';
        break;
    }

    const countSql = `SELECT COUNT(DISTINCT s.id) as total ${baseQuery} ${conditions};`;
    const countRes = await this.db.query(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0');
    const totalPages = Math.ceil(total / limitNum);

    const dataSql = `
      SELECT 
        s.id, s.title, s.slug, s.original_title, s.synopsis,
        s.cover_image_url, s.banner_image_url, s.story_type, s.status,
        s.original_language, s.translated_language, s.author_name, s.artist_name,
        s.year_published, s.total_chapters, s.total_volumes,
        s.total_views, s.total_favorites, s.total_bookmarks, s.total_comments,
        s.last_chapter_at, s.created_at,
        u.username as uploader_username,
        u.display_name as uploader_name,
        g.name as group_name,
        g.slug as group_slug,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug)
          ) FILTER (WHERE t.id IS NOT NULL), '[]'
        ) as tags,
        (
          SELECT json_build_object('title', c.title, 'chapter_number', c.chapter_number, 'slug', c.slug, 'published_at', c.published_at)
          FROM chapters c
          WHERE c.story_id = s.id AND c.is_published = true
          ORDER BY c.chapter_number DESC LIMIT 1
        ) as latest_chapter,
        (
          SELECT json_agg(cp.image_url ORDER BY cp.page_number ASC)
          FROM chapter_pages cp
          JOIN chapters c2 ON cp.chapter_id = c2.id
          WHERE c2.story_id = s.id
          LIMIT 6
        ) as illustrations
      ${baseQuery} ${conditions}
      GROUP BY s.id, u.id, g.id
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;

    const dataRes = await this.db.query(dataSql, [...params, limitNum, offset]);


    return { total, rows: dataRes.rows };
  }

  /** What every reader of a story page sees the same: the story, its tags, volumes with chapters, collaborators. */
  async loadPublicStory(slug: string): Promise<any | null> {
  const result = await this.db.query(`
    SELECT 
      s.*,
      u.id as uploader_id,
      u.username as uploader_username,
      u.display_name as uploader_name,
      u.avatar_url as uploader_avatar,
      g.id as group_id,
      g.name as group_name,
      g.slug as group_slug,
      g.avatar_url as group_avatar,
      g.description as group_description,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'category_name', tc.name, 'category_label', tc.label))
        FILTER (WHERE t.id IS NOT NULL), '[]'
      ) as tags
    FROM stories s
    JOIN users u ON s.uploader_id = u.id
    LEFT JOIN translation_groups g ON s.group_id = g.id
    LEFT JOIN story_tags st ON s.id = st.story_id
    LEFT JOIN tags t ON st.tag_id = t.id
    LEFT JOIN tag_categories tc ON t.category_id = tc.id
    WHERE s.slug = $1
    GROUP BY s.id, u.id, g.id;
  `, [slug]);

  if (result.rows.length === 0) return null;
  const story = result.rows[0];

  const volumesRes = await this.db.query(`
    SELECT 
      v.id, v.title, v.volume_number, v.cover_image_url, v.description,
      COALESCE(
        json_agg(
          json_build_object(
            'id', c.id,
            'title', c.title,
            'chapter_number', c.chapter_number,
            'slug', c.slug,
            'word_count', c.word_count,
            'published_at', c.published_at,
            'total_views', c.total_views,
            'total_comments', c.total_comments
          ) ORDER BY c.chapter_number ASC
        ) FILTER (WHERE c.id IS NOT NULL), '[]'
      ) as chapters
    FROM volumes v
    LEFT JOIN chapters c ON v.id = c.volume_id AND c.is_published = true
    WHERE v.story_id = $1
    GROUP BY v.id
    ORDER BY v.volume_number ASC;
  `, [story.id]);

  story.volumes = volumesRes.rows;

  // Published chapters that belong to no volume (posted without one, or their volume was deleted)
  const looseRes = await this.db.query(`
    SELECT id, title, chapter_number, slug, word_count, published_at, total_views, total_comments
    FROM chapters
    WHERE story_id = $1 AND is_published = true AND volume_id IS NULL
    ORDER BY chapter_number ASC;
  `, [story.id]);
  story.unassigned_chapters = looseRes.rows;

  const firstChapterRes = await this.db.query(`
    SELECT id, slug, title, chapter_number 
    FROM chapters 
    WHERE story_id = $1 AND is_published = true 
    ORDER BY chapter_number ASC LIMIT 1;
  `, [story.id]);

  const latestChapterRes = await this.db.query(`
    SELECT id, slug, title, chapter_number 
    FROM chapters 
    WHERE story_id = $1 AND is_published = true 
    ORDER BY chapter_number DESC LIMIT 1;
  `, [story.id]);

  story.first_chapter = firstChapterRes.rows[0] || null;
  const collabRes = await this.db.query(`
    SELECT sc.user_id, sc.role, u.username, u.display_name, u.avatar_url
    FROM story_collaborators sc
    JOIN users u ON sc.user_id = u.id
    WHERE sc.story_id = $1
  `, [story.id]);
  story.collaborators = collabRes.rows;
  
  story.latest_chapter = latestChapterRes.rows[0] || null;
  return story;
}

  /** What every reader of a chapter sees the same: the chapter, its pages, neighbours and the chapter list. */
  async loadPublicChapter(slug: string, chapterSlug: string): Promise<{ chapter?: any; missing?: string }> {
    const storyRes = await this.db.query(`
      SELECT
        s.id, s.code, s.title, s.slug, s.story_type, s.cover_image_url, s.author_name, s.allow_download,
        g.name as group_name, g.slug as group_slug
      FROM stories s
      LEFT JOIN translation_groups g ON s.group_id = g.id
      WHERE s.slug = $1 AND s.approval_status = 'approved';
    `, [slug]);

    if (storyRes.rows.length === 0) return { missing: 'Không tìm thấy truyện' };

    const story = storyRes.rows[0];

    const chapterRes = await this.db.query(`
      SELECT
        c.*,
        v.title as volume_title,
        v.volume_number,
        u.username as uploader_username,
        u.display_name as uploader_name
      FROM chapters c
      LEFT JOIN volumes v ON c.volume_id = v.id
      JOIN users u ON c.uploader_id = u.id
      WHERE c.story_id = $1 AND c.slug = $2 AND c.is_published = true;
    `, [story.id, chapterSlug]);

    if (chapterRes.rows.length === 0) return { missing: 'Không tìm thấy chương' };

    const chapter = chapterRes.rows[0];
    chapter.code = `${story.code}-C${Number(chapter.chapter_number)}`; // LN-JA-G03-0042-C12 (C12.5 for half chapters)

    if (story.story_type === 'manga') {
      const pagesRes = await this.db.query(`
        SELECT page_number, image_url, width, height
        FROM chapter_pages
        WHERE chapter_id = $1
        ORDER BY page_number ASC;
      `, [chapter.id]);
      chapter.pages = pagesRes.rows;
    }

    const prevRes = await this.db.query(`
      SELECT slug, title, chapter_number
      FROM chapters
      WHERE story_id = $1 AND chapter_number < $2 AND is_published = true
      ORDER BY chapter_number DESC LIMIT 1;
    `, [story.id, chapter.chapter_number]);

    const nextRes = await this.db.query(`
      SELECT slug, title, chapter_number
      FROM chapters
      WHERE story_id = $1 AND chapter_number > $2 AND is_published = true
      ORDER BY chapter_number ASC LIMIT 1;
    `, [story.id, chapter.chapter_number]);

    chapter.prev_chapter = prevRes.rows[0] || null;
    chapter.next_chapter = nextRes.rows[0] || null;

    const allChaptersRes = await this.db.query(`
      SELECT
        c.id, c.title, c.chapter_number, c.slug,
        v.title as volume_title, v.volume_number
      FROM chapters c
      LEFT JOIN volumes v ON c.volume_id = v.id
      WHERE c.story_id = $1 AND c.is_published = true
      ORDER BY c.chapter_number ASC;
    `, [story.id]);

    chapter.all_chapters = allChaptersRes.rows;
    chapter.story = story;
    return { chapter };
  }

  /**
   * Edits a story in one transaction. `check` runs first inside it (references, type lock, download lock);
   * the UPDATE's sets/params come from the service; `afterUpdate` replaces tags and grants the badge.
   * Returns null when the story is gone.
   */
  updateInTransaction(
    id: string,
    sets: string[],
    params: any[],
    check: (tx: Queryable, current: any) => Promise<void>,
    afterUpdate: (story: any, current: any, tx: Queryable) => Promise<void>,
  ) {
    return this.db.withTransaction(async (tx) => {
      const curRes = await tx.query(`SELECT group_id, source_name, story_type FROM stories WHERE id = $1`, [id]);
      const current = curRes.rows[0];
      await check(tx, current);
      const updateRes = await tx.query(`UPDATE stories SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *;`, params);
      if (updateRes.rows.length === 0) return null;
      const story = updateRes.rows[0];
      await afterUpdate(story, current, tx);
      return story;
    });
  }

  async hasChapters(tx: Queryable, storyId: string): Promise<boolean> {
    const usedRes = await tx.query(`
      SELECT EXISTS (SELECT 1 FROM chapters WHERE story_id = $1)
          OR EXISTS (SELECT 1 FROM chapter_submissions WHERE story_id = $1) AS used
    `, [storyId]);
    return usedRes.rows[0].used;
  }

  async replaceTags(tx: Queryable, storyId: string, tagIds: string[]) {
    await tx.query(`DELETE FROM story_tags WHERE story_id = $1`, [storyId]);
    await tx.query(`INSERT INTO story_tags (story_id, tag_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [storyId, tagIds]);
  }

  async titleAndUploader(id: string) {
    const storyRes = await this.db.query(`SELECT id, title, uploader_id FROM stories WHERE id = $1`, [id]);
    return storyRes.rows[0] || null;
  }

  async collaborators(storyId: string) {
    const result = await this.db.query(`
      SELECT sc.user_id, sc.role, sc.created_at, u.username, u.display_name, u.avatar_url
      FROM story_collaborators sc
      JOIN users u ON sc.user_id = u.id
      WHERE sc.story_id = $1
      ORDER BY sc.created_at ASC;
    `, [storyId]);
    return result.rows;
  }

  /** A live user by username or id (emails live in identity and are never looked up for other people). */
  async findActiveUser(identifier: string) {
    const targetRes = await this.db.query(
      `SELECT id, username, display_name FROM users WHERE (username = $1 OR id::text = $1) AND deleted_at IS NULL LIMIT 1`,
      [identifier],
    );
    return targetRes.rows[0] || null;
  }

  async upsertCollaborator(storyId: string, userId: string, role: string) {
    await this.db.query(`
      INSERT INTO story_collaborators (story_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (story_id, user_id) DO UPDATE SET role = EXCLUDED.role;
    `, [storyId, userId, role]);
  }

  async deleteCollaborator(storyId: string, userId: string) {
    await this.db.query(`DELETE FROM story_collaborators WHERE story_id = $1 AND user_id = $2`, [storyId, userId]);
  }

  /** Takes a story down (soft) or restores it; null when it is not in the state the change needs. */
  async setRemoved(id: string, remove: boolean, reason: string | null, byUserId: string) {
    const upd = await this.db.query(
      remove
        ? `UPDATE stories SET approval_status = 'rejected', rejection_reason = $2, removed_by = $3, removed_at = NOW()
           WHERE id = $1 AND approval_status = 'approved' RETURNING id, title, uploader_id`
        : `UPDATE stories SET approval_status = 'approved', rejection_reason = NULL, removed_by = NULL, removed_at = NULL
           WHERE id = $1 AND approval_status = 'rejected' RETURNING id, title, uploader_id`,
      remove ? [id, reason, byUserId] : [id],
    );
    return upd.rows[0] || null;
  }

  /** Titles and links of stories/chapters in any status (community shows them). */
  async brief(storyIds: string[], chapterIds: string[]) {
    const [stories, chapters] = await Promise.all([
      this.db.query(`SELECT id, title, slug, cover_image_url, story_type, author_name, code, approval_status FROM stories WHERE id = ANY($1::uuid[])`,
        [storyIds]),
      this.db.query(`SELECT id, story_id, title, slug, trim_scale(chapter_number)::text AS chapter_number FROM chapters WHERE id = ANY($1::uuid[])`,
        [chapterIds]),
    ]);
    return { stories: stories.rows, chapters: chapters.rows };
  }

  /** Stories taken down by Admin/Mod, newest first, in the row shape of the "Đã gỡ" page. */
  async removed(pattern: string | null, limit: number, purgeDays: number) {
    const where = `s.approval_status = 'rejected'
    AND ($1::text IS NULL OR s.code ILIKE $1 OR s.title ILIKE $1 OR s.original_title ILIKE $1
         OR s.author_name ILIKE $1 OR s.synopsis ILIKE $1 OR u.username ILIKE $1)`;
    const [total, rows] = await Promise.all([
      this.db.query(`SELECT count(*)::int AS n FROM stories s JOIN users u ON u.id = s.uploader_id WHERE ${where}`, [pattern]),
      this.db.query(`
      SELECT 'story' AS type, s.id, s.code, s.title, s.slug, s.cover_image_url AS image,
             u.username AS author_username, u.display_name AS author_name,
             s.rejection_reason AS reason, s.removed_at, s.removed_at + make_interval(days => $3) AS purge_at,
             r.username AS removed_by_username, r.display_name AS removed_by_name
      FROM stories s JOIN users u ON u.id = s.uploader_id LEFT JOIN users r ON r.id = s.removed_by
      WHERE ${where} ORDER BY s.removed_at DESC NULLS LAST LIMIT $2`, [pattern, limit, purgeDays]),
    ]);
    return { total: total.rows[0].n, rows: rows.rows };
  }
}
