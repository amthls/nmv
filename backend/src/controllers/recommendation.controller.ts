import { Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { isUuid } from '../utils/validation';
import { homeRecommendations, relatedStories } from '../services/recommender/serve';
import { trainRecommender } from '../services/recommender/train';
import { logRecEvent, visitorIdOf } from '../services/recommender/events';

const viewerOf = (req: AuthenticatedRequest) => ({ userId: req.user?.id || null, visitorId: visitorIdOf(req) });
const limitOf = (v: unknown) => Math.min(30, Math.max(1, parseInt(String(v)) || 18));

/** GET /recommendations/home : "Đề xuất cho bạn" (continue reading + personal picks). */
export const getHomeRecommendations = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await homeRecommendations(viewerOf(req), limitOf(req.query.limit));
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error building home recommendations:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET /recommendations/related/:storyId : "Truyện liên quan" on a story page. */
export const getRelatedStories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isUuid(req.params.storyId)) return res.status(404).json({ success: false, message: 'Truyện không tồn tại.' });
    const data = await relatedStories(req.params.storyId, viewerOf(req), limitOf(req.query.limit));
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error building related stories:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** POST /recommendations/events {kind: impression|click, source, story_ids[]} : feedback on the rows. */
export const postRecEvents = (req: AuthenticatedRequest, res: Response) => {
  const { kind, source, story_ids } = req.body || {};
  if (!['impression', 'click'].includes(kind) || !['home_rec', 'related'].includes(source) || !Array.isArray(story_ids)) {
    return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
  }
  const viewer = viewerOf(req);
  story_ids.filter(isUuid).slice(0, 30).forEach((storyId: string) => logRecEvent({ ...viewer, storyId, kind, source }));
  res.status(202).json({ success: true });
};

/** POST /recommendations/train (admin) : retrain now instead of waiting for the schedule. */
export const trainNow = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await trainRecommender();
    if (result.skipped) return res.status(409).json({ success: false, message: 'Đang có một lượt huấn luyện khác chạy.' });
    res.json({ success: true, data: result, message: `Đã huấn luyện xong trong ${result.duration_ms} ms.` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET /recommendations/status (admin) : last training runs and their offline scores. */
export const getRecStatus = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const r = await pool.query(`SELECT * FROM rec_model_runs ORDER BY id DESC LIMIT 10`);
    res.json({ success: true, data: r.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
