import { Request, Response } from 'express';
import { pool } from '../config/db';
import { recordView } from '../services/viewCounter';
import { publishBehavior, visitorIdOf } from '../services/behaviorEvents';
import { AuthenticatedRequest, internalAuthHeader } from '../middlewares/auth.middleware';
import { searchStoryIds, indexStory, removeStoryFromIndex } from '../services/search.service';
import { sanitizeRichText } from '../utils/richText';
import { InputError, isUuid, optionalEnum, optionalText, optionalUrl, requiredText } from '../utils/validation';
import { clientDbError } from '../utils/dbErrors';
import { enqueueNotificationJob } from '../services/queue.service';
import { callCommunity } from '../services/communityClient';
import { callLibrary, libraryData, purgeLibrary } from '../services/libraryClient';

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

/**
 * Check if a user is authorized to manage (edit, add chapters) a story: the story uploader,
 * a member of the assigned translation group, or an assigned collaborator.
 * Site admin/mod are not included: they only delete content (see deleteStory / deleteChapter).
 */
export async function canUserManageStory(userId: string, storyId: string): Promise<boolean> {
  if (!isUuid(storyId)) return false;
  const storyRes = await pool.query(`SELECT id, uploader_id, group_id FROM stories WHERE id = $1`, [storyId]);
  if (storyRes.rows.length === 0) return false;
  const story = storyRes.rows[0];

  if (story.uploader_id === userId) return true;

  if (story.group_id) {
    const memRes = await pool.query(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [story.group_id, userId]
    );
    if (memRes.rows.length > 0) return true;
  }

  const collabRes = await pool.query(
    `SELECT 1 FROM story_collaborators WHERE story_id = $1 AND user_id = $2`,
    [storyId, userId]
  );
  if (collabRes.rows.length > 0) return true;

  return false;
}

type Queryable = { query: (text: string, params?: any[]) => Promise<any> };

/**
 * Someone with a published story becomes an author (own story) or a translator (group story). Roles are the
 * identity service's (user_roles here is a copy): ask it, the copy follows through identity.user.updated.
 * shortcut: fire-and-forget (a story rolled back afterwards still leaves the badge; identity down = no badge, logged);
 * move to the outbox when stories become the catalog service.
 */
export async function grantPublisherRole(_db: Queryable, userId: string, groupId: string | null) {
  fetch(`${IDENTITY_URL}/internal/users/${userId}/roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': internalAuthHeader('identity') },
    body: JSON.stringify({ role: groupId ? 'translator' : 'author' }),
    signal: AbortSignal.timeout(3000),
  })
    .then((r) => { if (!r.ok) console.warn(`[roles] identity refused the ${groupId ? 'translator' : 'author'} badge: ${r.status}`); })
    .catch((err) => console.warn(`[roles] could not reach identity for a badge: ${err.message}`));
}

const IDENTITY_URL = (process.env.IDENTITY_INTERNAL_URL || 'http://identity:8080').replace(/\/+$/, '');

const STORY_TYPES = ['novel', 'manga'] as const;
const STORY_STATUSES = ['ongoing', 'completed', 'hiatus', 'dropped'] as const;

/** Story fields from a create/update body. A field left undefined was not sent; null clears it. */
export interface StoryInput {
  title?: string;
  original_title?: string | null;
  synopsis?: string | null;
  cover_image_url?: string | null;
  banner_image_url?: string | null;
  story_type?: typeof STORY_TYPES[number];
  status?: typeof STORY_STATUSES[number];
  author_name?: string | null;
  artist_name?: string | null;
  original_language?: string | null;
  group_id?: string | null;
  tags?: string[];
  allow_download?: boolean; // readers may download EPUB/PDF
}

/** Validates the story fields of a request body (throws InputError). */
export function parseStoryInput(body: any, isCreate: boolean): StoryInput {
  const input: StoryInput = {};
  if (isCreate || body.title !== undefined) input.title = requiredText(body.title, 500, 'Tên truyện');
  input.original_title = optionalText(body.original_title, 500, 'Tên gốc');
  if (body.synopsis !== undefined) {
    if (body.synopsis !== null && typeof body.synopsis !== 'string') throw new InputError('Tóm tắt không hợp lệ.');
    input.synopsis = sanitizeRichText(body.synopsis) || null;
  }
  input.cover_image_url = optionalUrl(body.cover_image_url, 'Ảnh bìa');
  input.banner_image_url = optionalUrl(body.banner_image_url, 'Ảnh banner');
  input.story_type = optionalEnum(body.story_type, STORY_TYPES, 'Loại truyện');
  input.status = optionalEnum(body.status, STORY_STATUSES, 'Tình trạng');
  input.author_name = optionalText(body.author_name, 200, 'Tác giả');
  input.artist_name = optionalText(body.artist_name, 200, 'Họa sĩ');
  input.original_language = optionalText(body.original_language, 10, 'Ngôn ngữ gốc');
  if (body.group_id !== undefined) {
    if (body.group_id !== null && body.group_id !== '' && !isUuid(body.group_id)) throw new InputError('Nhóm dịch không hợp lệ.');
    input.group_id = body.group_id || null;
  }
  if (body.allow_download !== undefined) {
    if (typeof body.allow_download !== 'boolean') throw new InputError('Tùy chọn cho phép tải không hợp lệ.');
    input.allow_download = body.allow_download;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 50 || !body.tags.every(isUuid)) {
      throw new InputError('Danh sách thẻ tag không hợp lệ.');
    }
    input.tags = Array.from(new Set<string>(body.tags));
  }
  return input;
}

/** Checks that the tags exist and that the user may publish under the chosen group. */
export async function checkStoryReferences(db: { query: (text: string, params?: any[]) => Promise<any> }, input: StoryInput, userId: string) {
  if (input.tags && input.tags.length > 0) {
    const tagRes = await db.query(`SELECT count(*)::int AS n FROM tags WHERE id = ANY($1::uuid[])`, [input.tags]);
    if (tagRes.rows[0].n !== input.tags.length) throw new InputError('Có thẻ tag không tồn tại.');
  }
  if (input.group_id) {
    const groupRes = await db.query(`SELECT 1 FROM translation_groups WHERE id = $1`, [input.group_id]);
    if (groupRes.rows.length === 0) throw new InputError('Nhóm dịch không tồn tại.', 404);
    const memRes = await db.query(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [input.group_id, userId]);
    if (memRes.rows.length === 0) throw new InputError('Bạn không phải thành viên của nhóm dịch này nên không thể đăng truyện dưới tên nhóm.', 403);
  }
}

/** Sends the right status for an InputError or a client-caused DB error; returns false otherwise. */
export function sendClientError(res: Response, error: any): boolean {
  if (error instanceof InputError) {
    res.status(error.status).json({ success: false, message: error.message });
    return true;
  }
  const dbErr = clientDbError(error);
  if (dbErr) {
    res.status(dbErr.status).json({ success: false, message: dbErr.message });
    return true;
  }
  return false;
}

/**
 * List stories the current logged-in user is allowed to manage (upload chapters,
 * edit info, add collaborators): stories they uploaded, stories owned by a
 * translation group they belong to, or stories they were added as a collaborator on.
 */
export const getManageableStories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const userId = req.user.id;

    const result = await pool.query(`
      SELECT DISTINCT
        s.id, s.title, s.slug, s.story_type, s.status, s.total_chapters,
        s.uploader_id, s.group_id, g.name as group_name
      FROM stories s
      LEFT JOIN translation_groups g ON s.group_id = g.id
      LEFT JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = $1
      LEFT JOIN story_collaborators sc ON sc.story_id = s.id AND sc.user_id = $1
      WHERE s.approval_status = 'approved'
        AND (s.uploader_id = $1 OR gm.user_id IS NOT NULL OR sc.user_id IS NOT NULL)
      ORDER BY s.title ASC;
    `, [userId]);

    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTrendingStories = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
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
      ORDER BY s.total_views DESC, s.total_favorites DESC
      LIMIT 12;
    `);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getRecentlyUpdatedStories = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
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

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getFeaturedIllustrations = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
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

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const exploreStories = async (req: Request, res: Response) => {
  try {
    const {
      q,
      type,
      status,
      tags,
      exclude_tags,
      language,
      min_chapters,
      sort: sortParam,
      page = '1',
      limit = '24',
    } = req.query;

    // Bound what one request can ask for: deep OFFSETs and huge search strings are cheap DoS vectors
    const pageNum = Math.min(1000, Math.max(1, parseInt(page as string) || 1));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 24));
    const offset = (pageNum - 1) * limitNum;
    if (typeof q === 'string' && q.length > 120) {
      return res.status(400).json({ success: false, message: 'Từ khóa tìm kiếm quá dài (tối đa 120 ký tự).' });
    }

    let baseQuery = `
      FROM stories s
      JOIN users u ON s.uploader_id = u.id
      LEFT JOIN translation_groups g ON s.group_id = g.id
      LEFT JOIN story_tags st ON s.id = st.story_id
      LEFT JOIN tags t ON st.tag_id = t.id
      WHERE s.approval_status = 'approved'
    `;

    const params: any[] = [];
    let conditions = '';

    // Ranked story ids from Elasticsearch; null means "not available" -> SQL ILIKE fallback.
    let rankedIds: string[] | null = null;
    if (q && typeof q === 'string' && q.trim()) {
      rankedIds = await searchStoryIds(q.trim());
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
    const countRes = await pool.query(countSql, params);
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

    const dataRes = await pool.query(dataSql, [...params, limitNum, offset]);

    res.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getStories = async (req: Request, res: Response) => {
  return exploreStories(req, res);
};

export const getStoryBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(`
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

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy truyện' });
    }

    const story = result.rows[0];

    const volumesRes = await pool.query(`
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
    const looseRes = await pool.query(`
      SELECT id, title, chapter_number, slug, word_count, published_at, total_views, total_comments
      FROM chapters
      WHERE story_id = $1 AND is_published = true AND volume_id IS NULL
      ORDER BY chapter_number ASC;
    `, [story.id]);
    story.unassigned_chapters = looseRes.rows;

    const firstChapterRes = await pool.query(`
      SELECT id, slug, title, chapter_number 
      FROM chapters 
      WHERE story_id = $1 AND is_published = true 
      ORDER BY chapter_number ASC LIMIT 1;
    `, [story.id]);

    const latestChapterRes = await pool.query(`
      SELECT id, slug, title, chapter_number 
      FROM chapters 
      WHERE story_id = $1 AND is_published = true 
      ORDER BY chapter_number DESC LIMIT 1;
    `, [story.id]);

    story.first_chapter = firstChapterRes.rows[0] || null;
    const collabRes = await pool.query(`
      SELECT sc.user_id, sc.role, u.username, u.display_name, u.avatar_url
      FROM story_collaborators sc
      JOIN users u ON sc.user_id = u.id
      WHERE sc.story_id = $1
    `, [story.id]);
    story.collaborators = collabRes.rows;
  
    story.latest_chapter = latestChapterRes.rows[0] || null;

    const currentUserId = (req as any).user?.id;
    const currentUserRoles: string[] = (req as any).user?.roles || [];
    if (currentUserId) {
      // followed? the library service's (the page still opens if it is down)
      const fav = await libraryData(`/internal/favorites/${currentUserId}/${story.id}`, 2000).catch(() => null);
      story.is_favorite = Boolean(fav?.is_favorite);
      story.favorite_category = fav?.category || null;
      story.can_manage = await canUserManageStory(currentUserId, story.id);
    } else {
      story.is_favorite = false;
      story.favorite_category = null;
      story.can_manage = false;
    }

    // A story taken down by Admin/Mod (approval_status 'rejected') stays visible to its team and to Admin/Mod
    story.can_moderate = currentUserRoles.includes('admin') || currentUserRoles.includes('mod');
    if (story.approval_status && story.approval_status !== 'approved' && !story.can_manage && !story.can_moderate) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy truyện' });
    }

    publishBehavior({ userId: currentUserId, visitorId: visitorIdOf(req), storyId: story.id });

    res.json({
      success: true,
      data: story,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getChapterBySlug = async (req: Request, res: Response) => {
  try {
    const { slug, chapterSlug } = req.params;

    const storyRes = await pool.query(`
      SELECT 
        s.id, s.code, s.title, s.slug, s.story_type, s.cover_image_url, s.author_name, s.allow_download,
        g.name as group_name, g.slug as group_slug
      FROM stories s
      LEFT JOIN translation_groups g ON s.group_id = g.id
      WHERE s.slug = $1 AND s.approval_status = 'approved';
    `, [slug]);

    if (storyRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy truyện' });
    }

    const story = storyRes.rows[0];

    const chapterRes = await pool.query(`
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

    if (chapterRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy chương' });
    }

    const chapter = chapterRes.rows[0];
    chapter.code = `${story.code}-C${Number(chapter.chapter_number)}`; // LN-JA-G03-0042-C12 (C12.5 for half chapters)

    if (story.story_type === 'manga') {
      const pagesRes = await pool.query(`
        SELECT page_number, image_url, width, height
        FROM chapter_pages
        WHERE chapter_id = $1
        ORDER BY page_number ASC;
      `, [chapter.id]);
      chapter.pages = pagesRes.rows;
    }

    const prevRes = await pool.query(`
      SELECT slug, title, chapter_number
      FROM chapters
      WHERE story_id = $1 AND chapter_number < $2 AND is_published = true
      ORDER BY chapter_number DESC LIMIT 1;
    `, [story.id, chapter.chapter_number]);

    const nextRes = await pool.query(`
      SELECT slug, title, chapter_number
      FROM chapters
      WHERE story_id = $1 AND chapter_number > $2 AND is_published = true
      ORDER BY chapter_number ASC LIMIT 1;
    `, [story.id, chapter.chapter_number]);

    chapter.prev_chapter = prevRes.rows[0] || null;
    chapter.next_chapter = nextRes.rows[0] || null;

    const allChaptersRes = await pool.query(`
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

    // Tự động sinh bản ghi log đọc truyện nếu người dùng đã đăng nhập
    const currentUserId = (req as AuthenticatedRequest).user?.id;
    if (currentUserId) {
      // reading history: the library service's (in the background; reading never waits for it)
      callLibrary('POST', '/internal/history', { user_id: currentUserId, chapter_id: chapter.id })
        .then((r) => { if (r.status !== 200) throw new Error(`HTTP ${r.status}`); })
        .catch((err) => console.error('[library] reading history not saved:', err.message));
    }

    publishBehavior({ userId: currentUserId, visitorId: visitorIdOf(req), storyId: story.id, chapterId: chapter.id });

    recordView(story.id, chapter.id);

    res.json({
      success: true,
      data: chapter,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update Story Metadata, Owner, or Assigned Group (Chủ thầu truyện, Admin, Mod)
 */
export const updateStory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(404).json({ success: false, message: 'Truyện không tồn tại.' });
    }
    const body = req.body || {};
    const currentUserId = req.user.id;
    const input = parseStoryInput(body, false);

    const isAuthorized = await canUserManageStory(currentUserId, id);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không phải chủ thầu của truyện này (người đăng, nhóm dịch hoặc cộng tác viên) nên không có quyền chỉnh sửa.',
      });
    }

    // Only fields that were sent are changed; sending null/'' clears an optional field
    const columns: [keyof StoryInput, string][] = [
      ['title', 'title'], ['original_title', 'original_title'], ['synopsis', 'synopsis'],
      ['cover_image_url', 'cover_image_url'], ['banner_image_url', 'banner_image_url'],
      ['story_type', 'story_type'], ['status', 'status'], ['author_name', 'author_name'],
      ['artist_name', 'artist_name'], ['original_language', 'original_language'], ['group_id', 'group_id'],
      ['allow_download', 'allow_download'],
    ];
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of columns) {
      if (input[key] === undefined) continue;
      params.push(input[key]);
      const cast = column === 'story_type' ? '::story_type' : column === 'status' ? '::story_status' : '';
      sets.push(`${column} = $${params.length}${cast}`);
    }
    sets.push('updated_at = NOW()');
    params.push(id);

    const client = await pool.connect();
    let story: any;
    try {
      await client.query('BEGIN');
      await checkStoryReferences(client, input, currentUserId);
      const curRes = await client.query(`SELECT group_id, source_name, story_type FROM stories WHERE id = $1`, [id]);
      const current = curRes.rows[0];
      // Chapters are stored as text or as page images depending on the type, so it is fixed once content exists
      if (current && input.story_type !== undefined && input.story_type !== current.story_type) {
        const usedRes = await client.query(`
          SELECT EXISTS (SELECT 1 FROM chapters WHERE story_id = $1)
              OR EXISTS (SELECT 1 FROM chapter_submissions WHERE story_id = $1) AS used
        `, [id]);
        if (usedRes.rows[0].used) {
          throw new InputError('Truyện đã có chương nên không thể đổi giữa truyện chữ và truyện tranh.', 409);
        }
      }
      // Imported stories belong to their original site: they are never offered as downloads
      if (input.allow_download === true && current?.source_name) {
        throw new InputError('Truyện được nhập tự động từ trang khác nên không thể bật tải xuống.');
      }
      const updateRes = await client.query(
        `UPDATE stories SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *;`,
        params
      );
      if (updateRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Truyện không tồn tại.' });
      }
      story = updateRes.rows[0];
      if (story.group_id !== current?.group_id) await grantPublisherRole(client, story.uploader_id, story.group_id);
      if (input.tags !== undefined) {
        await client.query(`DELETE FROM story_tags WHERE story_id = $1`, [id]);
        await client.query(
          `INSERT INTO story_tags (story_id, tag_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [id, input.tags]
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    await indexStory(id);

    res.json({
      success: true,
      message: 'Cập nhật thông tin truyện thành công!',
      data: story,
    });
  } catch (error: any) {
    if (sendClientError(res, error)) return;
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete Story for good: the uploader only. Admin/Mod take stories down instead (removeStory), which can be undone.
 */
export const deleteStory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const { id } = req.params;
    const currentUserId = req.user.id;

    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Truyện không tồn tại.' });
    const storyRes = await pool.query(`SELECT id, title, uploader_id FROM stories WHERE id = $1`, [id]);
    if (storyRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Truyện không tồn tại hoặc đã bị xóa.' });
    }

    const story = storyRes.rows[0];
    if (story.uploader_id !== currentUserId) {
      return res.status(403).json({
        success: false,
        message: 'Chỉ người đăng truyện mới xóa được truyện. Ban quản trị chỉ gỡ truyện vi phạm.',
      });
    }

    // Use a transaction for safe cascade deletion
    let purgeComments = async () => {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Views, tags, collaborators (reading history, bookmarks, follows: the library service, after the commit)
      await client.query(`DELETE FROM story_views WHERE story_id = $1`, [id]);
      await client.query(`DELETE FROM story_tags WHERE story_id = $1`, [id]);
      await client.query(`DELETE FROM story_collaborators WHERE story_id = $1`, [id]);

      // 2. Delete chapter pages, chapter submissions, chapters
      await client.query(`
        DELETE FROM chapter_pages WHERE chapter_id IN (SELECT id FROM chapters WHERE story_id = $1)
      `, [id]);
      await client.query(`DELETE FROM chapter_submissions WHERE story_id = $1`, [id]);
      const chapterIds = (await client.query(`DELETE FROM chapters WHERE story_id = $1 RETURNING id`, [id])).rows.map((r: any) => r.id);
      purgeComments = () => callCommunity('POST', '/internal/comments/purge', { story_id: id, chapter_ids: chapterIds })
        .then((r) => { if (r.status !== 200) throw new Error(`HTTP ${r.status}`); })
        .catch((err) => console.error(`[stories] comments of deleted story ${id} not purged in community: ${err.message}`));

      // 3. Delete volumes
      await client.query(`DELETE FROM volumes WHERE story_id = $1`, [id]);

      // 4. The story record (its comments and the posts about it: community, after the commit)
      await client.query(`DELETE FROM stories WHERE id = $1`, [id]);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    await removeStoryFromIndex(id);
    await purgeComments();
    await purgeLibrary({ story_ids: [id] });

    res.json({
      success: true,
      message: `Đã xóa truyện "${story.title}" thành công!`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};


/**
 * Get Collaborators of a story
 */
export const getStoryCollaborators = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT sc.user_id, sc.role, sc.created_at, u.username, u.display_name, u.avatar_url
      FROM story_collaborators sc
      JOIN users u ON sc.user_id = u.id
      WHERE sc.story_id = $1
      ORDER BY sc.created_at ASC;
    `, [id]);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Add Collaborator (by username or email or userId) to a story
 * Only story uploader, mod, or admin can add collaborators.
 */
export const addStoryCollaborator = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }
    const { id } = req.params;
    const { identifier, role = 'collaborator' } = req.body;

    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp username hoặc email thành viên.' });
    }

    const currentUserId = req.user.id;
    const userRoles = req.user.roles || [];

    const isAuthorized = await canUserManageStory(currentUserId, id);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền quản lý cộng tác viên của bộ truyện này.',
      });
    }

    // Find target user: username or id (emails live in identity and are never looked up for other people)
    const targetRes = await pool.query(
      `SELECT id, username, display_name FROM users WHERE (username = $1 OR id::text = $1) AND deleted_at IS NULL LIMIT 1`,
      [identifier.trim()]
    );
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng này.' });
    }
    const targetUser = targetRes.rows[0];

    // Insert or update collaborator
    await pool.query(`
      INSERT INTO story_collaborators (story_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (story_id, user_id) DO UPDATE SET role = EXCLUDED.role;
    `, [id, targetUser.id, role]);

    res.json({
      success: true,
      message: `Đã thêm ${targetUser.display_name || targetUser.username} làm cộng tác viên quản lý truyện thành công!`,
      data: { user_id: targetUser.id, username: targetUser.username, role },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Remove Collaborator from a story
 */
export const removeStoryCollaborator = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }
    const { id, userId } = req.params;
    const currentUserId = req.user.id;
    const userRoles = req.user.roles || [];

    const isAuthorized = await canUserManageStory(currentUserId, id);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền quản lý cộng tác viên của bộ truyện này.',
      });
    }

    await pool.query(`DELETE FROM story_collaborators WHERE story_id = $1 AND user_id = $2`, [id, userId]);

    res.json({
      success: true,
      message: 'Đã xóa quyền cộng tác viên quản lý truyện thành công!',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Admin/Mod: take a story down (soft, `reason` optional) or restore it. A removed story has approval_status
 * 'rejected', so every public list, search and recommendation skips it; it is listed on the "Đã gỡ" page.
 */
const setStoryRemoved = (remove: boolean) => async (req: AuthenticatedRequest, res: Response) => {
  try {
    const roles = req.user?.roles || [];
    if (!roles.includes('admin') && !roles.includes('mod')) {
      return res.status(403).json({ success: false, message: 'Chỉ Admin hoặc Mod mới làm được thao tác này.' });
    }
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Truyện không tồn tại.' });
    const reason = remove ? optionalText(req.body?.reason, 500, 'Lý do') ?? null : null;
    const upd = await pool.query(
      remove
        ? `UPDATE stories SET approval_status = 'rejected', rejection_reason = $2, removed_by = $3, removed_at = NOW()
           WHERE id = $1 AND approval_status = 'approved' RETURNING id, title, uploader_id`
        : `UPDATE stories SET approval_status = 'approved', rejection_reason = NULL, removed_by = NULL, removed_at = NULL
           WHERE id = $1 AND approval_status = 'rejected' RETURNING id, title, uploader_id`,
      remove ? [id, reason, req.user!.id] : [id],
    );
    const story = upd.rows[0];
    if (!story) return res.status(409).json({ success: false, message: remove ? 'Truyện không tồn tại hoặc đã bị gỡ.' : 'Truyện không ở trạng thái bị gỡ.' });

    await indexStory(id);
    if (story.uploader_id !== req.user!.id) {
      enqueueNotificationJob({ kind: 'notify', items: [{
        userId: story.uploader_id, type: remove ? 'story_removed' : 'story_restored',
        title: remove ? 'Truyện của bạn đã bị Ban quản trị gỡ' : 'Truyện của bạn đã được khôi phục',
        message: `"${story.title}"${reason ? ` · Lý do: ${reason}` : ''}`,
        referenceType: 'story', referenceId: story.id, senderId: req.user!.id,
        dedupeKey: `story-${remove ? 'removed' : 'restored'}:${story.id}:${Date.now()}`,
      }] }).catch((err: any) => console.error('[Stories] remove notification failed:', err.message));
    }
    res.json({ success: true, message: remove ? `Đã gỡ truyện "${story.title}".` : `Đã khôi phục truyện "${story.title}".` });
  } catch (error: any) {
    if (sendClientError(res, error)) return;
    res.status(500).json({ success: false, message: error.message });
  }
};

export const removeStory = setStoryRemoved(true);
export const restoreStory = setStoryRemoved(false);
