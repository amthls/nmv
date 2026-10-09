import { Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { clientDbError } from '../utils/dbErrors';
import { InputError, isUuid, optionalText, requiredText } from '../utils/validation';

/**
 * Albums: named story lists ("Truyện Đã Lưu" upgraded). A story may sit in any number of a
 * user's albums. Private albums open only for the owner or with the share link (?key=token);
 * public ones also show up under the stories they contain. Others can save an album (live)
 * or copy its stories into an album of their own.
 */

const MAX_ALBUMS_PER_USER = 100;
const MAX_STORIES_PER_ALBUM = 1000;

// Only approved stories are listed, counted or copied
const VISIBLE_STORY = `s.approval_status = 'approved'`;
// Albums of banned or deleted accounts are never recommended to others
const ACTIVE_OWNER = `u.deleted_at IS NULL AND COALESCE(u.is_banned, false) = false`;

/**
 * Album card columns. `excludeStory` (a $n placeholder) leaves that story out of the cover
 * preview, so "other albums with this story" previews what else is inside.
 */
const summaryColumns = (excludeStory?: string) => `
  a.id, a.name, a.description, a.is_public, a.copied_from, a.created_at, a.updated_at,
  u.id AS owner_id, u.username AS owner_username, u.display_name AS owner_name, u.avatar_url AS owner_avatar,
  (SELECT count(*)::int FROM album_stories x JOIN stories s ON s.id = x.story_id
    WHERE x.album_id = a.id AND ${VISIBLE_STORY}) AS story_count,
  (SELECT count(*)::int FROM album_saves sv WHERE sv.album_id = a.id) AS save_count,
  COALESCE((
    SELECT json_agg(p) FROM (
      SELECT s.id, s.slug, s.title, s.cover_image_url
      FROM album_stories x JOIN stories s ON s.id = x.story_id
      WHERE x.album_id = a.id AND ${VISIBLE_STORY}${excludeStory ? ` AND s.id <> ${excludeStory}` : ''}
      ORDER BY x.added_at DESC
      LIMIT 4
    ) p
  ), '[]'::json) AS preview`;

const fail = (res: Response, error: any, label: string) => {
  if (error instanceof InputError) return res.status(error.status).json({ success: false, message: error.message });
  const clientErr = clientDbError(error);
  if (clientErr) return res.status(clientErr.status).json({ success: false, message: clientErr.message });
  console.error(`Error ${label}:`, error);
  return res.status(500).json({ success: false, message: error.message });
};

const requireUser = (req: AuthenticatedRequest) => {
  if (!req.user?.id) throw new InputError('Chưa đăng nhập.', 401);
  return req.user.id;
};

const requireAlbumId = (value: unknown) => {
  if (!isUuid(value)) throw new InputError('Album không tồn tại.', 404);
  return value;
};

/** Loads an album the user owns, or throws 404 (never reveals someone else's private album). */
async function ownAlbum(albumId: string, userId: string) {
  const r = await pool.query('SELECT id, name, user_id FROM albums WHERE id = $1 AND user_id = $2', [albumId, userId]);
  if (r.rows.length === 0) throw new InputError('Album không tồn tại hoặc không thuộc về bạn.', 404);
  return r.rows[0];
}

/** Loads an album the viewer may open: owner, public album, or private album with the right share key. */
async function viewableAlbum(albumId: string, userId: string | undefined, key: unknown) {
  const r = await pool.query(
    'SELECT id, user_id, name, is_public, share_token FROM albums WHERE id = $1',
    [albumId]
  );
  const album = r.rows[0];
  const allowed = album && (album.user_id === userId || album.is_public || (typeof key === 'string' && key === album.share_token));
  if (!allowed) throw new InputError('Album không tồn tại hoặc là album riêng tư.', 404);
  return album;
}

async function albumCount(userId: string) {
  const r = await pool.query('SELECT count(*)::int AS n FROM albums WHERE user_id = $1', [userId]);
  return r.rows[0].n as number;
}

async function storyCount(albumId: string) {
  const r = await pool.query('SELECT count(*)::int AS n FROM album_stories WHERE album_id = $1', [albumId]);
  return r.rows[0].n as number;
}

function parseAlbumFields(body: any, partial: boolean) {
  const name = partial ? optionalText(body?.name, 100, 'Tên album') : requiredText(body?.name, 100, 'Tên album');
  if (partial && name === null) throw new InputError('Tên album không được để trống.');
  const description = optionalText(body?.description, 500, 'Mô tả');
  const isPublic = body?.is_public === undefined ? undefined : body.is_public === true;
  return { name, description, isPublic };
}

/** GET /albums/me?story_id= : my albums; with story_id each one says whether it holds that story. */
export const getMyAlbums = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = requireUser(req);
    const storyId = isUuid(req.query.story_id) ? req.query.story_id : null;
    const result = await pool.query(
      `SELECT ${summaryColumns()}, a.share_token,
         ${storyId ? 'EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = a.id AND x.story_id = $2)' : 'false'} AS has_story
       FROM albums a JOIN users u ON u.id = a.user_id
       WHERE a.user_id = $1
       ORDER BY a.updated_at DESC`,
      storyId ? [userId, storyId] : [userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error: any) {
    return fail(res, error, 'fetching my albums');
  }
};

/** GET /albums/saved : other people's albums I saved, still viewable to me. */
export const getSavedAlbums = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = requireUser(req);
    // Saved through a share link: keep showing it while the link still matches (owner may reset it)
    const result = await pool.query(
      `SELECT ${summaryColumns()}, sv.created_at AS saved_at,
         CASE WHEN a.is_public THEN NULL ELSE sv.share_token END AS share_key
       FROM album_saves sv
       JOIN albums a ON a.id = sv.album_id
       JOIN users u ON u.id = a.user_id
       WHERE sv.user_id = $1 AND (a.is_public OR sv.share_token = a.share_token)
       ORDER BY sv.created_at DESC`,
      [userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error: any) {
    return fail(res, error, 'fetching saved albums');
  }
};

/**
 * GET /albums/by-story/:storyId : the album row at the bottom of a story page.
 * mine   = my albums that hold this story
 * others = public albums of other users that hold it, in random order, previewing their other stories
 */
export const getAlbumsByStory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { storyId } = req.params;
    if (!isUuid(storyId)) throw new InputError('Truyện không tồn tại.', 404);
    const userId = req.user?.id || null;
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit as string) || 12));

    const mine = userId
      ? (await pool.query(
          `SELECT ${summaryColumns('$2')}, a.share_token
           FROM albums a JOIN users u ON u.id = a.user_id
           WHERE a.user_id = $1 AND EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = a.id AND x.story_id = $2)
           ORDER BY a.updated_at DESC`,
          [userId, storyId]
        )).rows
      : [];

    const others = (await pool.query(
      `SELECT * FROM (
         SELECT ${summaryColumns('$1')},
           ${userId ? 'EXISTS (SELECT 1 FROM album_saves sv WHERE sv.album_id = a.id AND sv.user_id = $2)' : 'false'} AS is_saved
         FROM albums a JOIN users u ON u.id = a.user_id
         WHERE a.is_public AND ${ACTIVE_OWNER}
           ${userId ? 'AND a.user_id <> $2' : ''}
           AND EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = a.id AND x.story_id = $1)
       ) t
       -- random each visit; albums holding more than just this story come first (useful to browse)
       ORDER BY (t.story_count > 1) DESC, random()
       LIMIT ${limit}`,
      userId ? [storyId, userId] : [storyId]
    )).rows;

    return res.json({ success: true, data: { mine, others } });
  } catch (error: any) {
    return fail(res, error, 'fetching albums by story');
  }
};

/** GET /albums/:id?key= : album page with its stories. */
export const getAlbum = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const albumId = requireAlbumId(req.params.id);
    const userId = req.user?.id;
    await viewableAlbum(albumId, userId, req.query.key);

    const albumRes = await pool.query(
      `SELECT ${summaryColumns()}, a.share_token,
         ${userId ? 'EXISTS (SELECT 1 FROM album_saves sv WHERE sv.album_id = a.id AND sv.user_id = $2)' : 'false'} AS is_saved,
         src.name AS copied_from_name, src.is_public AS copied_from_public
       FROM albums a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN albums src ON src.id = a.copied_from
       WHERE a.id = $1`,
      userId ? [albumId, userId] : [albumId]
    );
    const album = albumRes.rows[0];
    album.is_owner = album.owner_id === userId;
    if (!album.is_owner) delete album.share_token; // only the owner may hand out the link
    if (!album.copied_from_public) {
      album.copied_from = null; // don't link to a private source album
      album.copied_from_name = null;
    }
    delete album.copied_from_public;

    const storiesRes = await pool.query(
      `SELECT s.id, s.title, s.slug, s.cover_image_url, s.author_name, s.story_type, s.status,
              s.total_chapters, s.total_views, s.rating_avg, x.added_at
       FROM album_stories x JOIN stories s ON s.id = x.story_id
       WHERE x.album_id = $1 AND ${VISIBLE_STORY}
       ORDER BY x.added_at DESC`,
      [albumId]
    );
    album.stories = storiesRes.rows;

    return res.json({ success: true, data: album });
  } catch (error: any) {
    return fail(res, error, 'fetching album');
  }
};

/** POST /albums {name, description?, is_public?, story_id?} */
export const createAlbum = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = requireUser(req);
    const { name, description, isPublic } = parseAlbumFields(req.body, false);
    const storyId = req.body?.story_id;
    if (storyId !== undefined && storyId !== null && !isUuid(storyId)) throw new InputError('Truyện không hợp lệ.');
    if ((await albumCount(userId)) >= MAX_ALBUMS_PER_USER) {
      throw new InputError(`Mỗi tài khoản tạo tối đa ${MAX_ALBUMS_PER_USER} album.`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO albums (user_id, name, description, is_public) VALUES ($1, $2, $3, $4)
         RETURNING id, name, description, is_public, share_token, created_at, updated_at`,
        [userId, name, description ?? null, isPublic ?? false]
      );
      if (storyId) {
        await client.query('INSERT INTO album_stories (album_id, story_id) VALUES ($1, $2)', [ins.rows[0].id, storyId]);
      }
      await client.query('COMMIT');
      return res.status(201).json({ success: true, data: { ...ins.rows[0], has_story: Boolean(storyId) }, message: 'Đã tạo album.' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    return fail(res, error, 'creating album');
  }
};

/** PUT /albums/:id {name?, description?, is_public?} : rename, describe, make public/private. */
export const updateAlbum = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = requireUser(req);
    const albumId = requireAlbumId(req.params.id);
    await ownAlbum(albumId, userId);
    const { name, description, isPublic } = parseAlbumFields(req.body, true);

    const result = await pool.query(
      `UPDATE albums SET
         name = COALESCE($2, name),
         description = CASE WHEN $3::boolean THEN $4 ELSE description END,
         is_public = COALESCE($5, is_public),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, is_public, share_token, updated_at`,
      [albumId, name ?? null, description !== undefined, description ?? null, isPublic ?? null]
    );
    return res.json({ success: true, data: result.rows[0], message: 'Đã cập nhật album.' });
  } catch (error: any) {
    return fail(res, error, 'updating album');
  }
};

/** DELETE /albums/:id */
export const deleteAlbum = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = requireUser(req);
    const albumId = requireAlbumId(req.params.id);
    await ownAlbum(albumId, userId);
    await pool.query('DELETE FROM albums WHERE id = $1', [albumId]);
    return res.json({ success: true, message: 'Đã xóa album.' });
  } catch (error: any) {
    return fail(res, error, 'deleting album');
  }
};

/** POST /albums/:id/share-link/reset : new share key; old private links stop working. */
export const resetShareLink = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = requireUser(req);
    const albumId = requireAlbumId(req.params.id);
    await ownAlbum(albumId, userId);
    const result = await pool.query(
      `UPDATE albums SET share_token = replace(uuid_generate_v4()::text, '-', '') WHERE id = $1 RETURNING share_token`,
      [albumId]
    );
    return res.json({ success: true, data: result.rows[0], message: 'Đã tạo link chia sẻ mới, link cũ không còn dùng được.' });
  } catch (error: any) {
    return fail(res, error, 'resetting share link');
  }
};

/** POST /albums/:id/stories {story_id} : put a story into one of my albums. */
export const addStoryToAlbum = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = requireUser(req);
    const albumId = requireAlbumId(req.params.id);
    const storyId = req.body?.story_id;
    if (!isUuid(storyId)) throw new InputError('Truyện không hợp lệ.');
    const album = await ownAlbum(albumId, userId);
    if ((await storyCount(albumId)) >= MAX_STORIES_PER_ALBUM) {
      throw new InputError(`Mỗi album chứa tối đa ${MAX_STORIES_PER_ALBUM} truyện.`);
    }
    await pool.query(
      'INSERT INTO album_stories (album_id, story_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [albumId, storyId]
    );
    await pool.query('UPDATE albums SET updated_at = NOW() WHERE id = $1', [albumId]);
    return res.json({ success: true, action: 'added', message: `Đã lưu vào album "${album.name}".` });
  } catch (error: any) {
    return fail(res, error, 'adding story to album');
  }
};

/** DELETE /albums/:id/stories/:storyId */
export const removeStoryFromAlbum = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = requireUser(req);
    const albumId = requireAlbumId(req.params.id);
    if (!isUuid(req.params.storyId)) throw new InputError('Truyện không hợp lệ.');
    const album = await ownAlbum(albumId, userId);
    await pool.query('DELETE FROM album_stories WHERE album_id = $1 AND story_id = $2', [albumId, req.params.storyId]);
    await pool.query('UPDATE albums SET updated_at = NOW() WHERE id = $1', [albumId]);
    return res.json({ success: true, action: 'removed', message: `Đã bỏ truyện khỏi album "${album.name}".` });
  } catch (error: any) {
    return fail(res, error, 'removing story from album');
  }
};

/** POST /albums/:id/save {key?} : save / unsave someone else's album (toggle). */
export const toggleSaveAlbum = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = requireUser(req);
    const albumId = requireAlbumId(req.params.id);
    const album = await viewableAlbum(albumId, userId, req.body?.key);
    if (album.user_id === userId) throw new InputError('Đây là album của bạn.');

    const removed = await pool.query('DELETE FROM album_saves WHERE user_id = $1 AND album_id = $2 RETURNING 1', [userId, albumId]);
    if (removed.rows.length > 0) {
      return res.json({ success: true, action: 'removed', message: 'Đã bỏ lưu album.' });
    }
    await pool.query(
      'INSERT INTO album_saves (user_id, album_id, share_token) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, albumId, album.is_public ? null : album.share_token]
    );
    return res.json({ success: true, action: 'added', message: 'Đã lưu album vào mục "Album đã lưu".' });
  } catch (error: any) {
    return fail(res, error, 'saving album');
  }
};

/**
 * POST /albums/:id/copy {key?, target_album_id?, name?}
 * Copies the album's stories into one of my albums (target_album_id) or into a new album.
 */
export const copyAlbum = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = requireUser(req);
    const albumId = requireAlbumId(req.params.id);
    const source = await viewableAlbum(albumId, userId, req.body?.key);
    const targetId = req.body?.target_album_id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let target: { id: string; name: string };
      if (targetId) {
        if (!isUuid(targetId)) throw new InputError('Album đích không hợp lệ.');
        if (targetId === albumId) throw new InputError('Không thể sao chép album vào chính nó.');
        target = await ownAlbum(targetId, userId);
      } else {
        if ((await albumCount(userId)) >= MAX_ALBUMS_PER_USER) {
          throw new InputError(`Mỗi tài khoản tạo tối đa ${MAX_ALBUMS_PER_USER} album.`);
        }
        const name = optionalText(req.body?.name, 100, 'Tên album') || source.name;
        const ins = await client.query(
          `INSERT INTO albums (user_id, name, description, copied_from)
           SELECT $1, $2, description, id FROM albums WHERE id = $3
           RETURNING id, name`,
          [userId, name, albumId]
        );
        target = ins.rows[0];
      }

      const room = MAX_STORIES_PER_ALBUM - (await storyCount(target.id));
      const copied = await client.query(
        `INSERT INTO album_stories (album_id, story_id)
         SELECT $1, x.story_id
         FROM album_stories x JOIN stories s ON s.id = x.story_id
         WHERE x.album_id = $2 AND ${VISIBLE_STORY}
           AND NOT EXISTS (SELECT 1 FROM album_stories y WHERE y.album_id = $1 AND y.story_id = x.story_id)
         ORDER BY x.added_at
         LIMIT $3
         ON CONFLICT DO NOTHING
         RETURNING story_id`,
        [target.id, albumId, Math.max(0, room)]
      );
      await client.query('UPDATE albums SET updated_at = NOW() WHERE id = $1', [target.id]);
      await client.query('COMMIT');

      const n = copied.rowCount || 0;
      return res.status(201).json({
        success: true,
        data: { album_id: target.id, album_name: target.name, added: n },
        message: n > 0
          ? `Đã sao chép ${n} truyện vào album "${target.name}".`
          : `Album "${target.name}" đã có đủ các truyện này.`,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    return fail(res, error, 'copying album');
  }
};
