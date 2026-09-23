import { UserReadingLog } from '../models/readingHistory.model';
﻿import { Request, Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { searchStoryIds, indexStory, removeStoryFromIndex } from '../services/search.service';
import { sanitizeRichText } from '../utils/richText';

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
 * Check if a user is authorized to manage (edit, add chapters, delete) a story.
 * Authorized if: Admin, Mod, Story Uploader, Member of the assigned translation group, or assigned collaborator.
 */
export async function canUserManageStory(userId: string, storyId: string, userRoles: string[] = []): Promise<boolean> {
  if (userRoles.includes('admin') || userRoles.includes('mod')) {
    return true;
  }
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

/**
 * List stories the current logged-in user is allowed to manage (upload chapters,
 * edit info, add collaborators): stories they uploaded, stories owned by a
 * translation group they belong to, stories they were added as a collaborator on,
 * or every story if they are admin/mod.
 */
export const getManageableStories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    const isAdminOrMod = userRoles.includes('admin') || userRoles.includes('mod');

    const result = await pool.query(`
      SELECT DISTINCT
        s.id, s.title, s.slug, s.story_type, s.status, s.total_chapters,
        s.uploader_id, s.group_id, g.name as group_name
      FROM stories s
      LEFT JOIN translation_groups g ON s.group_id = g.id
      LEFT JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = $1
      LEFT JOIN story_collaborators sc ON sc.story_id = s.id AND sc.user_id = $1
      WHERE s.approval_status = 'approved'
        AND ($2 OR s.uploader_id = $1 OR gm.user_id IS NOT NULL OR sc.user_id IS NOT NULL)
      ORDER BY s.title ASC;
    `, [userId, isAdminOrMod]);

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
        s.rating_avg, s.rating_count, s.last_chapter_at, s.created_at,
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
      ORDER BY s.total_views DESC, s.rating_avg DESC
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
        s.rating_avg, s.rating_count, s.last_chapter_at, s.created_at,
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
        orderBy = 's.total_views DESC, s.rating_avg DESC';
        break;
      case 'rating':
        orderBy = 's.rating_avg DESC, s.rating_count DESC';
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
        s.rating_avg, s.rating_count, s.last_chapter_at, s.created_at,
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
    const currentUserRoles = (req as any).user?.roles || [];
    if (currentUserId) {
      const favCheck = await pool.query(
        'SELECT id, category FROM user_favorites WHERE user_id = $1::uuid AND story_id = $2::uuid',
        [currentUserId, story.id]
      );
      story.is_favorite = favCheck.rows.length > 0;
      story.favorite_category = favCheck.rows[0]?.category || null;
      story.can_manage = await canUserManageStory(currentUserId, story.id, currentUserRoles);
    } else {
      story.is_favorite = false;
      story.favorite_category = null;
      story.can_manage = false;
    }

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
        s.id, s.title, s.slug, s.story_type, s.cover_image_url, s.author_name,
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
      UserReadingLog.recordLog({
        userId: currentUserId,
        storyId: story.id,
        chapterId: chapter.id,
      }).catch((err) => console.error('[UserReadingLog] Tự động ghi log thất bại:', err));
    }

    pool.query(`
      UPDATE chapters SET total_views = total_views + 1 WHERE id = $1;
      UPDATE stories SET total_views = total_views + 1 WHERE id = $2;
      INSERT INTO story_views (story_id, chapter_id) VALUES ($2, $1);
    `, [chapter.id, story.id]).catch(() => {});

    res.json({
      success: true,
      data: chapter,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const rateStory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để đánh giá truyện.' });
    }

    const { slug } = req.params;
    const { rating, review } = req.body;

    if (!rating || rating < 1 || rating > 10) {
      return res.status(400).json({ success: false, message: 'Đánh giá phải từ 1 đến 10 sao.' });
    }

    const storyRes = await pool.query(`SELECT id FROM stories WHERE slug = $1`, [slug]);
    if (storyRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy truyện' });
    }

    const storyId = storyRes.rows[0].id;
    const userId = req.user.id;

    await pool.query(`
      INSERT INTO story_ratings (story_id, user_id, rating, review)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (story_id, user_id) DO UPDATE SET
        rating = EXCLUDED.rating,
        review = EXCLUDED.review,
        updated_at = NOW();
    `, [storyId, userId, rating, review || null]);

    const updatedStoryRes = await pool.query(`SELECT rating_avg, rating_count FROM stories WHERE id = $1`, [storyId]);

    res.json({
      success: true,
      message: 'Đã gửi đánh giá thành công!',
      data: updatedStoryRes.rows[0],
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
    const {
      title,
      original_title,
      synopsis,
      cover_image_url,
      banner_image_url,
      story_type,
      status,
      author_name,
      artist_name,
      original_language,
      group_id,
      uploader_id, // Reassign owner (single author/user)
      tags,
    } = req.body;

    const currentUserId = req.user.id;
    const userRoles = req.user.roles || [];

    const isAuthorized = await canUserManageStory(currentUserId, id, userRoles);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không phải chủ thầu của truyện này (người đăng, nhóm dịch hoặc Admin/Mod) nên không có quyền chỉnh sửa.',
      });
    }

    const updateRes = await pool.query(`
      UPDATE stories SET
        title = COALESCE($1, title),
        original_title = COALESCE($2, original_title),
        synopsis = COALESCE($3, synopsis),
        cover_image_url = COALESCE($4, cover_image_url),
        banner_image_url = COALESCE($5, banner_image_url),
        story_type = COALESCE($6::story_type, story_type),
        status = COALESCE($7::story_status, status),
        author_name = COALESCE($8, author_name),
        artist_name = COALESCE($9, artist_name),
        original_language = COALESCE($10, original_language),
        group_id = COALESCE($11, group_id),
        uploader_id = COALESCE($12, uploader_id),
        updated_at = NOW()
      WHERE id = $13
      RETURNING *;
    `, [
      title?.trim() || null,
      original_title?.trim() || null,
      sanitizeRichText(synopsis) || null,
      cover_image_url || null,
      banner_image_url || null,
      story_type || null,
      status || null,
      author_name?.trim() || null,
      artist_name?.trim() || null,
      original_language || null,
      group_id !== undefined ? (group_id || null) : null,
      (userRoles.includes('admin') || userRoles.includes('mod')) && uploader_id ? uploader_id : null,
      id
    ]);

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Truyện không tồn tại.' });
    }

    // Update tags if provided
    if (Array.isArray(tags)) {
      await pool.query(`DELETE FROM story_tags WHERE story_id = $1`, [id]);
      for (const tagId of tags) {
        await pool.query(`INSERT INTO story_tags (story_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, tagId]);
      }
    }

    await indexStory(id);

    res.json({
      success: true,
      message: 'Cập nhật thông tin truyện thành công!',
      data: updateRes.rows[0],
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete Story (Admin, Mod, or Story Owner)
 */
export const deleteStory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const { id } = req.params;
    const currentUserId = req.user.id;
    const userRoles = req.user.roles || [];

    const storyRes = await pool.query(`SELECT id, title, uploader_id FROM stories WHERE id = $1`, [id]);
    if (storyRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Truyện không tồn tại hoặc đã bị xóa.' });
    }

    const story = storyRes.rows[0];
    const isAdminOrMod = userRoles.includes('admin') || userRoles.includes('mod');
    const isOwner = story.uploader_id === currentUserId;

    if (!isAdminOrMod && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xóa truyện này. Chỉ chủ thầu (người đăng) hoặc Ban quản trị (Admin/Mod) mới có quyền xóa.',
      });
    }

    // Use a transaction for safe cascade deletion
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Delete reading history, bookmarks, favorites, ratings
      await client.query(`DELETE FROM reading_history WHERE story_id = $1`, [id]);
      await client.query(`DELETE FROM bookmarks WHERE story_id = $1`, [id]);
      await client.query(`DELETE FROM user_favorites WHERE story_id = $1`, [id]);
      await client.query(`DELETE FROM story_ratings WHERE story_id = $1`, [id]);
      await client.query(`DELETE FROM story_views WHERE story_id = $1`, [id]);
      await client.query(`DELETE FROM story_tags WHERE story_id = $1`, [id]);
      await client.query(`DELETE FROM story_collaborators WHERE story_id = $1`, [id]);

      // 2. Delete chapter pages, chapter submissions, chapters
      await client.query(`
        DELETE FROM chapter_pages WHERE chapter_id IN (SELECT id FROM chapters WHERE story_id = $1)
      `, [id]);
      await client.query(`DELETE FROM chapter_submissions WHERE story_id = $1`, [id]);
      await client.query(`DELETE FROM comments WHERE target_type = 'chapter' AND target_id IN (SELECT id FROM chapters WHERE story_id = $1)`, [id]);
      await client.query(`DELETE FROM chapters WHERE story_id = $1`, [id]);

      // 3. Delete volumes
      await client.query(`DELETE FROM volumes WHERE story_id = $1`, [id]);

      // 4. Unlink posts related to this story
      await client.query(`UPDATE posts SET story_id = NULL WHERE story_id = $1`, [id]);

      // 5. Delete comments left directly on the story, then the story record
      await client.query(`DELETE FROM comments WHERE target_type = 'story' AND target_id = $1`, [id]);
      await client.query(`DELETE FROM stories WHERE id = $1`, [id]);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    await removeStoryFromIndex(id);

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

    const isAuthorized = await canUserManageStory(currentUserId, id, userRoles);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền quản lý cộng tác viên của bộ truyện này.',
      });
    }

    // Find target user
    const targetRes = await pool.query(
      `SELECT id, username, display_name FROM users WHERE username = $1 OR email = $1 OR id::text = $1 LIMIT 1`,
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

    const isAuthorized = await canUserManageStory(currentUserId, id, userRoles);
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
