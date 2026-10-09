import { Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { InputError, isUuid, requiredText } from '../utils/validation';
import { emitToUsers } from '../services/realtime';

const MAX_DIRECT_MESSAGE = 2000;
const MAX_LABELS = 20;
const MAX_LABEL_NAME = 30;
const MAX_PINS = 10;
// Label colors the UI knows how to draw (no indigo/purple/violet: the theme maps those to the brand blue).
// Must match LABEL_STYLES in frontend/src/components/messages/labels.ts
export const LABEL_COLORS = ['sky', 'emerald', 'amber', 'rose', 'fuchsia', 'teal', 'orange', 'lime'];
const BLOCKED_MESSAGE = 'Không thể gửi tin nhắn cho người này.';

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

/** Whether I blocked them and whether they blocked me. */
async function blockStatus(me: string, partnerId: string) {
  const r = await pool.query(
    `SELECT
       EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2) AS blocked_by_me,
       EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $2 AND blocked_id = $1) AS blocked_me`,
    [me, partnerId]
  );
  return r.rows[0] as { blocked_by_me: boolean; blocked_me: boolean };
}

/** ILIKE pattern that matches `text` literally anywhere. */
const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Inbox: one row per person I've talked with (latest message first) and the total unread count.
 * `?label=<id>` keeps conversations carrying that label of mine; `?q=` matches the person's name or
 * any message text (the newest matching message is returned as `match_message`).
 */
export const getConversations = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const label = typeof req.query.label === 'string' && req.query.label ? req.query.label : null;
    if (label && !isUuid(label)) throw new InputError('Nhãn không hợp lệ.');
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const pattern = q ? containsPattern(q) : null;

    const result = await pool.query(`
      WITH mine AS (
        SELECT *, CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS partner_id
        FROM direct_messages
        WHERE sender_id = $1 OR recipient_id = $1
      ), latest AS (
        SELECT DISTINCT ON (partner_id) partner_id, message, sender_id, created_at
        FROM mine
        ORDER BY partner_id, created_at DESC
      ), matches AS (
        -- One pass over the messages, not one per conversation
        SELECT DISTINCT ON (partner_id) partner_id, message
        FROM mine
        WHERE $3::text IS NOT NULL AND message ILIKE $3
        ORDER BY partner_id, created_at DESC
      )
      SELECT
        l.partner_id, l.message AS last_message, l.sender_id AS last_sender_id, l.created_at AS last_at,
        u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*)::int FROM mine WHERE partner_id = l.partner_id AND recipient_id = $1 AND read_at IS NULL) AS unread,
        COALESCE((
          SELECT array_agg(lc.label_id) FROM dm_label_conversations lc
          JOIN dm_labels dl ON dl.id = lc.label_id
          WHERE dl.user_id = $1 AND lc.partner_id = l.partner_id
        ), '{}') AS label_ids,
        EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = l.partner_id) AS blocked,
        mt.message AS match_message
      FROM latest l
      JOIN users u ON u.id = l.partner_id
      LEFT JOIN matches mt ON mt.partner_id = l.partner_id
      WHERE ($2::uuid IS NULL OR EXISTS (
              SELECT 1 FROM dm_label_conversations lc JOIN dm_labels dl ON dl.id = lc.label_id
              WHERE dl.user_id = $1 AND lc.label_id = $2 AND lc.partner_id = l.partner_id))
        AND ($3::text IS NULL OR mt.message IS NOT NULL OR u.username ILIKE $3 OR u.display_name ILIKE $3)
      ORDER BY l.created_at DESC
      LIMIT 100;
    `, [me, label, pattern]);

    // The badge counts every unread message, whatever filter the inbox shows
    const unreadRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM direct_messages WHERE recipient_id = $1 AND read_at IS NULL`,
      [me]
    );
    res.json({ success: true, data: { conversations: result.rows, unread_count: unreadRes.rows[0].n } });
  } catch (error: any) {
    sendError(res, error);
  }
};

/**
 * The latest 100 messages with one person (oldest first), every pinned message of the conversation
 * (even older ones) and the block state. Opening the thread marks it read.
 */
export const getThread = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const partner = await findPartner(req.params.username);
    if (!partner) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại' });

    await pool.query(
      `UPDATE direct_messages SET read_at = NOW() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL`,
      [partner.id, me]
    );
    const between = `((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))`;
    const [result, pinnedRes, labelRes, block] = await Promise.all([
      pool.query(`
        SELECT * FROM (
          SELECT id, sender_id, recipient_id, message, read_at, created_at, pinned_at
          FROM direct_messages
          WHERE ${between}
          ORDER BY created_at DESC
          LIMIT 100
        ) latest
        ORDER BY created_at ASC;
      `, [me, partner.id]),
      pool.query(
        `SELECT id, sender_id, message, created_at, pinned_at, pinned_by
         FROM direct_messages WHERE ${between} AND pinned_at IS NOT NULL
         ORDER BY pinned_at DESC`,
        [me, partner.id]
      ),
      pool.query(
        `SELECT lc.label_id FROM dm_label_conversations lc JOIN dm_labels dl ON dl.id = lc.label_id
         WHERE dl.user_id = $1 AND lc.partner_id = $2`,
        [me, partner.id]
      ),
      blockStatus(me, partner.id),
    ]);

    res.json({
      success: true,
      data: {
        partner,
        messages: result.rows,
        pinned: pinnedRes.rows,
        label_ids: labelRes.rows.map((r: any) => r.label_id),
        blocked_by_me: block.blocked_by_me,
        can_message: !block.blocked_by_me && !block.blocked_me,
      },
    });
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

    // Blocking works both ways; the same wording either way so nobody learns they were blocked
    const block = await blockStatus(me, partner.id);
    if (block.blocked_by_me || block.blocked_me) {
      return res.status(403).json({ success: false, message: BLOCKED_MESSAGE });
    }

    const insertRes = await pool.query(`
      INSERT INTO direct_messages (sender_id, recipient_id, message)
      VALUES ($1, $2, $3)
      RETURNING id, sender_id, recipient_id, message, read_at, created_at, pinned_at;
    `, [me, partner.id, message]);

    emitToUsers([me, partner.id], 'dm', { from: req.user!.username });
    res.status(201).json({ success: true, data: insertRes.rows[0] });
  } catch (error: any) {
    sendError(res, error);
  }
};

// ---------------------------------------------------------------- labels

function labelInput(body: any, partial: boolean) {
  const out: { name?: string; color?: string } = {};
  if (!partial || body?.name !== undefined) out.name = requiredText(body?.name, MAX_LABEL_NAME, 'Tên nhãn');
  if (!partial || body?.color !== undefined) {
    const color = body?.color ?? 'sky';
    if (!LABEL_COLORS.includes(color)) throw new InputError('Màu nhãn không hợp lệ.');
    out.color = color;
  }
  return out;
}

/** My labels with how many conversations carry each. */
export const getLabels = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT dl.id, dl.name, dl.color, COUNT(lc.partner_id)::int AS conversation_count
      FROM dm_labels dl
      LEFT JOIN dm_label_conversations lc ON lc.label_id = dl.id
      WHERE dl.user_id = $1
      GROUP BY dl.id
      ORDER BY dl.created_at ASC;
    `, [req.user!.id]);
    res.json({ success: true, data: { labels: result.rows } });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const createLabel = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const { name, color } = labelInput(req.body, false);
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM dm_labels WHERE user_id = $1`, [me]);
    if (count.rows[0].n >= MAX_LABELS) throw new InputError(`Tối đa ${MAX_LABELS} nhãn.`);
    const result = await pool.query(
      `INSERT INTO dm_labels (user_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color`,
      [me, name, color]
    );
    res.status(201).json({ success: true, data: { ...result.rows[0], conversation_count: 0 } });
  } catch (error: any) {
    if (error.code === '23505') return res.status(400).json({ success: false, message: 'Bạn đã có nhãn tên này.' });
    sendError(res, error);
  }
};

export const updateLabel = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isUuid(req.params.id)) throw new InputError('Nhãn không hợp lệ.');
    const { name, color } = labelInput(req.body, true);
    const result = await pool.query(
      `UPDATE dm_labels SET name = COALESCE($3, name), color = COALESCE($4, color)
       WHERE id = $1 AND user_id = $2 RETURNING id, name, color`,
      [req.params.id, req.user!.id, name ?? null, color ?? null]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Không tìm thấy nhãn.' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') return res.status(400).json({ success: false, message: 'Bạn đã có nhãn tên này.' });
    sendError(res, error);
  }
};

export const deleteLabel = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isUuid(req.params.id)) throw new InputError('Nhãn không hợp lệ.');
    const result = await pool.query(`DELETE FROM dm_labels WHERE id = $1 AND user_id = $2`, [req.params.id, req.user!.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Không tìm thấy nhãn.' });
    res.json({ success: true, message: 'Đã xóa nhãn.' });
  } catch (error: any) {
    sendError(res, error);
  }
};

/** Replace the labels I put on my conversation with this person (`label_ids`: my label ids). */
export const setConversationLabels = async (req: AuthenticatedRequest, res: Response) => {
  const me = req.user!.id;
  const client = await pool.connect();
  try {
    const ids = req.body?.label_ids;
    if (!Array.isArray(ids) || ids.length > MAX_LABELS || !ids.every(isUuid)) throw new InputError('Danh sách nhãn không hợp lệ.');
    const partner = await findPartner(req.params.username);
    if (!partner) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại' });

    const owned = await client.query(`SELECT id FROM dm_labels WHERE user_id = $1 AND id = ANY($2::uuid[])`, [me, ids]);
    if (owned.rows.length !== new Set(ids).size) throw new InputError('Có nhãn không thuộc về bạn.');

    await client.query('BEGIN');
    await client.query(
      `DELETE FROM dm_label_conversations lc USING dm_labels dl
       WHERE dl.id = lc.label_id AND dl.user_id = $1 AND lc.partner_id = $2`,
      [me, partner.id]
    );
    if (ids.length) {
      await client.query(
        `INSERT INTO dm_label_conversations (label_id, partner_id)
         SELECT unnest($1::uuid[]), $2 ON CONFLICT DO NOTHING`,
        [ids, partner.id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, data: { label_ids: [...new Set(ids)] } });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, error);
  } finally {
    client.release();
  }
};

// ---------------------------------------------------------------- blocking

export const blockUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const partner = await findPartner(req.params.username);
    if (!partner) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại' });
    if (partner.id === me) throw new InputError('Bạn không thể tự chặn mình.');
    await pool.query(
      `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [me, partner.id]
    );
    // Only my own tabs refresh: telling the other person would reveal the block
    emitToUsers([me], 'dm', {});
    res.json({ success: true, message: `Đã chặn ${partner.display_name || partner.username}.` });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const unblockUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const partner = await findPartner(req.params.username);
    if (!partner) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại' });
    await pool.query(`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [me, partner.id]);
    emitToUsers([me], 'dm', {});
    res.json({ success: true, message: `Đã bỏ chặn ${partner.display_name || partner.username}.` });
  } catch (error: any) {
    sendError(res, error);
  }
};

// ---------------------------------------------------------------- pins

/** Pin (POST) or unpin (DELETE) a message of my conversation with this person. Both people see pins. */
async function setPinned(req: AuthenticatedRequest, res: Response, pin: boolean) {
  try {
    const me = req.user!.id;
    if (!isUuid(req.params.messageId)) throw new InputError('Tin nhắn không hợp lệ.');
    const partner = await findPartner(req.params.username);
    if (!partner) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại' });
    const between = `((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))`;

    if (pin) {
      const count = await pool.query(
        `SELECT COUNT(*)::int AS n FROM direct_messages WHERE ${between} AND pinned_at IS NOT NULL AND id <> $1`,
        [req.params.messageId, me, partner.id]
      );
      if (count.rows[0].n >= MAX_PINS) throw new InputError(`Mỗi cuộc trò chuyện ghim tối đa ${MAX_PINS} tin. Bỏ ghim bớt trước.`);
    }
    const result = await pool.query(
      `UPDATE direct_messages
       SET pinned_at = ${pin ? 'COALESCE(pinned_at, NOW())' : 'NULL'}, pinned_by = ${pin ? 'COALESCE(pinned_by, $2)' : 'NULL'}
       WHERE id = $1 AND ${between}
       RETURNING id, pinned_at`,
      [req.params.messageId, me, partner.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Không tìm thấy tin nhắn.' });

    emitToUsers([me, partner.id], 'dm', {});
    res.json({ success: true, data: result.rows[0], message: pin ? 'Đã ghim tin nhắn.' : 'Đã bỏ ghim.' });
  } catch (error: any) {
    sendError(res, error);
  }
}

export const pinMessage = (req: AuthenticatedRequest, res: Response) => setPinned(req, res, true);
export const unpinMessage = (req: AuthenticatedRequest, res: Response) => setPinned(req, res, false);
