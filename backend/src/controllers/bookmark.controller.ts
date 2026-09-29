import { Request, Response } from 'express';
import { pool } from '../config/db';
import { clientDbError } from '../utils/dbErrors';

export const getBookmarks = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user?.id;
    if (!currentUserId) {
      return res.status(401).json({ success: false, message: 'Chưa đăng nhập.' });
    }

    const { chapter_id, story_id } = req.query;

    let query = `
      SELECT 
        b.id,
        b.user_id,
        b.story_id,
        b.chapter_id,
        b.line_text,
        b.line_index,
        b.scroll_position,
        b.page_number,
        b.note,
        b.color,
        b.created_at,
        s.title AS story_title,
        s.slug AS story_slug,
        s.cover_image_url,
        c.title AS chapter_title,
        c.slug AS chapter_slug,
        c.chapter_number
      FROM bookmarks b
      JOIN stories s ON b.story_id = s.id
      JOIN chapters c ON b.chapter_id = c.id
      WHERE b.user_id = $1::uuid
    `;
    const params: any[] = [currentUserId];

    if (chapter_id) {
      params.push(chapter_id);
      query += ` AND b.chapter_id = $${params.length}::uuid`;
    }

    if (story_id) {
      params.push(story_id);
      query += ` AND b.story_id = $${params.length}::uuid`;
    }

    query += ` ORDER BY b.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching bookmarks:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createBookmark = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user?.id;
    if (!currentUserId) {
      return res.status(401).json({ success: false, message: 'Chưa đăng nhập.' });
    }

    const { story_id, chapter_id, line_text, line_index, scroll_position, page_number, note, color } = req.body;

    if (!story_id || !chapter_id) {
      return res.status(400).json({ success: false, message: 'story_id và chapter_id là bắt buộc.' });
    }

    // Toggle behavior: check if line already bookmarked by user
    if (line_index !== undefined && line_index !== null) {
      const existing = await pool.query(
        'SELECT id FROM bookmarks WHERE user_id = $1::uuid AND chapter_id = $2::uuid AND line_index = $3',
        [currentUserId, chapter_id, line_index]
      );

      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM bookmarks WHERE id = $1::uuid', [existing.rows[0].id]);
        return res.json({
          success: true,
          action: 'removed',
          message: 'Đã bỏ bookmark dòng này.',
        });
      }
    }

    const insertResult = await pool.query(
      `INSERT INTO bookmarks (
        user_id, story_id, chapter_id, line_text, line_index, scroll_position, page_number, note, color
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        currentUserId,
        story_id,
        chapter_id,
        line_text || null,
        line_index !== undefined ? line_index : null,
        scroll_position || 0,
        page_number || 1,
        note || null,
        color || 'default',
      ]
    );

    return res.status(201).json({
      success: true,
      action: 'added',
      data: insertResult.rows[0],
      message: 'Đã tạo bookmark thành công.',
    });
  } catch (error: any) {
    const clientErr = clientDbError(error);
    if (clientErr) return res.status(clientErr.status).json({ success: false, message: clientErr.message });
    console.error('Error creating bookmark:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteBookmark = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user?.id;
    if (!currentUserId) {
      return res.status(401).json({ success: false, message: 'Chưa đăng nhập.' });
    }

    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM bookmarks WHERE id = $1::uuid AND user_id = $2::uuid RETURNING id',
      [id, currentUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bookmark không tồn tại hoặc không thuộc về bạn.' });
    }

    return res.json({
      success: true,
      message: 'Đã xóa bookmark thành công.',
    });
  } catch (error: any) {
    console.error('Error deleting bookmark:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getFavorites = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user?.id;
    if (!currentUserId) {
      return res.status(401).json({ success: false, message: 'Chưa đăng nhập.' });
    }

    const { category } = req.query;

    let query = `
      SELECT 
        uf.id,
        uf.story_id,
        uf.category,
        uf.notify_updates,
        uf.created_at,
        s.title,
        s.slug,
        s.cover_image_url,
        s.author_name,
        s.status,
        s.story_type,
        s.total_chapters,
        s.total_views,
        s.total_favorites,
        s.rating_avg,
        lc.title AS latest_chapter_title,
        lc.slug AS latest_chapter_slug,
        lc.chapter_number AS latest_chapter_number
      FROM user_favorites uf
      JOIN stories s ON uf.story_id = s.id
      LEFT JOIN LATERAL (
        SELECT title, slug, chapter_number 
        FROM chapters 
        WHERE story_id = s.id 
        ORDER BY chapter_number DESC 
        LIMIT 1
      ) lc ON true
      WHERE uf.user_id = $1::uuid
    `;
    const params: any[] = [currentUserId];

    if (category && category !== 'all') {
      params.push(category);
      query += ` AND uf.category = $${params.length}`;
    }

    query += ` ORDER BY uf.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching favorites:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleFavorite = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user?.id;
    if (!currentUserId) {
      return res.status(401).json({ success: false, message: 'Chưa đăng nhập.' });
    }

    const { story_id, category = 'reading', notify_updates = true } = req.body;

    if (!story_id) {
      return res.status(400).json({ success: false, message: 'story_id là bắt buộc.' });
    }

    const check = await pool.query(
      'SELECT id, category FROM user_favorites WHERE user_id = $1::uuid AND story_id = $2::uuid',
      [currentUserId, story_id]
    );

    if (check.rows.length > 0) {
      if (category && check.rows[0].category !== category) {
        await pool.query(
          'UPDATE user_favorites SET category = $1 WHERE id = $2::uuid',
          [category, check.rows[0].id]
        );
        return res.json({
          success: true,
          action: 'updated',
          message: 'Đã cập nhật trạng thái theo dõi truyện.',
        });
      } else {
        await pool.query('DELETE FROM user_favorites WHERE id = $1::uuid', [check.rows[0].id]);
        await pool.query(
          'UPDATE stories SET total_favorites = GREATEST(0, total_favorites - 1) WHERE id = $1::uuid',
          [story_id]
        );
        return res.json({
          success: true,
          action: 'removed',
          message: 'Đã hủy theo dõi truyện.',
        });
      }
    } else {
      await pool.query(
        `INSERT INTO user_favorites (user_id, story_id, category, notify_updates)
         VALUES ($1::uuid, $2::uuid, $3, $4)`,
        [currentUserId, story_id, category, notify_updates]
      );
      await pool.query(
        'UPDATE stories SET total_favorites = total_favorites + 1 WHERE id = $1::uuid',
        [story_id]
      );
      return res.json({
        success: true,
        action: 'added',
        message: 'Đã theo dõi truyện thành công.',
      });
    }
  } catch (error: any) {
    const clientErr = clientDbError(error);
    if (clientErr) return res.status(clientErr.status).json({ success: false, message: clientErr.message });
    console.error('Error toggling favorite:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const checkFavoriteStatus = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user?.id;
    const { storyId } = req.params;

    if (!currentUserId) {
      return res.json({ success: true, is_favorite: false, category: null });
    }

    const result = await pool.query(
      'SELECT category FROM user_favorites WHERE user_id = $1::uuid AND story_id = $2::uuid',
      [currentUserId, storyId]
    );

    return res.json({
      success: true,
      is_favorite: result.rows.length > 0,
      category: result.rows[0]?.category || null,
    });
  } catch (error: any) {
    console.error('Error checking favorite status:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
