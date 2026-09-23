import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

import { JWT_SECRET, ENABLE_DEMO_ACCOUNTS } from '../config/env';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days = 1 month

export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
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

export const register = async (req: Request, res: Response) => {
  try {
    const { username, email, password, display_name } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui l\u00f2ng \u0111i\u1ec1n \u0111\u1ea7y \u0111\u1ee7 username, email v\u00e0 m\u1eadt kh\u1ea9u.',
      });
    }

    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'T\u00ean \u0111\u0103ng nh\u1eadp ph\u1ea3i t\u1eeb 3 \u0111\u1ebfn 50 k\u00fd t\u1ef1.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'M\u1eadt kh\u1ea9u ph\u1ea3i c\u00f3 \u00edt nh\u1ea5t 6 k\u00fd t\u1ef1.',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Email kh\u00f4ng \u0111\u00fang \u0111\u1ecbnh d\u1ea1ng.',
      });
    }

    const checkRes = await pool.query(
      'SELECT id, username, email FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)',
      [username.trim(), email.trim()]
    );

    if (checkRes.rows.length > 0) {
      const existing = checkRes.rows[0];
      if (existing.username.toLowerCase() === username.toLowerCase()) {
        return res.status(400).json({
          success: false,
          message: 'T\u00ean \u0111\u0103ng nh\u1eadp n\u00e0y \u0111\u00e3 \u0111\u01b0\u1ee3c s\u1eed d\u1ee5ng.',
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Email n\u00e0y \u0111\u00e3 \u0111\u01b0\u1ee3c s\u1eed d\u1ee5ng.',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const insertUserRes = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, display_name, avatar_url, bio, created_at`,
      [username.trim(), email.trim(), passwordHash, display_name ? display_name.trim() : username.trim()]
    );

    const newUser = insertUserRes.rows[0];

    await pool.query(
      `INSERT INTO user_roles (user_id, role, is_visible)
       VALUES ($1, 'reader', true)`,
      [newUser.id]
    );

    await pool.query(
      `INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [newUser.id]
    );

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
      message: '\u0110\u0103ng k\u00fd t\u00e0i kho\u1ea3n th\u00e0nh c\u00f4ng! B\u1ea1n \u0111\u00e3 t\u1ef1 \u0111\u1ed9ng \u0111\u0103ng nh\u1eadp.',
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
      message: 'L\u1ed7i t\u1ea1o t\u00e0i kho\u1ea3n: ' + error.message,
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