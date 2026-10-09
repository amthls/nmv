import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendLinkMail, SITE_URL } from '../services/mailer';
import { disconnectUser } from '../services/realtime';

import { JWT_SECRET, ENABLE_DEMO_ACCOUNTS } from '../config/env';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days = 1 month

/**
 * Login cookie. `Secure` when the visitor reached us over HTTPS (Cloudflare/proxy sets X-Forwarded-Proto,
 * trusted via `trust proxy`) or when COOKIE_SECURE=true; plain-http localhost keeps working.
 */
const setSessionCookie = (req: Request, res: Response, token: string) => {
  res.cookie('token', token, {
    httpOnly: true,
    secure: req.secure || process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge: THIRTY_DAYS_MS,
    path: '/',
  });
};

/** Returns an error message, or null when the password is acceptable. */
const passwordProblem = (password: unknown): string | null => {
  if (typeof password !== 'string' || password.length < 6 || !password.trim()) return 'Mật khẩu phải có ít nhất 6 ký tự.';
  // bcrypt only uses the first 72 bytes; longer passwords would be silently truncated
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Mật khẩu quá dài (tối đa 72 byte).';
  return null;
};

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

type AccountTokenPurpose = 'reset_password' | 'verify_email';
const TOKEN_TTL_MINUTES: Record<AccountTokenPurpose, number> = { reset_password: 60, verify_email: 24 * 60 };

/** New one-time token (only its hash is stored); older unused tokens for the same purpose stop working. */
async function createAccountToken(userId: string, purpose: AccountTokenPurpose): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
  await pool.query(
    `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
    [sha256(token), userId, purpose, TOKEN_TTL_MINUTES[purpose]]
  );
  return token;
}

/** Marks the token used and returns its user id, or null if unknown, expired or already used. */
async function consumeAccountToken(token: unknown, purpose: AccountTokenPurpose): Promise<string | null> {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  const r = await pool.query(
    `UPDATE auth_tokens SET used_at = NOW()
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
     RETURNING user_id`,
    [sha256(token), purpose]
  );
  return r.rows[0]?.user_id ?? null;
}

async function sendVerificationMail(userId: string, email: string) {
  const token = await createAccountToken(userId, 'verify_email');
  await sendLinkMail(email, 'Xác thực email NovelHub',
    'Nhấn vào liên kết dưới đây để xác thực email cho tài khoản NovelHub của bạn (hiệu lực 24 giờ).',
    'Xác thực email', `${SITE_URL}/xac-thuc-email?token=${token}`);
}

/** Revoke every login token of the user issued before now (all devices). */
async function revokeSessions(userId: string, client: { query: typeof pool.query } = pool) {
  await client.query(`UPDATE users SET tokens_valid_after = NOW(), updated_at = NOW() WHERE id = $1`, [userId]);
  disconnectUser(userId);
}

const signSession = (user: { id: string; username: string; email: string }, roles: string[]) =>
  jwt.sign({ id: user.id, username: user.username, email: user.email, roles }, JWT_SECRET, { expiresIn: '30d' });

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

    // 30-day token in a persistent cookie
    const token = signSession(user, user.roles.map((r: any) => r.role));
    setSessionCookie(req, res, token);

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
    const pwProblem = passwordProblem(password);
    if (pwProblem) return fail(pwProblem);

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

    const token = signSession(newUser, ['reader']);
    setSessionCookie(req, res, token);
    sendVerificationMail(newUser.id, newUser.email).catch((e) => console.error('[mail] verification:', e.message));

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
        COALESCE(u.email_verified, false) AS email_verified,
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

/** Log out of every device: all existing tokens stop working, open sockets are closed. */
export const logoutAll = async (req: AuthenticatedRequest, res: Response) => {
  await revokeSessions(req.user!.id);
  res.clearCookie('token', { path: '/' });
  res.clearCookie('auth_token', { path: '/' });
  return res.json({ success: true, message: 'Đã đăng xuất khỏi mọi thiết bị.' });
};

/** Change password while signed in (needs the current one). Other devices are logged out, this one stays. */
export const changePassword = async (req: AuthenticatedRequest, res: Response) => {
  const { current_password, new_password } = req.body || {};
  if (typeof current_password !== 'string' || !current_password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập mật khẩu hiện tại.' });
  }
  const problem = passwordProblem(new_password);
  if (problem) return res.status(400).json({ success: false, message: problem });
  if (new_password === current_password) {
    return res.status(400).json({ success: false, message: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
  }

  const r = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user!.id]);
  if (!r.rows[0] || !(await bcrypt.compare(current_password, r.rows[0].password_hash))) {
    return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không đúng.' });
  }

  await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [req.user!.id, await bcrypt.hash(new_password, 10)]);
  await revokeSessions(req.user!.id);
  const token = signSession(req.user!, req.user!.roles);
  setSessionCookie(req, res, token);
  return res.json({ success: true, message: 'Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.', data: { token } });
};

const FORGOT_REPLY = 'Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu (hiệu lực 1 giờ). Hãy kiểm tra hộp thư, kể cả mục spam.';

/** Always the same answer, so the form cannot be used to find out which emails have accounts. */
export const forgotPassword = async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 255) {
    return res.status(400).json({ success: false, message: 'Email không đúng định dạng.' });
  }
  const r = await pool.query(
    `SELECT id, email FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL AND COALESCE(is_banned, false) = false`,
    [email]
  );
  const user = r.rows[0];
  if (user) {
    // Not awaited: answering faster for existing accounts would tell them apart
    createAccountToken(user.id, 'reset_password')
      .then((token) => sendLinkMail(user.email, 'Đặt lại mật khẩu NovelHub',
        'Có người (hy vọng là bạn) vừa yêu cầu đặt lại mật khẩu NovelHub. Liên kết có hiệu lực 1 giờ và chỉ dùng được một lần.',
        'Đặt mật khẩu mới', `${SITE_URL}/dat-lai-mat-khau?token=${token}`))
      .catch((e) => console.error('[mail] reset:', e.message));
  }
  return res.json({ success: true, message: FORGOT_REPLY });
};

/** Set a new password from the emailed link. Logs out every device; the user then signs in again. */
export const resetPassword = async (req: Request, res: Response) => {
  const { token, new_password } = req.body || {};
  const problem = passwordProblem(new_password);
  if (problem) return res.status(400).json({ success: false, message: problem });

  const userId = await consumeAccountToken(token, 'reset_password');
  if (!userId) {
    return res.status(400).json({ success: false, message: 'Liên kết không hợp lệ, đã hết hạn hoặc đã được dùng. Hãy yêu cầu liên kết mới.' });
  }
  // Clicking a link sent to the address also proves the address belongs to them
  await pool.query(`UPDATE users SET password_hash = $2, email_verified = true WHERE id = $1`, [userId, await bcrypt.hash(new_password, 10)]);
  await revokeSessions(userId);
  return res.json({ success: true, message: 'Đã đặt mật khẩu mới. Hãy đăng nhập lại.' });
};

export const verifyEmail = async (req: Request, res: Response) => {
  const userId = await consumeAccountToken(req.body?.token, 'verify_email');
  if (!userId) {
    return res.status(400).json({ success: false, message: 'Liên kết xác thực không hợp lệ, đã hết hạn hoặc đã được dùng.' });
  }
  await pool.query(`UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1`, [userId]);
  return res.json({ success: true, message: 'Email đã được xác thực.' });
};

export const resendVerification = async (req: AuthenticatedRequest, res: Response) => {
  const r = await pool.query(`SELECT email, COALESCE(email_verified, false) AS verified FROM users WHERE id = $1`, [req.user!.id]);
  if (r.rows[0]?.verified) return res.json({ success: true, message: 'Email của bạn đã được xác thực rồi.' });
  await sendVerificationMail(req.user!.id, r.rows[0].email);
  return res.json({ success: true, message: `Đã gửi email xác thực tới ${r.rows[0].email}.` });
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