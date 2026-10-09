import { Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { isUuid } from '../utils/validation';

/**
 * Lấy danh sách thông báo của người dùng hiện tại
 */
export const getNotifications = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }

    const currentUserId = req.user.id;

    // Lấy thông báo kèm theo thông tin chi tiết của chương và truyện (nếu là thông báo chương mới)
    const result = await pool.query(`
      SELECT 
        n.id,
        n.user_id,
        n.type,
        n.title,
        n.message,
        n.reference_type,
        n.reference_id,
        n.is_read,
        n.read_at,
        n.created_at,
        c.title as chapter_title,
        c.slug as chapter_slug,
        c.chapter_number,
        s.id as story_id,
        s.title as story_title,
        s.slug as story_slug,
        s.cover_image_url as story_cover,
        p.slug as post_slug,
        p.title as post_title,
        tg.slug as group_slug
      FROM notifications n
      LEFT JOIN chapters c ON n.reference_id = c.id AND n.reference_type = 'chapter'
      LEFT JOIN stories s ON s.id = COALESCE(c.story_id, CASE WHEN n.reference_type = 'story' THEN n.reference_id END)
      LEFT JOIN posts p ON n.reference_id = p.id AND n.reference_type = 'post'
      LEFT JOIN translation_groups tg ON n.reference_id = tg.id AND n.reference_type = 'group'
      WHERE n.user_id = $1::uuid
      ORDER BY n.created_at DESC
      LIMIT 50;
    `, [currentUserId]);

    const unreadCountRes = await pool.query(`
      SELECT COUNT(*)::int as count FROM notifications
      WHERE user_id = $1::uuid AND is_read = false;
    `, [currentUserId]);

    res.json({
      success: true,
      data: {
        notifications: result.rows,
        unread_count: unreadCountRes.rows[0]?.count || 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Đánh dấu 1 thông báo là đã đọc
 */
export const markNotificationAsRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }

    const { id } = req.params;
    const currentUserId = req.user.id;
    if (!isUuid(id)) {
      return res.status(404).json({ success: false, message: 'Thông báo không tồn tại.' });
    }

    await pool.query(`
      UPDATE notifications SET is_read = true, read_at = NOW()
      WHERE id = $1::uuid AND user_id = $2::uuid;
    `, [id, currentUserId]);

    res.json({ success: true, message: 'Đã đánh dấu thông báo là đã đọc.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Đánh dấu tất cả thông báo của người dùng là đã đọc
 */
export const markAllNotificationsAsRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }

    const currentUserId = req.user.id;

    await pool.query(`
      UPDATE notifications SET is_read = true, read_at = NOW()
      WHERE user_id = $1::uuid AND is_read = false;
    `, [currentUserId]);

    res.json({ success: true, message: 'Đã đánh dấu tất cả thông báo là đã đọc.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Xóa 1 thông báo
 */
export const deleteNotification = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }

    const { id } = req.params;
    const currentUserId = req.user.id;
    if (!isUuid(id)) {
      return res.status(404).json({ success: false, message: 'Thông báo không tồn tại.' });
    }

    await pool.query(`
      DELETE FROM notifications WHERE id = $1::uuid AND user_id = $2::uuid;
    `, [id, currentUserId]);

    res.json({ success: true, message: 'Đã xóa thông báo.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
