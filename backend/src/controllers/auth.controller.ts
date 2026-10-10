import { Request, Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { ENABLE_DEMO_ACCOUNTS } from '../config/env';

// Sign-up, sign-in, sessions, passwords and email live in the identity service (/api/identity/*,
// services/identity). The backend keeps the profile side of "who am I" and the optional demo list.

/** GET /auth/me: profile and visible roles of the signed-in user (email and account facts: GET /api/identity/me). */
export const getMe = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }
    const userRes = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
        COALESCE(u.email_verified, false) AS email_verified,
        COALESCE(json_agg(json_build_object('role', ur.role, 'is_visible', ur.is_visible)) FILTER (WHERE ur.role IS NOT NULL), '[]') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       WHERE u.id = $1::uuid
       GROUP BY u.id`,
      [req.user.id]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin tài khoản.' });
    }
    return res.json({ success: true, data: userRes.rows[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getDemoAccounts = async (_req: Request, res: Response) => {
  try {
    // Listing real usernames publicly is an account-enumeration gift; opt-in only (ENABLE_DEMO_ACCOUNTS=true)
    if (!ENABLE_DEMO_ACCOUNTS) {
      return res.json({ success: true, data: [], disabled: true });
    }
    const result = await pool.query(`
      SELECT u.id, u.username, u.display_name, u.avatar_url,
        COALESCE(json_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '[]') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      WHERE u.username IN ('admin', 'mod_sakura', 'trans_hana', 'reader_yuki', 'reader_ryu')
      GROUP BY u.id
      ORDER BY u.created_at ASC;
    `);
    return res.json({ success: true, data: result.rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
