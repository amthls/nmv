import { Request, Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { InputError, isUuid, optionalEnum, optionalText, optionalUrl } from '../utils/validation';

export const getUsers = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.username, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
        COALESCE(
          json_agg(
            json_build_object('role', ur.role, 'is_visible', ur.is_visible)
          ) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      WHERE u.is_banned = false
      GROUP BY u.id
      ORDER BY u.created_at ASC;
    `);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Admin endpoint: List all users for role management
 */
export const getAdminUserList = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.roles?.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Quản trị viên (Admin) mới có quyền truy cập danh sách này.',
      });
    }

    const { q = '' } = req.query;
    let queryStr = `
      SELECT 
        u.id, u.username, u.email, u.display_name, u.avatar_url, u.is_banned, u.deleted_at, u.created_at,
        COALESCE(
          json_agg(
            json_build_object('role', ur.role, 'is_visible', ur.is_visible)
          ) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
    `;
    const params: any[] = [];
    if (q && typeof q === 'string' && q.trim()) {
      params.push(`%${q.trim()}%`);
      queryStr += ` WHERE u.username ILIKE $1 OR u.email ILIKE $1 OR u.display_name ILIKE $1`;
    }
    queryStr += ` GROUP BY u.id ORDER BY u.created_at ASC;`;

    const result = await pool.query(queryStr, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Admin role management: Grant or Revoke a role (e.g. 'mod', 'translator', 'author', 'reader')
 */
export const manageUserRole = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actorRoles = req.user?.roles || [];
    const { userId } = req.params;
    const { role, action } = req.body || {}; // action: 'grant' | 'revoke'
    if (!isUuid(userId)) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại.' });

    if (!actorRoles.includes('admin')) {
      // Mods may only make a regular user a mod (see moderationRights); all else is admin-only
      const target = actorRoles.includes('mod') && role === 'mod' && action === 'grant'
        ? await loadModerationTarget(userId)
        : null;
      if (!target || !moderationRights({ id: req.user!.id, roles: actorRoles }, target).grant_mod) {
        return res.status(403).json({
          success: false,
          message: 'Chỉ Quản trị viên (Admin) mới có quyền phân quyền người dùng này.',
        });
      }
    }

    const validRoles = ['admin', 'mod', 'translator', 'author', 'reader'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Vai trò không hợp lệ. Các vai trò hợp lệ: ${validRoles.join(', ')}`,
      });
    }

    if (!['grant', 'revoke'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Hành động không hợp lệ. Vui lòng chọn 'grant' hoặc 'revoke'.",
      });
    }

    // Verify target user exists
    const userCheck = await pool.query(`SELECT id, username, is_banned, deleted_at FROM users WHERE id = $1::uuid`, [userId]);
    if (userCheck.rows.length === 0 || userCheck.rows[0].deleted_at) {
      return res.status(404).json({ success: false, message: 'Người dùng không tồn tại.' });
    }
    if (action === 'grant' && userCheck.rows[0].is_banned) {
      return res.status(400).json({ success: false, message: 'Không thể cấp quyền cho tài khoản đang bị khóa.' });
    }

    // Safety guard: Admin cannot revoke their own admin role
    if (userId === req.user!.id && role === 'admin' && action === 'revoke') {
      return res.status(400).json({
        success: false,
        message: 'Bạn không thể tự gỡ bỏ quyền Admin của chính mình.',
      });
    }

    if (action === 'grant') {
      await pool.query(
        `INSERT INTO user_roles (user_id, role, is_visible, granted_by, granted_at)
         VALUES ($1::uuid, $2, TRUE, $3::uuid, NOW())
         ON CONFLICT (user_id, role) DO UPDATE SET is_visible = TRUE;`,
        [userId, role, req.user!.id]
      );
    } else if (action === 'revoke') {
      await pool.query(
        `DELETE FROM user_roles WHERE user_id = $1::uuid AND role = $2;`,
        [userId, role]
      );
    }

    // Fetch updated roles
    const updatedRolesRes = await pool.query(
      `SELECT role, is_visible FROM user_roles WHERE user_id = $1::uuid`,
      [userId]
    );

    const roleNameVi: Record<string, string> = {
      admin: 'Quản trị viên (Admin)',
      mod: 'Kiểm duyệt viên (Mod)',
      translator: 'Dịch giả',
      author: 'Tác giả',
      reader: 'Độc giả',
    };

    res.json({
      success: true,
      message: action === 'grant'
        ? `Đã cấp quyền ${roleNameVi[role] || role} cho người dùng ${userCheck.rows[0].username} thành công!`
        : `Đã thu hồi quyền ${roleNameVi[role] || role} của người dùng ${userCheck.rows[0].username}!`,
      data: {
        userId,
        username: userCheck.rows[0].username,
        roles: updatedRolesRes.rows,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCurrentUserProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const currentUserId = req.user.id;

    // 1. User base and roles
    const userRes = await pool.query(`
      SELECT 
        u.id, u.code, u.username, u.email, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
        u.last_login_at, u.email_verified,
        COALESCE(
          json_agg(
            json_build_object('role', ur.role, 'is_visible', ur.is_visible)
          ) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      WHERE u.id = $1::uuid AND u.is_banned = false
      GROUP BY u.id;
    `, [currentUserId]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    const user = userRes.rows[0];

    // 2. User Settings
    const settingsRes = await pool.query(`SELECT * FROM user_settings WHERE user_id = $1::uuid`, [currentUserId]);
    user.settings = settingsRes.rows[0] || {
      theme: 'dark',
      primary_color: '#6C5CE7',
      font_family: 'Noto Serif',
      font_size: 18,
      line_height: 1.8,
      reading_mode: 'scroll',
    };

    // 3. User Statistics
    const count = (sql: string) => pool.query(sql, [currentUserId]).then((r) => parseInt(r.rows[0]?.n || '0'));
    const [
      storiesRead, chaptersRead, readingSeconds, favorites, bookmarks, posts, comments, groups,
      albums, savedAlbums, albumSaves, followers, following, storiesUploaded, chaptersUploaded, commentLikes,
    ] = await Promise.all([
      count(`SELECT count(DISTINCT story_id) AS n FROM reading_history WHERE user_id = $1`),
      count(`SELECT count(*) AS n FROM reading_history WHERE user_id = $1`),
      count(`SELECT COALESCE(sum(time_spent_seconds), 0) AS n FROM reading_history WHERE user_id = $1`),
      count(`SELECT count(*) AS n FROM user_favorites WHERE user_id = $1`),
      count(`SELECT count(*) AS n FROM bookmarks WHERE user_id = $1`),
      count(`SELECT count(*) AS n FROM posts WHERE user_id = $1 AND is_deleted = false`),
      count(`SELECT count(*) AS n FROM comments WHERE user_id = $1 AND is_deleted = false`),
      count(`SELECT count(*) AS n FROM group_members WHERE user_id = $1`),
      count(`SELECT count(*) AS n FROM albums WHERE user_id = $1`),
      count(`SELECT count(*) AS n FROM album_saves WHERE user_id = $1`),
      count(`SELECT count(*) AS n FROM album_saves sv JOIN albums a ON a.id = sv.album_id WHERE a.user_id = $1`),
      count(`SELECT count(*) AS n FROM user_follows WHERE following_id = $1`),
      count(`SELECT count(*) AS n FROM user_follows WHERE follower_id = $1`),
      count(`SELECT count(*) AS n FROM stories WHERE uploader_id = $1`),
      count(`SELECT count(*) AS n FROM chapters WHERE uploader_id = $1`),
      count(`SELECT COALESCE(sum(like_count), 0) AS n FROM comments WHERE user_id = $1 AND is_deleted = false`),
    ]);

    user.stats = {
      stories_read: storiesRead,
      chapters_read: chaptersRead,
      reading_minutes: Math.round(readingSeconds / 60),
      favorites_count: favorites,
      bookmarks_count: bookmarks,
      posts_count: posts,
      comments_count: comments,
      groups_count: groups,
      albums_count: albums,
      saved_albums_count: savedAlbums,
      album_saves_received: albumSaves,
      followers_count: followers,
      following_count: following,
      stories_uploaded: storiesUploaded,
      chapters_uploaded: chaptersUploaded,
      comment_likes_received: commentLikes,
    };

    // 4. Overview blocks for the account page
    const [recentRes, albumsRes, groupsRes, myStoriesRes, tagsRes] = await Promise.all([
      // last chapter read in each of the latest stories
      pool.query(`
        SELECT * FROM (
          SELECT DISTINCT ON (rh.story_id)
            s.id AS story_id, s.title, s.slug, s.cover_image_url, s.story_type, s.total_chapters,
            c.title AS chapter_title, c.slug AS chapter_slug, c.chapter_number, rh.read_at
          FROM reading_history rh
          JOIN stories s ON s.id = rh.story_id
          JOIN chapters c ON c.id = rh.chapter_id
          WHERE rh.user_id = $1
          ORDER BY rh.story_id, rh.read_at DESC
        ) t ORDER BY read_at DESC LIMIT 6
      `, [currentUserId]),
      pool.query(`
        SELECT a.id, a.name, a.is_public, a.share_token, a.updated_at,
          (SELECT count(*)::int FROM album_stories x WHERE x.album_id = a.id) AS story_count,
          (SELECT count(*)::int FROM album_saves sv WHERE sv.album_id = a.id) AS save_count,
          COALESCE((SELECT json_agg(p) FROM (
            SELECT s.id, s.cover_image_url, s.title FROM album_stories x JOIN stories s ON s.id = x.story_id
            WHERE x.album_id = a.id ORDER BY x.added_at DESC LIMIT 4) p), '[]'::json) AS preview
        FROM albums a WHERE a.user_id = $1
        ORDER BY a.updated_at DESC LIMIT 6
      `, [currentUserId]),
      pool.query(`
        SELECT g.name, g.slug, g.avatar_url, gm.role, gm.joined_at
        FROM group_members gm JOIN translation_groups g ON g.id = gm.group_id
        WHERE gm.user_id = $1
        ORDER BY gm.joined_at ASC
      `, [currentUserId]),
      pool.query(`
        SELECT id, title, slug, cover_image_url, story_type, approval_status, total_chapters, total_views
        FROM stories WHERE uploader_id = $1
        ORDER BY created_at DESC LIMIT 6
      `, [currentUserId]),
      // genres read most, from the stories in the reading history
      pool.query(`
        SELECT t.name, t.slug, count(DISTINCT rh.story_id)::int AS n
        FROM reading_history rh
        JOIN story_tags st ON st.story_id = rh.story_id
        JOIN tags t ON t.id = st.tag_id
        WHERE rh.user_id = $1
        GROUP BY t.id ORDER BY n DESC, t.name LIMIT 8
      `, [currentUserId]),
    ]);
    user.recent_reads = recentRes.rows;
    user.albums = albumsRes.rows;
    user.groups = groupsRes.rows;
    user.my_stories = myStoriesRes.rows;
    user.top_tags = tagsRes.rows;

    res.json({
      success: true,
      data: user,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Who may moderate whom. One place for the rules, used by the actions and to tell the
 * profile page which buttons to show:
 *  - nobody acts on themselves or on an admin;
 *  - admins act on everyone else, mods only on regular users (not on other mods);
 *  - admins and mods may make a regular user a mod; only admins take the mod role away.
 */
export function moderationRights(
  actor: { id: string; roles: string[] },
  target: { id: string; roles: string[]; is_banned: boolean; deleted_at: string | null }
) {
  const actorAdmin = actor.roles.includes('admin');
  const actorMod = actor.roles.includes('mod');
  const targetAdmin = target.roles.includes('admin');
  const targetMod = target.roles.includes('mod');
  const self = actor.id === target.id;
  const alive = !target.deleted_at;
  const outranks = !self && !targetAdmin && (actorAdmin || (actorMod && !targetMod));
  return {
    ban: alive && outranks && !target.is_banned,
    unban: alive && outranks && target.is_banned,
    delete: alive && outranks,
    grant_mod: alive && !self && !target.is_banned && !targetAdmin && !targetMod && (actorAdmin || actorMod),
    revoke_mod: alive && !self && actorAdmin && targetMod,
  };
}

async function loadModerationTarget(userId: string) {
  const r = await pool.query(`
    SELECT u.id, u.username, u.display_name, u.is_banned, u.deleted_at,
      COALESCE(array_agg(ur.role::text) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
    FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
    WHERE u.id = $1::uuid
    GROUP BY u.id
  `, [userId]);
  return r.rows[0] || null;
}

/**
 * Public profile of another user: only what is safe to show anyone (no email, settings,
 * reading history, bookmarks or favorites). Banned/deleted accounts are hidden except from
 * site staff, who also get a `moderation` block (status, email and the actions they may take).
 */
export const getUserProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { username } = req.params;
    const viewerRoles = req.user?.roles || [];
    const isStaff = viewerRoles.includes('admin') || viewerRoles.includes('mod');

    const result = await pool.query(`
      SELECT 
        u.id, u.code, u.username, u.email, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
        u.is_banned, u.ban_reason, u.banned_at, u.deleted_at,
        COALESCE(
          json_agg(
            json_build_object('role', ur.role, 'is_visible', ur.is_visible)
          ) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      WHERE lower(u.username) = lower($1)
      GROUP BY u.id;
    `, [String(username).slice(0, 50)]);

    const row = result.rows[0];
    if (!row || ((row.is_banned || row.deleted_at) && !isStaff)) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    const [storiesRes, groupsRes, postCount, commentCount] = await Promise.all([
      pool.query(`
        SELECT id, title, slug, cover_image_url, story_type, status, total_chapters, total_views
        FROM stories WHERE uploader_id = $1 AND approval_status = 'approved'
        ORDER BY last_chapter_at DESC NULLS LAST, created_at DESC
      `, [row.id]),
      pool.query(`
        SELECT g.name, g.slug, g.avatar_url, gm.role
        FROM group_members gm JOIN translation_groups g ON g.id = gm.group_id
        WHERE gm.user_id = $1 AND g.approval_status = 'approved'
        ORDER BY gm.joined_at ASC
      `, [row.id]),
      pool.query(`SELECT COUNT(*)::int AS n FROM posts WHERE user_id = $1 AND is_deleted = false AND approval_status = 'approved'`, [row.id]),
      pool.query(`SELECT COUNT(*)::int AS n FROM comments WHERE user_id = $1 AND is_deleted = false`, [row.id]),
    ]);

    const allRoles: string[] = row.roles.map((r: any) => r.role);
    const data: any = {
      id: row.id,
      code: row.code,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      banner_url: row.banner_url,
      bio: row.bio,
      created_at: row.created_at,
      roles: row.roles.filter((r: any) => r.is_visible !== false).map((r: any) => r.role),
      stats: {
        stories_count: storiesRes.rows.length,
        posts_count: postCount.rows[0].n,
        comments_count: commentCount.rows[0].n,
        groups_count: groupsRes.rows.length,
      },
      stories: storiesRes.rows.slice(0, 12),
      groups: groupsRes.rows,
    };

    if (isStaff) {
      data.moderation = {
        email: row.email,
        roles: allRoles,
        is_banned: row.is_banned,
        ban_reason: row.ban_reason,
        banned_at: row.banned_at,
        deleted_at: row.deleted_at,
        can: moderationRights(
          { id: req.user!.id, roles: viewerRoles },
          { id: row.id, roles: allRoles, is_banned: row.is_banned, deleted_at: row.deleted_at }
        ),
      };
    }

    res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Ban (with a reason) or unban. Banned users can't log in and every signed-in request is refused. */
export const setUserBan = (ban: boolean) => async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại.' });

    const target = await loadModerationTarget(userId);
    if (!target) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại.' });

    const can = moderationRights({ id: req.user!.id, roles: req.user!.roles || [] }, target);
    if (ban ? !can.ban : !can.unban) {
      const already = ban ? target.is_banned : !target.is_banned;
      return res.status(already ? 409 : 403).json({
        success: false,
        message: already
          ? (ban ? 'Tài khoản này đã bị khóa.' : 'Tài khoản này không bị khóa.')
          : 'Bạn không có quyền thực hiện thao tác này với tài khoản này.',
      });
    }

    if (ban) {
      const reason = optionalText(req.body?.reason, 500, 'Lý do') || 'Vi phạm điều khoản cộng đồng';
      await pool.query(`
        UPDATE users SET is_banned = true, ban_reason = $1, banned_at = NOW(), banned_by = $2 WHERE id = $3
      `, [reason, req.user!.id, userId]);
    } else {
      await pool.query(`
        UPDATE users SET is_banned = false, ban_reason = NULL, banned_at = NULL, banned_by = NULL WHERE id = $1
      `, [userId]);
    }

    res.json({
      success: true,
      message: ban
        ? `Đã khóa tài khoản ${target.username}.`
        : `Đã mở khóa tài khoản ${target.username}.`,
    });
  } catch (error: any) {
    if (error instanceof InputError) return res.status(error.status).json({ success: false, message: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete an account. Stories, chapters and groups reference their author, so the row is kept but
 * anonymized and locked: name/email/password/avatar/bio scrubbed, roles, memberships, follows and
 * settings removed. With purge_content, their posts and comments are hidden too.
 */
export const deleteUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại.' });
    const purgeContent = req.body?.purge_content === true;

    const target = await loadModerationTarget(userId);
    if (!target) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại.' });
    const can = moderationRights({ id: req.user!.id, roles: req.user!.roles || [] }, target);
    if (!can.delete) {
      return res.status(target.deleted_at ? 409 : 403).json({
        success: false,
        message: target.deleted_at ? 'Tài khoản này đã bị xóa.' : 'Bạn không có quyền xóa tài khoản này.',
      });
    }

    // A group must never be left without a leader
    const soleLeader = await pool.query(`
      SELECT g.name FROM group_members gm JOIN translation_groups g ON g.id = gm.group_id
      WHERE gm.user_id = $1 AND gm.role = 'leader'
        AND (SELECT COUNT(*) FROM group_members x WHERE x.group_id = gm.group_id AND x.role = 'leader') = 1
    `, [userId]);
    if (soleLeader.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Người dùng này là Trưởng nhóm duy nhất của: ${soleLeader.rows.map((r) => r.name).join(', ')}. Hãy chỉ định Trưởng nhóm khác trước khi xóa.`,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        UPDATE users SET
          username = 'deleted_' || substr(replace(id::text, '-', ''), 1, 12),
          email = 'deleted+' || id::text || '@deleted.invalid',
          password_hash = '!',
          display_name = 'Người dùng đã xóa',
          avatar_url = NULL, banner_url = NULL, bio = NULL,
          is_banned = true, ban_reason = 'Tài khoản đã bị xóa', banned_at = NOW(), banned_by = $2,
          deleted_at = NOW(), deleted_by = $2
        WHERE id = $1
      `, [userId, req.user!.id]);
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM user_settings WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM group_members WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM group_join_requests WHERE user_id = $1 AND status = 'pending'`, [userId]);
      await client.query(`DELETE FROM user_follows WHERE follower_id = $1 OR following_id = $1`, [userId]);

      if (purgeContent) {
        await client.query(`UPDATE posts SET is_deleted = true WHERE user_id = $1 AND is_deleted = false`, [userId]);
        await purgeUserComments(client, userId);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json({
      success: true,
      message: `Đã xóa tài khoản ${target.username}${purgeContent ? ' cùng các bài viết và bình luận' : ''}.`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Hide every live comment of a user (and the replies under them, like a normal comment delete),
 * then recount the comment counters of everything that was touched.
 */
async function purgeUserComments(client: any, userId: string) {
  const removed = await client.query(`
    WITH RECURSIVE t AS (
      SELECT id FROM comments WHERE user_id = $1 AND is_deleted = false
      UNION
      SELECT c.id FROM comments c JOIN t ON c.parent_id = t.id WHERE c.is_deleted = false
    )
    UPDATE comments SET is_deleted = true WHERE id IN (SELECT id FROM t) AND is_deleted = false
    RETURNING parent_id, target_type, target_id;
  `, [userId]);
  if (removed.rowCount === 0) return;

  const ids = (type: string) => [...new Set(removed.rows.filter((r: any) => r.target_type === type).map((r: any) => r.target_id))];
  const parentIds = [...new Set(removed.rows.map((r: any) => r.parent_id).filter(Boolean))];
  const chapterIds = ids('chapter');
  const storyIds = ids('story');
  const postIds = ids('post');

  if (parentIds.length) {
    await client.query(`
      UPDATE comments p SET reply_count = (SELECT COUNT(*) FROM comments c WHERE c.parent_id = p.id AND c.is_deleted = false)
      WHERE p.id = ANY($1::uuid[])
    `, [parentIds]);
  }
  if (chapterIds.length) {
    await client.query(`
      UPDATE chapters ch SET total_comments = (
        SELECT COUNT(*) FROM comments c WHERE c.target_type = 'chapter' AND c.target_id = ch.id AND c.is_deleted = false)
      WHERE ch.id = ANY($1::uuid[])
    `, [chapterIds]);
  }
  // A story's total counts comments on the story page and on all of its chapters
  await client.query(`
    UPDATE stories s SET total_comments =
      (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'story' AND c.target_id = s.id AND c.is_deleted = false)
      + (SELECT COUNT(*) FROM comments c JOIN chapters ch ON ch.id = c.target_id
         WHERE c.target_type = 'chapter' AND ch.story_id = s.id AND c.is_deleted = false)
    WHERE s.id = ANY($1::uuid[]) OR s.id IN (SELECT story_id FROM chapters WHERE id = ANY($2::uuid[]))
  `, [storyIds, chapterIds]);
  if (postIds.length) {
    await client.query(`
      UPDATE posts p SET comment_count = (
        SELECT COUNT(*) FROM comments c WHERE c.target_type = 'post' AND c.target_id = p.id AND c.is_deleted = false)
      WHERE p.id = ANY($1::uuid[])
    `, [postIds]);
  }
}

export const updateUserProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const body = req.body || {};
    // Only fields that were sent change; '' or null clears bio/avatar/banner
    const displayName = optionalText(body.display_name, 100, 'Tên hiển thị');
    if (body.display_name !== undefined && !displayName) throw new InputError('Tên hiển thị không được để trống.');
    const bio = optionalText(body.bio, 2000, 'Giới thiệu');
    const fields: [string, unknown][] = [
      ['display_name', displayName],
      ['bio', bio],
      ['avatar_url', optionalUrl(body.avatar_url, 'Ảnh đại diện')],
      ['banner_url', optionalUrl(body.banner_url, 'Ảnh bìa')],
    ];

    const sets: string[] = [];
    const params: any[] = [];
    for (const [column, value] of fields) {
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    sets.push('updated_at = NOW()');
    params.push(req.user.id);

    const result = await pool.query(`
      UPDATE users SET ${sets.join(', ')}
      WHERE id = $${params.length}::uuid
      RETURNING id, username, email, display_name, avatar_url, banner_url, bio, updated_at;
    `, params);

    res.json({
      success: true,
      message: 'Cập nhật hồ sơ cá nhân thành công',
      data: result.rows[0],
    });
  } catch (error: any) {
    if (error instanceof InputError) return res.status(error.status).json({ success: false, message: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
};

const THEMES = ['dark', 'light', 'midnight', 'sepia'] as const;

/** Optional number within [min, max]; undefined when not sent. */
function optionalNumber(value: unknown, min: number, max: number, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label} phải từ ${min} đến ${max}.`);
  return n;
}

export const updateUserSettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const body = req.body || {};
    const primaryColor = optionalText(body.primary_color, 7, 'Màu chủ đạo');
    if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) throw new InputError('Màu chủ đạo phải có dạng #RRGGBB.');
    const fontSize = optionalNumber(body.font_size, 10, 40, 'Cỡ chữ');
    const lineHeight = optionalNumber(body.line_height, 1, 3, 'Giãn dòng');
    for (const key of ['notify_chapter_update', 'notify_group_events', 'notify_comments', 'notify_system', 'notify_post_comments', 'notify_post_reactions']) {
      if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new InputError('Cài đặt thông báo không hợp lệ.');
    }

    // Only the settings that were sent change; the rest keep their saved value
    const fields: [string, unknown][] = [
      ['theme', optionalEnum(body.theme, THEMES, 'Giao diện')],
      ['primary_color', primaryColor || undefined],
      ['font_family', optionalText(body.font_family, 100, 'Phông chữ') || undefined],
      ['font_size', fontSize === undefined ? undefined : Math.round(fontSize)],
      ['line_height', lineHeight === undefined ? undefined : Math.round(lineHeight * 10) / 10],
      ['reading_mode', optionalText(body.reading_mode, 20, 'Chế độ đọc') || undefined],
      ['notify_chapter_update', body.notify_chapter_update],
      ['notify_group_events', body.notify_group_events],
      ['notify_comments', body.notify_comments],
      ['notify_system', body.notify_system],
      ['notify_post_comments', body.notify_post_comments],
      ['notify_post_reactions', body.notify_post_reactions],
    ];

    const columns: string[] = ['user_id'];
    const params: any[] = [req.user.id];
    for (const [column, value] of fields) {
      if (value === undefined) continue;
      columns.push(column);
      params.push(value);
    }
    const placeholders = params.map((_, i) => `$${i + 1}`);
    const updates = columns.slice(1).map((c) => `${c} = EXCLUDED.${c}`);
    updates.push('updated_at = NOW()');

    // Insert the row if the user has none yet (column defaults fill the rest), else update just these fields
    const result = await pool.query(`
      INSERT INTO user_settings (${columns.join(', ')}) VALUES (${placeholders.join(', ')})
      ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}
      RETURNING *;
    `, params);

    res.json({
      success: true,
      message: 'Cập nhật cấu hình trải nghiệm đọc thành công',
      data: result.rows[0],
    });
  } catch (error: any) {
    if (error instanceof InputError) return res.status(error.status).json({ success: false, message: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
};
