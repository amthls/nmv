import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';

import { JWT_SECRET } from '../config/env';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const extractToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token && token.trim() && token.trim() !== 'cookie_session' && token.trim() !== 'null' && token.trim() !== 'undefined') return token.trim();
  }
  const cookies = (req as any).cookies;
  if (cookies?.token && typeof cookies.token === 'string' && cookies.token.trim()) {
    return cookies.token.trim();
  }
  if (cookies?.auth_token && typeof cookies.auth_token === 'string' && cookies.auth_token.trim()) {
    return cookies.auth_token.trim();
  }
  return null;
};

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'B\u1ea1n ch\u01b0a \u0111\u0103ng nh\u1eadp ho\u1eb7c phi\u00ean \u0111\u0103ng nh\u1eadp \u0111\u00e3 h\u1ebft h\u1ea1n.',
      });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err: any) {
      return res.status(401).json({
        success: false,
        message: 'Phi\u00ean \u0111\u0103ng nh\u1eadp kh\u00f4ng h\u1ee3p l\u1ec7 ho\u1eb7c \u0111\u00e3 h\u1ebft h\u1ea1n.',
      });
    }

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Token x\u00e1c th\u1ef1c kh\u00f4ng h\u1ee3p l\u1ec7.',
      });
    }

    const userRes = await pool.query(
      `SELECT u.id, u.username, u.email, u.display_name, u.avatar_url, u.is_banned,
        COALESCE(
          json_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       WHERE u.id = $1::uuid
       GROUP BY u.id`,
      [decoded.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'T\u00e0i kho\u1ea3n kh\u00f4ng t\u1ed3n t\u1ea1i tr\u00ean h\u1ec7 th\u1ed1ng.',
      });
    }

    const dbUser = userRes.rows[0];
    if (dbUser.is_banned) {
      return res.status(403).json({
        success: false,
        message: 'T\u00e0i kho\u1ea3n c\u1ee7a b\u1ea1n \u0111\u00e3 b\u1ecb kh\u00f3a. Vui l\u00f2ng li\u00ean h\u1ec7 qu\u1ea3n tr\u1ecb vi\u00ean.',
      });
    }

    req.user = {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      display_name: dbUser.display_name,
      avatar_url: dbUser.avatar_url,
      roles: dbUser.roles || [],
    };

    next();
  } catch (error: any) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'L\u1ed7i x\u00e1c th\u1ef1c h\u1ec7 th\u1ed1ng: ' + error.message,
    });
  }
};

export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractToken(req);
    if (!token) return next();

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return next();
    }

    if (!decoded || !decoded.id) return next();

    const userRes = await pool.query(
      `SELECT u.id, u.username, u.email, u.display_name, u.avatar_url, u.is_banned,
        COALESCE(
          json_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       WHERE u.id = $1::uuid
       GROUP BY u.id`,
      [decoded.id]
    );

    if (userRes.rows.length > 0 && !userRes.rows[0].is_banned) {
      const dbUser = userRes.rows[0];
      req.user = {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        display_name: dbUser.display_name,
        avatar_url: dbUser.avatar_url,
        roles: dbUser.roles || [],
      };
    }

    next();
  } catch {
    next();
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'B\u1ea1n ch\u01b0a \u0111\u0103ng nh\u1eadp.',
      });
    }

    const userRoles = req.user.roles || [];
    if (userRoles.includes('admin')) {
      return next();
    }

    const hasRequiredRole = roles.some((role) => userRoles.includes(role));
    if (!hasRequiredRole) {
      return res.status(403).json({
        success: false,
        message: 'B\u1ea1n kh\u00f4ng c\u00f3 quy\u1ec1n th\u1ef1c hi\u1ec7n h\u00e0nh \u0111\u1ed9ng n\u00e0y. Y\u00eau c\u1ea7u quy\u1ec1n: ' + roles.join(', '),
      });
    }

    next();
  };
};