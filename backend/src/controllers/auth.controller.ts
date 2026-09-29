import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

import { JWT_SECRET, ENABLE_DEMO_ACCOUNTS } from '../config/env';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days = 1 month

export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body || {};

    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui l\u00f2ng nh\u1eadp t\u00ean \u0111\u0103ng nh\u1eadp/email v\u00e0 m\u1eadt kh\u1ea9u.',
      });
    }

    const userRes = await pool.query(
      `SELECT u.*,
        COALESCE(
          json_agg(
            json_build_object('role', ur.role, 'is_visible', ur.is_visible)
          ) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       WHERE (LOWER(u.username) = LOWER($1) OR LOWER(u.email) = LOWER($1))
       GROUP BY u.id`,
      [identifier.trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'T\u00e0i kho\u1ea3n ho\u1eb7c m\u1eadt kh\u1ea9u kh\u00f4ng ch\u00ednh x\u00e1c.',
      });
    }

    const user = userRes.rows[0];

    if (user.is_banned) {
      return res.status(403).json({
        success: false,
        message: 'T\u00e0i kho\u1ea3n \u0111\u00e3 b\u1ecb kh\u00f3a. L\u00fd do: ' + (user.ban_reason || 'Vi ph\u1ea1m \u0111i\u1ec1u kho\u1ea3n c\u1ed9ng \u0111\u1ed3ng'),
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'T\u00e0i kho\u1ea3n ho\u1eb7c m\u1eadt kh\u1ea9u kh\u00f4ng ch\u00ednh x\u00e1c.',
      });
    }

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const rawRoles = user.roles.map((r: any) => r.role);
    const tokenPayload = {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: rawRoles,
    };

    // 30 days token
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '30d' });

    // Set 30-day persistent cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: THIRTY_DAYS_MS,
      path: '/',
    });

    const userResponse = {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      bio: user.bio,
      roles: user.roles,
    };

    return res.json({
      success: true,
      message: '\u0110\u0103ng nh\u1eadp th\u00e0nh c\u00f4ng! Phi\u00ean \u0111\u0103ng nh\u1eadp l\u01b0u 30 ng\u00e0y.',
      data: {
        token,
        user: userResponse,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'L\u1ed7i x\u1eed l\u00fd \u0111\u0103ng nh\u1eadp: ' + error.message,
    });
  }
};

// Usernames appear in profile URLs (/users/:username), so keep them URL-safe
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const register = async (req: Request, res: Response) => {
  const fail = (message: string, status = 400) => res.status(status).json({ success: false, message });
  try {
    const body = req.body || {};
    const { password } = body;
    if (typeof body.username !== 'string' || typeof body.email !== 'string' || typeof password !== 'string'
        || !body.username.trim() || !body.email.trim() || !password) {
      return fail('Vui lòng điền đầy đủ username, email và mật khẩu.');
    }
    if (body.display_name !== undefined && body.display_name !== null && typeof body.display_name !== 'string') {
      return fail('Tên hiển thị không hợp lệ.');
    }

    const username = body.username.trim();
    const email = body.email.trim().toLowerCase();
    const displayName = (body.display_name || '').trim() || username;

    if (!USERNAME_RE.test(username)) {
      return fail('Tên đăng nhập phải từ 3 đến 30 ký tự, chỉ gồm chữ không dấu, số và dấu _ . -');
    }
    if (email.length > 255 || !EMAIL_RE.test(email)) {
      return fail('Email không đúng định dạng.');
    }
    if (displayName.length > 100) {
      return fail('Tên hiển thị tối đa 100 ký tự.');
    }
    if (password.length < 6 || !password.trim()) {
      return fail('Mật khẩu phải có ít nhất 6 ký tự.');
    }
    // bcrypt only uses the first 72 bytes; longer passwords would be silently truncated
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return fail('Mật khẩu quá dài (tối đa 72 byte).');
    }

    const checkRes = await pool.query(
      'SELECT username FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = $2',
      [username, email]
    );
    if (checkRes.rows.length > 0) {
      const usernameTaken = checkRes.rows.some((r: any) => r.username.toLowerCase() === username.toLowerCase());
      return fail(usernameTaken ? 'Tên đăng nhập này đã được sử dụng.' : 'Email này đã được sử dụng.');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // User, role and settings are created together or not at all
    const client = await pool.connect();
    let newUser: any;
    try {
      await client.query('BEGIN');
      const insertUserRes = await client.query(
        `INSERT INTO users (username, email, password_hash, display_name, last_login_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, username, email, display_name, avatar_url, bio, created_at`,
        [username, email, passwordHash, displayName]
      );
      newUser = insertUserRes.rows[0];
      await client.query(
        `INSERT INTO user_roles (user_id, role, is_visible) VALUES ($1, 'reader', true)`,
        [newUser.id]
      );
      await client.query(
        `INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [newUser.id]
      );
      await client.query('COMMIT');
    } catch (txErr: any) {
      await client.query('ROLLBACK');
      if (txErr.code === '23505') {
        // Lost a race with a concurrent sign-up for the same username/email
        return fail(String(txErr.constraint).includes('username')
          ? 'Tên đăng nhập này đã được sử dụng.'
          : 'Email này đã được sử dụng.');
      }
      throw txErr;
    } finally {
      client.release();
    }

    const tokenPayload = {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      roles: ['reader'],
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '30d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: THIRTY_DAYS_MS,
      path: '/',
    });

    return res.status(201).json({
      success: true,
      message: 'Đăng ký tài khoản thành công! Bạn đã tự động đăng nhập.',
      data: {
        token,
        user: {
          ...newUser,
          roles: [{ role: 'reader', is_visible: true }],
        },
      },
    });
  } catch (error: any) {
    console.error('Register error:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi tạo tài khoản: ' + error.message,
    });
  }
};

export const getMe = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'B\u1ea1n ch\u01b0a \u0111\u0103ng nh\u1eadp.',
      });
    }

    const userRes = await pool.query(
      `SELECT u.id, u.username, u.email, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
        COALESCE(
          json_agg(
            json_build_object('role', ur.role, 'is_visible', ur.is_visible)
          ) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       WHERE u.id = $1::uuid
       GROUP BY u.id`,
      [req.user.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kh\u00f4ng t\u00ecm th\u1ea5y th\u00f4ng tin t\u00e0i kho\u1ea3n.',
      });
    }

    return res.json({
      success: true,
      data: userRes.rows[0],
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const logout = async (_req: Request, res: Response) => {
  res.clearCookie('token', { path: '/' });
  res.clearCookie('auth_token', { path: '/' });
  return res.json({
    success: true,
    message: '\u0110\u0103ng xu\u1ea5t th\u00e0nh c\u00f4ng!',
  });
};

export const getDemoAccounts = async (_req: Request, res: Response) => {
  try {
    // Listing real usernames publicly is an account-enumeration gift; opt-in only (ENABLE_DEMO_ACCOUNTS=true)
    if (!ENABLE_DEMO_ACCOUNTS) {
      return res.json({ success: true, data: [], disabled: true });
    }
    const result = await pool.query(`
      SELECT 
        u.id, u.username, u.display_name, u.avatar_url,
        COALESCE(
          json_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      WHERE u.username IN ('admin', 'mod_sakura', 'trans_hana', 'reader_yuki', 'reader_ryu')
      GROUP BY u.id
      ORDER BY u.created_at ASC;
    `);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};