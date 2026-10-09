import { Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { InputError, requiredText } from '../utils/validation';
import { emitToUsers } from '../services/realtime';

const MAX_DIRECT_MESSAGE = 2000;

function sendError(res: Response, error: any) {
  if (error instanceof InputError) return res.status(error.status).json({ success: false, message: error.message });
  return res.status(500).json({ success: false, message: error.message });
}

/** The other person in a conversation, by username. Deleted accounts can't be messaged. */
async function findPartner(username: unknown) {
  if (typeof username !== 'string' || !username) return null;
  const result = await pool.query(
    `SELECT id, username, display_name, avatar_url FROM users WHERE username = $1 AND deleted_at IS NULL`,
    [username]
  );
  return result.rows[0] || null;
}

/** Inbox: one row per person I've talked with (latest message first) and the total unread count. */
export const getConversations = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const result = await pool.query(`
      WITH mine AS (
        SELECT *, CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS partner_id
        FROM direct_messages
        WHERE sender_id = $1 OR recipient_id = $1
      ), latest AS (
        SELECT DISTINCT ON (partner_id) partner_id, message, sender_id, created_at
        FROM mine
        ORDER BY partner_id, created_at DESC
      )
      SELECT
        l.partner_id, l.message AS last_message, l.sender_id AS last_sender_id, l.created_at AS last_at,
        u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*)::int FROM mine WHERE partner_id = l.partner_id AND recipient_id = $1 AND read_at IS NULL) AS unread
      FROM latest l
      JOIN users u ON u.id = l.partner_id
      ORDER BY l.created_at DESC
      LIMIT 100;
    `, [me]);

    const unreadCount = result.rows.reduce((sum: number, r: any) => sum + r.unread, 0);
    res.json({ success: true, data: { conversations: result.rows, unread_count: unreadCount } });
  } catch (error: any) {
    sendError(res, error);
  }
};

/** The latest 100 messages with one person (oldest first). Opening the thread marks them read. */
export const getThread = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const partner = await findPartner(req.params.username);
    if (!partner) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại' });

    await pool.query(
      `UPDATE direct_messages SET read_at = NOW() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL`,
      [partner.id, me]
    );
    const result = await pool.query(`
      SELECT * FROM (
        SELECT id, sender_id, recipient_id, message, read_at, created_at
        FROM direct_messages
        WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
        ORDER BY created_at DESC
        LIMIT 100
      ) latest
      ORDER BY created_at ASC;
    `, [me, partner.id]);

    res.json({ success: true, data: { partner, messages: result.rows } });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const sendDirectMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const message = requiredText(req.body?.message, MAX_DIRECT_MESSAGE, 'Nội dung tin nhắn');
    const partner = await findPartner(req.params.username);
    if (!partner) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại' });
    if (partner.id === me) return res.status(400).json({ success: false, message: 'Bạn không thể tự nhắn tin cho mình.' });

    const insertRes = await pool.query(`
      INSERT INTO direct_messages (sender_id, recipient_id, message)
      VALUES ($1, $2, $3)
      RETURNING id, sender_id, recipient_id, message, read_at, created_at;
    `, [me, partner.id, message]);

    emitToUsers([me, partner.id], 'dm', { from: req.user!.username });
    res.status(201).json({ success: true, data: insertRes.rows[0] });
  } catch (error: any) {
    sendError(res, error);
  }
};
