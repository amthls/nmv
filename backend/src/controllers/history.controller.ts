import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { UserReadingLog } from '../models/readingHistory.model';
import { clientDbError } from '../utils/dbErrors';
import { pool } from '../config/db';
import { isUuid } from '../utils/validation';

/** A finite number within [min, max], else the fallback (bad client values must not reach SQL). */
const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

/**
 * Lấy danh sách lịch sử đọc truyện của người dùng hiện tại
 * Mỗi người dùng nắm giữ một danh sách log riêng cho chính họ
 */
export const getReadingHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để xem lịch sử đọc.' });
    }

    const currentUserId = req.user.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 200);

    const logs = await UserReadingLog.getLogsByUser(currentUserId, limit);

    res.json({
      success: true,
      data: logs,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Ghi nhận bản log lịch sử đọc khi người dùng mở / đọc một chương truyện
 * Tự động tạo bản log riêng biệt ghi ngày tháng, chương truyện và truyện
 */
export const saveReadingHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để lưu lịch sử đọc.' });
    }

    const { chapter_id, scroll_position, page_number, time_spent_seconds } = req.body || {};

    if (!isUuid(chapter_id)) {
      return res.status(400).json({ success: false, message: 'Thiếu hoặc sai chapter_id' });
    }

    // The story always comes from the chapter itself, so a wrong story_id can't create a
    // history entry whose "continue reading" link points into another story
    const chRes = await pool.query(
      `SELECT story_id FROM chapters WHERE id = $1 AND is_published = true`,
      [chapter_id]
    );
    if (chRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chương không tồn tại.' });
    }

    const log = await UserReadingLog.recordLog({
      userId: req.user.id,
      storyId: chRes.rows[0].story_id,
      chapterId: chapter_id,
      scrollPosition: clampNumber(scroll_position, 0, 100, 0), // percent, numeric(5,2)
      pageNumber: Math.round(clampNumber(page_number, 1, 100000, 1)),
      timeSpentSeconds: Math.round(clampNumber(time_spent_seconds, 0, 86400, 0)),
    });

    res.json({
      success: true,
      message: 'Đã ghi nhận lịch sử đọc thành công',
      data: log,
    });
  } catch (error: any) {
    const clientErr = clientDbError(error);
    if (clientErr) return res.status(clientErr.status).json({ success: false, message: clientErr.message });
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Xóa 1 bản ghi log lịch sử đọc
 */
export const deleteReadingHistoryItem = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }

    const { id } = req.params;
    const currentUserId = req.user.id;

    const deleted = isUuid(id) && await UserReadingLog.deleteLog(id, currentUserId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Bản ghi không tồn tại hoặc bạn không có quyền xóa.',
      });
    }

    res.json({
      success: true,
      message: 'Đã xóa khỏi lịch sử đọc',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Xóa toàn bộ log lịch sử đọc của người dùng
 */
export const clearReadingHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }

    const currentUserId = req.user.id;

    await UserReadingLog.clearAllLogs(currentUserId);

    res.json({
      success: true,
      message: 'Đã xóa toàn bộ lịch sử đọc của bạn',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
