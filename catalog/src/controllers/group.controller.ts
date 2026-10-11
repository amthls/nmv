import { Request, Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sanitizeRichText } from '../utils/richText';
import { insertWithUniqueSlug } from '../utils/ids';
import { InputError, isUuid, optionalText, optionalUrl, requiredText } from '../utils/validation';
import { enqueueNotificationJob } from '../services/queue.service';
import { groupJoinRequestNotifications, groupJoinDecisionNotification, NotifyItem } from '../services/notification.service';

function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const GROUP_ROLES = ['leader', 'mod', 'translator', 'editor', 'raw_provider', 'proofreader', 'member'];
const MANAGER_ROLES = ['leader', 'mod'];

function sendError(res: Response, error: any) {
  if (error instanceof InputError) return res.status(error.status).json({ success: false, message: error.message });
  // translation_groups.name is UNIQUE
  if (error?.code === '23505' && String(error.constraint || '').includes('name')) {
    return res.status(409).json({ success: false, message: 'Tên nhóm dịch này đã được sử dụng.' });
  }
  return res.status(500).json({ success: false, message: error.message });
}

function notify(items: NotifyItem[], what: string) {
  enqueueNotificationJob({ kind: 'notify', items })
    .catch((err) => console.error(`[Groups] ${what} notification failed:`, err.message));
}

/** The signed-in user's role inside this group. Site admin/mod get no extra rights in groups. */
async function getGroupActor(req: AuthenticatedRequest, groupId: string) {
  const memRes = req.user
    ? await pool.query(`SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`, [groupId, req.user.id])
    : { rows: [] as any[] };
  const groupRole: string | null = memRes.rows[0]?.role ?? null;
  return {
    groupRole,
    isLeader: groupRole === 'leader', // full control over the group
    isManager: MANAGER_ROLES.includes(groupRole || ''), // leader or group mod
  };
}

async function requireGroupManager(req: AuthenticatedRequest, groupId: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!req.user || !req.user.id) {
    return { ok: false, status: 401, message: 'Bạn chưa đăng nhập.' };
  }
  const actor = await getGroupActor(req, groupId);
  if (!actor.isManager) {
    return { ok: false, status: 403, message: 'Chỉ Trưởng nhóm hoặc Quản lý mới có quyền thực hiện thao tác này' };
  }
  return { ok: true };
}

const roleRank = (role: string) => (role === 'leader' ? 3 : role === 'mod' ? 2 : 1);

/**
 * Role changes follow the group hierarchy:
 *  - anyone may step down (lower their own role), never promote themselves;
 *  - a leader may manage everyone except other leaders (co-leaders can't demote each other);
 *  - a group mod may only manage regular members and only hand out regular roles.
 * The "group keeps at least one leader" rule is checked separately.
 */
function assertCanManageMember(
  actor: Awaited<ReturnType<typeof getGroupActor>>,
  isSelf: boolean,
  targetRole: string,
  newRole?: string
) {
  if (isSelf) {
    if (newRole && roleRank(newRole) > roleRank(targetRole)) {
      throw new InputError('Bạn không thể tự nâng quyền của mình.', 403);
    }
    return;
  }
  if (targetRole === 'leader') {
    throw new InputError('Chỉ chính Trưởng nhóm đó mới thay đổi được vai trò của mình.', 403);
  }
  if (actor.groupRole === 'leader') return;
  if (MANAGER_ROLES.includes(targetRole)) {
    throw new InputError('Chỉ Trưởng nhóm mới có quyền thay đổi Trưởng nhóm hoặc Quản lý khác.', 403);
  }
  if (newRole && MANAGER_ROLES.includes(newRole)) {
    throw new InputError('Chỉ Trưởng nhóm mới có quyền bổ nhiệm Trưởng nhóm hoặc Quản lý.', 403);
  }
}

async function countLeaders(groupId: string): Promise<number> {
  const r = await pool.query(`SELECT COUNT(*)::int AS count FROM group_members WHERE group_id = $1 AND role = 'leader'`, [groupId]);
  return r.rows[0].count;
}

/** Group text/link fields shared by create and update (undefined = not sent, null = clear). */
function readGroupFields(body: any) {
  const name = optionalText(body.name, 100, 'Tên nhóm');
  return {
    name,
    description: body.description === undefined ? undefined : sanitizeRichText(body.description) || null,
    rules: body.rules === undefined ? undefined : sanitizeRichText(body.rules) || null,
    avatar_url: optionalUrl(body.avatar_url, 'Ảnh đại diện nhóm'),
    banner_url: optionalUrl(body.banner_url, 'Ảnh bìa nhóm'),
    // Rendered as clickable links: only http(s) is allowed (blocks javascript: URLs)
    website_url: optionalUrl(body.website_url, 'Website'),
    discord_url: optionalUrl(body.discord_url, 'Discord'),
  };
}

async function assertGroupNameFree(name: string, exceptGroupId?: string) {
  const r = await pool.query(
    `SELECT 1 FROM translation_groups WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [name, exceptGroupId ?? null]
  );
  if (r.rows.length > 0) throw new InputError('Tên nhóm dịch này đã được sử dụng.', 409);
}

export const getGroups = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { q, filter_status } = req.query;

    const params: any[] = [];
    let conditions = 'WHERE 1=1';

    if (filter_status === 'my_groups') {
      if (!req.user) return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
      params.push(req.user.id);
      conditions += ` AND g.id IN (SELECT group_id FROM group_members WHERE user_id = $${params.length}::uuid)`;
    } else {
      conditions += ` AND (g.approval_status = 'approved' OR g.approval_status IS NULL)`;
    }

    if (q && typeof q === 'string' && q.trim()) {
      params.push(`%${q.trim().slice(0, 100)}%`);
      conditions += ` AND (g.name ILIKE $${params.length} OR g.description ILIKE $${params.length})`;
    }

    const result = await pool.query(`
      SELECT
        g.*,
        u.username as creator_username,
        u.display_name as creator_name,
        u.avatar_url as creator_avatar,
        (
          SELECT json_build_object('username', lu.username, 'display_name', lu.display_name)
          FROM group_members lm JOIN users lu ON lu.id = lm.user_id
          WHERE lm.group_id = g.id AND lm.role = 'leader'
          ORDER BY lm.joined_at ASC LIMIT 1
        ) as leader,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
        (SELECT COUNT(*) FROM stories WHERE group_id = g.id AND approval_status = 'approved') as story_count,
        (
          SELECT json_agg(
            json_build_object(
              'user_id', gm.user_id,
              'username', mu.username,
              'display_name', mu.display_name,
              'avatar_url', mu.avatar_url,
              'role', gm.role
            )
          )
          FROM group_members gm
          JOIN users mu ON gm.user_id = mu.id
          WHERE gm.group_id = g.id
        ) as members
      FROM translation_groups g
      JOIN users u ON g.created_by = u.id
      ${conditions}
      ORDER BY g.created_at DESC;
    `, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const getGroupBySlug = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(`
      SELECT
        g.*,
        u.username as creator_username,
        u.display_name as creator_name,
        u.avatar_url as creator_avatar
      FROM translation_groups g
      JOIN users u ON g.created_by = u.id
      WHERE g.slug = $1;
    `, [slug]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });
    }

    const group = result.rows[0];

    // Lấy thành viên
    const membersRes = await pool.query(`
      SELECT
        gm.id, gm.role, gm.joined_at,
        u.id as user_id, u.username, u.display_name, u.avatar_url
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
      ORDER BY
        CASE gm.role
          WHEN 'leader' THEN 1
          WHEN 'mod' THEN 2
          WHEN 'translator' THEN 3
          WHEN 'editor' THEN 4
          ELSE 5
        END ASC, gm.joined_at ASC;
    `, [group.id]);

    group.members = membersRes.rows;

    const viewerId = req.user?.id;

    // Signed-in viewer: do they already have a join request waiting?
    group.my_join_request = null;
    if (viewerId) {
      const myReq = await pool.query(`
        SELECT id, status, created_at FROM group_join_requests
        WHERE group_id = $1 AND user_id = $2 AND status = 'pending'
      `, [group.id, viewerId]);
      group.my_join_request = myReq.rows[0] || null;
    }

    // Lấy danh sách truyện của nhóm
    const storiesRes = await pool.query(`
      SELECT
        s.id, s.title, s.slug, s.cover_image_url, s.story_type, s.status,
        s.total_chapters, s.total_views,
        s.last_chapter_at, s.author_name
      FROM stories s
      WHERE s.group_id = $1 AND s.approval_status = 'approved'
      ORDER BY s.last_chapter_at DESC NULLS LAST, s.created_at DESC;
    `, [group.id]);

    group.stories = storiesRes.rows;

    res.json({
      success: true,
      data: group,
    });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const createGroup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const creatorId = req.user!.id;
    const fields = readGroupFields(req.body || {});
    const name = requiredText(req.body?.name, 100, 'Tên nhóm');
    await assertGroupNameFree(name);

    const baseSlug = slugify(name) || 'nhom-dich';

    // Slug: the name, or name-2, name-3... when taken (checked against the database)
    const groupRes = await insertWithUniqueSlug(pool, 'translation_groups', baseSlug, (uniqueSlug) => pool.query(`
      INSERT INTO translation_groups (
        name, slug, description, avatar_url, banner_url, website_url, discord_url, rules, created_by, approval_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved'
      ) RETURNING *;
    `, [
      name,
      uniqueSlug,
      fields.description ?? null,
      fields.avatar_url ?? null,
      fields.banner_url ?? null,
      fields.website_url ?? null,
      fields.discord_url ?? null,
      fields.rules ?? null,
      creatorId,
    ]));

    const group = groupRes.rows[0];

    // Automatically add creator as group Leader
    await pool.query(`
      INSERT INTO group_members (group_id, user_id, role)
      VALUES ($1, $2, 'leader'::group_role)
      ON CONFLICT DO NOTHING;
    `, [group.id, creatorId]);

    res.status(201).json({
      success: true,
      message: 'Tạo nhóm dịch thành công',
      data: group,
    });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const updateGroup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });

    const actor = await getGroupActor(req, id);
    if (!actor.isManager) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền chỉnh sửa nhóm này' });
    }

    const fields = readGroupFields(req.body || {});
    if (req.body?.name !== undefined && !fields.name) throw new InputError('Tên nhóm không được để trống.');
    if (fields.name) await assertGroupNameFree(fields.name, id);

    // Only fields that were sent change; null clears an optional field
    const sets: string[] = [];
    const params: any[] = [];
    for (const [column, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    sets.push('updated_at = NOW()');
    params.push(id);

    const updateRes = await pool.query(`
      UPDATE translation_groups SET ${sets.join(', ')}
      WHERE id = $${params.length}
      RETURNING *;
    `, params);
    if (updateRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });
    }

    res.json({
      success: true,
      message: 'Cập nhật thông tin nhóm dịch thành công',
      data: updateRes.rows[0],
    });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const addGroupMember = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });

    const actor = await getGroupActor(req, id);
    if (!actor.isManager) {
      return res.status(403).json({ success: false, message: 'Chỉ Trưởng nhóm hoặc Quản lý mới có quyền thêm thành viên' });
    }

    const usernameOrEmail = requiredText(req.body?.username_or_email, 255, 'Tên đăng nhập');
    const role = req.body?.role ?? 'member';
    // A new leader is appointed by changing an existing member's role, not by adding someone
    if (!GROUP_ROLES.includes(role) || role === 'leader') {
      return res.status(400).json({ success: false, message: 'Vai trò không hợp lệ' });
    }
    assertCanManageMember(actor, false, 'member', role);

    // Exact (case-insensitive) match: no LIKE wildcards, so "%" can't pick a random user
    const userRes = await pool.query(`
      SELECT id, username, display_name, is_banned FROM users
      WHERE lower(username) = lower($1)
      LIMIT 1;
    `, [usernameOrEmail]);

    const targetUser = userRes.rows[0];
    if (!targetUser || targetUser.is_banned) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng với username/email này' });
    }

    const groupRes = await pool.query(`SELECT name FROM translation_groups WHERE id = $1`, [id]);
    if (groupRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });

    // Never overwrite an existing member's role here (that silently demoted leaders); use the role endpoint
    const insertRes = await pool.query(`
      INSERT INTO group_members (group_id, user_id, role)
      VALUES ($1, $2, $3::group_role)
      ON CONFLICT (group_id, user_id) DO NOTHING
      RETURNING id;
    `, [id, targetUser.id, role]);
    if (insertRes.rows.length === 0) {
      return res.status(409).json({ success: false, message: `${targetUser.display_name || targetUser.username} đã là thành viên của nhóm.` });
    }

    // Their open join request (if any) is settled by this
    await pool.query(`
      UPDATE group_join_requests SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
      WHERE group_id = $2 AND user_id = $3 AND status = 'pending'
    `, [req.user!.id, id, targetUser.id]);

    notify([{
      userId: targetUser.id, type: 'group_member_add',
      title: `Bạn đã được thêm vào nhóm ${groupRes.rows[0].name}`,
      message: null,
      referenceType: 'group', referenceId: id, senderId: req.user!.id,
      dedupeKey: `group-added:${id}:${targetUser.id}:${insertRes.rows[0].id}`,
    }], 'member added');

    res.json({
      success: true,
      message: `Đã thêm thành viên ${targetUser.display_name || targetUser.username} vào nhóm với vai trò ${role}`,
      data: { user: { id: targetUser.id, username: targetUser.username, display_name: targetUser.display_name }, role },
    });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const updateGroupMemberRole = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, memberUserId } = req.params;
    const { role } = req.body || {};
    if (!isUuid(id) || !isUuid(memberUserId)) {
      return res.status(404).json({ success: false, message: 'Thành viên không tồn tại trong nhóm' });
    }

    const permCheck = await requireGroupManager(req, id);
    if (!permCheck.ok) {
      return res.status(permCheck.status).json({ success: false, message: permCheck.message });
    }

    if (!GROUP_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'Vai trò không hợp lệ' });
    }

    const targetRes = await pool.query(`
      SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
    `, [id, memberUserId]);
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thành viên không tồn tại trong nhóm' });
    }

    assertCanManageMember(await getGroupActor(req, id), memberUserId === req.user!.id, targetRes.rows[0].role, role);

    if (targetRes.rows[0].role === 'leader' && role !== 'leader' && (await countLeaders(id)) <= 1) {
      return res.status(400).json({
        success: false,
        message: 'Không thể hạ cấp Trưởng nhóm duy nhất. Hãy chỉ định một Trưởng nhóm khác trước.',
      });
    }

    await pool.query(`
      UPDATE group_members SET role = $1::group_role WHERE group_id = $2 AND user_id = $3;
    `, [role, id, memberUserId]);

    res.json({
      success: true,
      message: 'Cập nhật vai trò thành viên thành công',
    });
  } catch (error: any) {
    sendError(res, error);
  }
};

/** Remove a member (leader/group mod), or leave the group yourself (any member). */
export const removeGroupMember = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, memberUserId } = req.params;
    if (!isUuid(id) || !isUuid(memberUserId)) {
      return res.status(404).json({ success: false, message: 'Thành viên không tồn tại trong nhóm' });
    }

    const isSelf = req.user!.id === memberUserId;
    if (!isSelf) {
      const permCheck = await requireGroupManager(req, id);
      if (!permCheck.ok) {
        return res.status(permCheck.status).json({ success: false, message: permCheck.message });
      }
    }

    const targetRes = await pool.query(`
      SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
    `, [id, memberUserId]);
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thành viên không tồn tại trong nhóm' });
    }

    if (!isSelf) assertCanManageMember(await getGroupActor(req, id), false, targetRes.rows[0].role);

    if (targetRes.rows[0].role === 'leader' && (await countLeaders(id)) <= 1) {
      return res.status(400).json({
        success: false,
        message: isSelf
          ? 'Bạn là Trưởng nhóm duy nhất. Hãy chỉ định một Trưởng nhóm khác trước khi rời nhóm.'
          : 'Không thể xóa Trưởng nhóm duy nhất khỏi nhóm. Hãy chỉ định một Trưởng nhóm khác trước.',
      });
    }

    await pool.query(`
      DELETE FROM group_members WHERE group_id = $1 AND user_id = $2;
    `, [id, memberUserId]);

    res.json({
      success: true,
      message: isSelf ? 'Bạn đã rời nhóm' : 'Đã xóa thành viên khỏi nhóm',
    });
  } catch (error: any) {
    sendError(res, error);
  }
};

/** Internal chat: members only. Returns the latest 100 messages, oldest first. */
// ---------------------------------------------------------------- join requests
// A user asks to join; a group leader/mod approves or rejects it.

const REJECT_COOLDOWN_HOURS = 24; // after a rejection, wait before asking the same group again

export const requestToJoinGroup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });

    const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (rawMessage.length > 500) {
      return res.status(400).json({ success: false, message: 'Lời nhắn tối đa 500 ký tự.' });
    }
    const message = rawMessage || null;

    const groupRes = await pool.query(`SELECT id, name, approval_status FROM translation_groups WHERE id = $1`, [id]);
    const group = groupRes.rows[0];
    if (!group) return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });
    if (group.approval_status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Nhóm này chưa được duyệt nên chưa nhận thành viên.' });
    }

    const memberRes = await pool.query(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [id, userId]);
    if (memberRes.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Bạn đã là thành viên của nhóm này.' });
    }

    const recentReject = await pool.query(`
      SELECT 1 FROM group_join_requests
      WHERE group_id = $1 AND user_id = $2 AND status = 'rejected'
        AND reviewed_at > NOW() - make_interval(hours => $3)
    `, [id, userId, REJECT_COOLDOWN_HOURS]);
    if (recentReject.rows.length > 0) {
      return res.status(429).json({
        success: false,
        message: `Yêu cầu trước của bạn đã bị từ chối. Vui lòng chờ ${REJECT_COOLDOWN_HOURS} giờ trước khi gửi lại.`,
      });
    }

    let request: any;
    try {
      const insertRes = await pool.query(`
        INSERT INTO group_join_requests (group_id, user_id, message)
        VALUES ($1, $2, $3)
        RETURNING id, status, created_at
      `, [id, userId, message]);
      request = insertRes.rows[0];
    } catch (err: any) {
      if (err.code === '23505') { // uq_group_join_requests_pending
        return res.status(409).json({ success: false, message: 'Bạn đã gửi yêu cầu, vui lòng chờ trưởng nhóm duyệt.' });
      }
      throw err;
    }

    const managersRes = await pool.query(`
      SELECT user_id FROM group_members WHERE group_id = $1 AND role IN ('leader', 'mod')
    `, [id]);
    enqueueNotificationJob({
      kind: 'notify',
      items: groupJoinRequestNotifications({
        requestId: request.id, groupId: id, groupName: group.name,
        managerIds: managersRes.rows.map((r) => r.user_id),
        requesterId: userId, requesterName: req.user!.display_name || req.user!.username,
        message,
      }),
    }).catch((err) => console.error('[Groups] join request notification failed:', err.message));

    res.status(201).json({
      success: true,
      message: 'Đã gửi yêu cầu gia nhập. Vui lòng chờ trưởng nhóm duyệt.',
      data: request,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cancelMyJoinRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });

    const delRes = await pool.query(`
      DELETE FROM group_join_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'
    `, [id, req.user!.id]);
    if (!delRes.rowCount) {
      return res.status(404).json({ success: false, message: 'Bạn không có yêu cầu nào đang chờ duyệt.' });
    }
    res.json({ success: true, message: 'Đã hủy yêu cầu gia nhập.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getGroupJoinRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });

    const permCheck = await requireGroupManager(req, id);
    if (!permCheck.ok) {
      return res.status(permCheck.status).json({ success: false, message: permCheck.message });
    }

    const result = await pool.query(`
      SELECT
        r.id, r.message, r.status, r.created_at,
        u.id as user_id, u.username, u.display_name, u.avatar_url
      FROM group_join_requests r
      JOIN users u ON r.user_id = u.id
      WHERE r.group_id = $1 AND r.status = 'pending'
      ORDER BY r.created_at ASC
      LIMIT 200;
    `, [id]);

    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

async function reviewJoinRequest(req: AuthenticatedRequest, res: Response, approve: boolean) {
  const { id, requestId } = req.params;
  if (!isUuid(id) || !isUuid(requestId)) {
    return res.status(404).json({ success: false, message: 'Yêu cầu không tồn tại' });
  }

  const permCheck = await requireGroupManager(req, id);
  if (!permCheck.ok) {
    return res.status(permCheck.status).json({ success: false, message: permCheck.message });
  }

  const client = await pool.connect();
  let request: any;
  let groupName = '';
  try {
    await client.query('BEGIN');
    // Lock the row so two managers clicking at once can't both act on it
    const reqRes = await client.query(`
      SELECT r.id, r.user_id, r.status, g.name as group_name
      FROM group_join_requests r
      JOIN translation_groups g ON g.id = r.group_id
      WHERE r.id = $1 AND r.group_id = $2
      FOR UPDATE OF r
    `, [requestId, id]);
    request = reqRes.rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Yêu cầu không tồn tại' });
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Yêu cầu này đã được xử lý.' });
    }
    groupName = request.group_name;

    await client.query(`
      UPDATE group_join_requests
      SET status = $1::approval_status, reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $3
    `, [approve ? 'approved' : 'rejected', req.user!.id, requestId]);

    if (approve) {
      await client.query(`
        INSERT INTO group_members (group_id, user_id, role)
        VALUES ($1, $2, 'member')
        ON CONFLICT (group_id, user_id) DO NOTHING
      `, [id, request.user_id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  enqueueNotificationJob({
    kind: 'notify',
    items: groupJoinDecisionNotification({
      requestId, groupId: id, groupName, requesterId: request.user_id, reviewerId: req.user!.id, approved: approve,
    }),
  }).catch((err) => console.error('[Groups] join decision notification failed:', err.message));

  res.json({
    success: true,
    message: approve ? 'Đã duyệt, thành viên mới đã được thêm vào nhóm.' : 'Đã từ chối yêu cầu gia nhập.',
  });
}

export const approveJoinRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    await reviewJoinRequest(req, res, true);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectJoinRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    await reviewJoinRequest(req, res, false);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const WORKFLOW_STEPS = ['raw', 'translate', 'edit', 'proofread'];
const MERGER_ROLES = ['mod', 'translator', 'editor', 'raw_provider', 'proofreader', 'member']; // CHECK in migration 028

/**
 * PUT /groups/:id/workflow {steps, mergers?}: the steps a chapter of this group goes through before a story keeper merges it
 * (Plan/chapter-workspace.md, stage 4b), kept in the fixed order raw -> translate -> edit -> proofread, and the roles besides
 * the leader that may merge (Plan/catalog.md, I3). Leader/mod only.
 */
export const updateGroupWorkflow = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });
    const actor = await getGroupActor(req, id);
    if (!actor.isManager) return res.status(403).json({ success: false, message: 'Chỉ Trưởng nhóm/Mod nhóm đổi được quy trình.' });
    const { steps, mergers } = req.body || {};
    if (!Array.isArray(steps) || steps.some((s) => !WORKFLOW_STEPS.includes(s))) throw new InputError('Bước quy trình không hợp lệ.');
    const ordered = WORKFLOW_STEPS.filter((s) => steps.includes(s));
    if (ordered.length === 0) throw new InputError('Quy trình cần ít nhất một bước trước khi gộp.');
    // who besides the leader merges (the story owner and the leader always do); omitted: unchanged
    if (mergers !== undefined && (!Array.isArray(mergers) || mergers.some((m) => !MERGER_ROLES.includes(m)))) {
      throw new InputError('Vai trò được gộp không hợp lệ.');
    }
    if (mergers !== undefined && !actor.isLeader) {
      return res.status(403).json({ success: false, message: 'Chỉ Trưởng nhóm đổi được ai được gộp.' });
    }
    const r = await pool.query(
      `UPDATE translation_groups SET workflow = $1, mergers = COALESCE($3, mergers), updated_at = NOW() WHERE id = $2 RETURNING workflow, mergers`,
      [ordered, id, mergers === undefined ? null : MERGER_ROLES.filter((m) => mergers.includes(m))],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Nhóm dịch không tồn tại' });
    res.json({ success: true, message: 'Đã lưu quy trình của nhóm.', data: { workflow: r.rows[0].workflow, mergers: r.rows[0].mergers } });
  } catch (error: any) {
    sendError(res, error);
  }
};
