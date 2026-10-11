import { Request, Response } from 'express';
import { pool } from '../config/db';
import { communityStats } from '../services/communityClient';
import { libraryData } from '../services/libraryClient';
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

export const getCurrentUserProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const currentUserId = req.user.id;

    // 1. User base and roles
    const userRes = await pool.query(`
      SELECT 
        u.id, u.code, u.username, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
        u.email_verified,
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
    const [library, community, groups, storiesUploaded, chaptersUploaded] = await Promise.all([
      // reading, follows, bookmarks, albums: the library service (an empty account page part if it is down)
      libraryData(`/internal/users/${currentUserId}/overview`).catch((err) => {
        console.warn(`[library] overview of ${currentUserId} unavailable: ${err.message}`);
        return { stats: {}, recent_reads: [], albums: [], tags: [] };
      }),
      communityStats(currentUserId),
      count(`SELECT count(*) AS n FROM group_members WHERE user_id = $1`),
      count(`SELECT count(*) AS n FROM stories WHERE uploader_id = $1`),
      count(`SELECT count(*) AS n FROM chapters WHERE uploader_id = $1`),
    ]);
    const { posts, comments, comment_likes: commentLikes } = community;
    const lib = library.stats;
    const [storiesRead, chaptersRead, readingSeconds, favorites, bookmarks, albums, savedAlbums, albumSaves, followers, following] = [
      lib.stories_read, lib.chapters_read, lib.reading_seconds, lib.favorites, lib.bookmarks, lib.albums, lib.saved_albums,
      lib.album_saves_received, lib.followers, lib.following,
    ].map((n) => Number(n) || 0);

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
    // last reads, albums, genres read most: from the library overview above
    const [groupsRes, myStoriesRes] = await Promise.all([
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
    ]);
    user.recent_reads = library.recent_reads;
    user.albums = library.albums;
    user.groups = groupsRes.rows;
    user.my_stories = myStoriesRes.rows;
    user.top_tags = library.tags;

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
 * site staff, who also get a `moderation` block (status and the actions they may take; the email
 * comes from identity: GET /api/identity/users/:id/private).
 */
export const getUserProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { username } = req.params;
    const viewerRoles = req.user?.roles || [];
    const isStaff = viewerRoles.includes('admin') || viewerRoles.includes('mod');

    const result = await pool.query(`
      SELECT 
        u.id, u.code, u.username, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
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

    const [storiesRes, groupsRes, community] = await Promise.all([
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
      communityStats(row.id),
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
        posts_count: community.approved_posts,
        comments_count: community.comments,
        groups_count: groupsRes.rows.length,
      },
      stories: storiesRes.rows.slice(0, 12),
      groups: groupsRes.rows,
    };

    if (isStaff) {
      data.moderation = {
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

/**
 * GET /internal/users/:id/delete-check (identity → backend, signed actor headers): may this account be deleted
 * without leaving a translation group with no leader? Groups live here, accounts in identity.
 */
export const deleteCheck = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.json({ ok: true });
  const soleLeader = await pool.query(`
    SELECT g.name FROM group_members gm JOIN translation_groups g ON g.id = gm.group_id
    WHERE gm.user_id = $1 AND gm.role = 'leader'
      AND (SELECT COUNT(*) FROM group_members x WHERE x.group_id = gm.group_id AND x.role = 'leader') = 1
  `, [id]);
  if (soleLeader.rows.length > 0) {
    return res.json({
      ok: false,
      message: `Người dùng này là Trưởng nhóm duy nhất của: ${soleLeader.rows.map((r) => r.name).join(', ')}. Hãy chỉ định Trưởng nhóm khác trước khi xóa.`,
    });
  }
  res.json({ ok: true });
};

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
      RETURNING id, username, display_name, avatar_url, banner_url, bio, updated_at;
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

    // Only the settings that were sent change; the rest keep their saved value
    const fields: [string, unknown][] = [
      ['theme', optionalEnum(body.theme, THEMES, 'Giao diện')],
      ['primary_color', primaryColor || undefined],
      ['font_family', optionalText(body.font_family, 100, 'Phông chữ') || undefined],
      ['font_size', fontSize === undefined ? undefined : Math.round(fontSize)],
      ['line_height', lineHeight === undefined ? undefined : Math.round(lineHeight * 10) / 10],
      ['reading_mode', optionalText(body.reading_mode, 20, 'Chế độ đọc') || undefined],
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
