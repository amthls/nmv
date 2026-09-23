import { Request, Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sanitizeRichText } from '../utils/richText';

function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const getGroups = async (req: Request, res: Response) => {
  try {
    const { q, filter_status, user_id } = req.query;

    const params: any[] = [];
    let conditions = 'WHERE 1=1';

    if (filter_status === 'my_groups') {
      const currentUserId = (req as any).user?.id || user_id || 'a0000000-0000-0000-0000-000000000009';
      params.push(currentUserId);
      conditions += ` AND g.id IN (SELECT group_id FROM group_members WHERE user_id = $${params.length}::uuid)`;
    } else if (filter_status === 'pending') {
      conditions += ` AND g.approval_status = 'pending'`;
    } else {
      conditions += ` AND (g.approval_status = 'approved' OR g.approval_status IS NULL)`;
    }

    if (q && typeof q === 'string' && q.trim()) {
      params.push(`%${q.trim()}%`);
      conditions += ` AND (g.name ILIKE $${params.length} OR g.description ILIKE $${params.length})`;
    }

    const result = await pool.query(`
      SELECT 
        g.*,
        u.username as creator_username,
        u.display_name as creator_name,
        u.avatar_url as creator_avatar,
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
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getGroupBySlug = async (req: Request, res: Response) => {
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

    // Lấy danh sách truyện của nhóm
    const storiesRes = await pool.query(`
      SELECT 
        s.id, s.title, s.slug, s.cover_image_url, s.story_type, s.status,
        s.total_chapters, s.total_views, s.rating_avg, s.rating_count,
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
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createGroup = async (req: Request, res: Response) => {
  try {
    const { 
      name, 
      description, 
      avatar_url, 
      banner_url, 
      website_url, 
      discord_url, 
      rules, 
      user_id 
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Tên nhóm không được để trống' });
    }

    const creatorId = (req as any).user?.id || user_id || 'a0000000-0000-0000-0000-000000000009';

    // Check roles for auto-approval (admin/mod)
    const roleRes = await pool.query(`SELECT role FROM user_roles WHERE user_id = $1`, [creatorId]);
    const roles = roleRes.rows.map(r => r.role);
    const isAdminOrMod = roles.includes('admin') || roles.includes('mod');

    const approvalStatus = isAdminOrMod ? 'approved' : 'pending';

    let baseSlug = slugify(name.trim());
    const uniqueSlug = `${baseSlug}-${Date.now().toString().slice(-4)}`;

    const groupRes = await pool.query(`
      INSERT INTO translation_groups (
        name, slug, description, avatar_url, banner_url, website_url, discord_url, rules, created_by, approval_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING *;
    `, [
      name.trim(),
      uniqueSlug,
      sanitizeRichText(description) || null,
      avatar_url || null,
      banner_url || null,
      website_url?.trim() || null,
      discord_url?.trim() || null,
      sanitizeRichText(rules) || null,
      creatorId,
      approvalStatus
    ]);

    const group = groupRes.rows[0];

    // Automatically add creator as group Leader
    await pool.query(`
      INSERT INTO group_members (group_id, user_id, role)
      VALUES ($1, $2, 'leader'::group_role)
      ON CONFLICT DO NOTHING;
    `, [group.id, creatorId]);

    res.status(201).json({
      success: true,
      message: approvalStatus === 'pending'
        ? 'Tạo nhóm dịch thành công, vui lòng chờ Admin duyệt'
        : 'Tạo nhóm dịch thành công',
      data: group,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateGroup = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, avatar_url, banner_url, website_url, discord_url, rules, user_id } = req.body;

    const currentUserId = (req as any).user?.id || user_id || 'a0000000-0000-0000-0000-000000000009';

    // Verify leader or admin
    const memRes = await pool.query(`
      SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
    `, [id, currentUserId]);

    const roleRes = await pool.query(`SELECT role FROM user_roles WHERE user_id = $1`, [currentUserId]);
    const isSiteAdmin = roleRes.rows.some(r => r.role === 'admin');
    const isGroupLeader = memRes.rows.some(r => r.role === 'leader' || r.role === 'mod');

    if (!isSiteAdmin && !isGroupLeader) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền chỉnh sửa nhóm này' });
    }

    const updateRes = await pool.query(`
      UPDATE translation_groups SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        avatar_url = COALESCE($3, avatar_url),
        banner_url = COALESCE($4, banner_url),
        website_url = COALESCE($5, website_url),
        discord_url = COALESCE($6, discord_url),
        rules = COALESCE($7, rules),
        updated_at = NOW()
      WHERE id = $8
      RETURNING *;
    `, [name, sanitizeRichText(description), avatar_url, banner_url, website_url, discord_url, sanitizeRichText(rules), id]);

    res.json({
      success: true,
      message: 'Cập nhật thông tin nhóm dịch thành công',
      data: updateRes.rows[0],
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const approveGroup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const userRoles = req.user.roles || [];
    if (!userRoles.includes('admin') && !userRoles.includes('mod')) {
      return res.status(403).json({
        success: false,
        message: 'Chỉ Quản trị viên (Admin) hoặc Kiểm duyệt viên (Mod) mới có quyền duyệt nhóm dịch.',
      });
    }

    const { id } = req.params;
    const adminId = req.user.id;

    const updateRes = await pool.query(`
      UPDATE translation_groups SET
        approval_status = 'approved',
        approved_by = $1,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `, [adminId, id]);

    res.json({
      success: true,
      message: 'Đã duyệt nhóm dịch thành công',
      data: updateRes.rows[0],
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const addGroupMember = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { username_or_email, role = 'member', current_user_id } = req.body;

    const requesterId = (req as any).user?.id || current_user_id || 'a0000000-0000-0000-0000-000000000009';

    // Verify requester is leader or mod
    const leaderCheck = await pool.query(`
      SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
    `, [id, requesterId]);

    if (leaderCheck.rows.length === 0 || !['leader', 'mod'].includes(leaderCheck.rows[0].role)) {
      return res.status(403).json({ success: false, message: 'Chỉ Trưởng nhóm hoặc Quản lý mới có quyền thêm thành viên' });
    }

    // Find target user
    const userRes = await pool.query(`
      SELECT id, username, display_name FROM users 
      WHERE username ILIKE $1 OR email ILIKE $1;
    `, [username_or_email.trim()]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng với username/email này' });
    }

    const targetUser = userRes.rows[0];

    // Check valid group role
    const validRoles = ['leader', 'mod', 'translator', 'editor', 'raw_provider', 'proofreader', 'member'];
    const assignedRole = validRoles.includes(role) ? role : 'member';

    await pool.query(`
      INSERT INTO group_members (group_id, user_id, role)
      VALUES ($1, $2, $3::group_role)
      ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role;
    `, [id, targetUser.id, assignedRole]);

    res.json({
      success: true,
      message: `Đã thêm thành viên ${targetUser.display_name || targetUser.username} vào nhóm với vai trò ${assignedRole}`,
      data: { user: targetUser, role: assignedRole },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

async function requireGroupLeaderOrAdmin(req: AuthenticatedRequest, groupId: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!req.user || !req.user.id) {
    return { ok: false, status: 401, message: 'Bạn chưa đăng nhập.' };
  }

  const userRoles = req.user.roles || [];
  if (userRoles.includes('admin')) return { ok: true };

  const leaderCheck = await pool.query(`
    SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
  `, [groupId, req.user.id]);

  if (leaderCheck.rows.length === 0 || !['leader', 'mod'].includes(leaderCheck.rows[0].role)) {
    return { ok: false, status: 403, message: 'Chỉ Trưởng nhóm hoặc Quản lý mới có quyền thực hiện thao tác này' };
  }

  return { ok: true };
}

export const updateGroupMemberRole = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, memberUserId } = req.params;
    const { role } = req.body;

    const permCheck = await requireGroupLeaderOrAdmin(req, id);
    if (!permCheck.ok) {
      return res.status(permCheck.status).json({ success: false, message: permCheck.message });
    }

    const validRoles = ['leader', 'mod', 'translator', 'editor', 'raw_provider', 'proofreader', 'member'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Vai trò không hợp lệ' });
    }

    const targetRes = await pool.query(`
      SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
    `, [id, memberUserId]);
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thành viên không tồn tại trong nhóm' });
    }

    if (targetRes.rows[0].role === 'leader' && role !== 'leader') {
      const leaderCountRes = await pool.query(`
        SELECT COUNT(*)::int as count FROM group_members WHERE group_id = $1 AND role = 'leader'
      `, [id]);
      if (leaderCountRes.rows[0].count <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Không thể hạ cấp Trưởng nhóm duy nhất. Hãy chỉ định một Trưởng nhóm khác trước.',
        });
      }
    }

    await pool.query(`
      UPDATE group_members SET role = $1::group_role WHERE group_id = $2 AND user_id = $3;
    `, [role, id, memberUserId]);

    res.json({
      success: true,
      message: 'Cập nhật vai trò thành viên thành công',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const removeGroupMember = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, memberUserId } = req.params;

    const permCheck = await requireGroupLeaderOrAdmin(req, id);
    if (!permCheck.ok) {
      return res.status(permCheck.status).json({ success: false, message: permCheck.message });
    }

    const targetRes = await pool.query(`
      SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
    `, [id, memberUserId]);
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thành viên không tồn tại trong nhóm' });
    }

    if (targetRes.rows[0].role === 'leader') {
      const leaderCountRes = await pool.query(`
        SELECT COUNT(*)::int as count FROM group_members WHERE group_id = $1 AND role = 'leader'
      `, [id]);
      if (leaderCountRes.rows[0].count <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Không thể xóa Trưởng nhóm duy nhất khỏi nhóm. Hãy chỉ định một Trưởng nhóm khác trước.',
        });
      }
    }

    await pool.query(`
      DELETE FROM group_members WHERE group_id = $1 AND user_id = $2;
    `, [id, memberUserId]);

    res.json({
      success: true,
      message: 'Đã xóa thành viên khỏi nhóm',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getGroupMessages = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT 
        m.*,
        u.username, u.display_name, u.avatar_url,
        gm.role as member_role
      FROM group_messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN group_members gm ON m.group_id = gm.group_id AND m.user_id = gm.user_id
      WHERE m.group_id = $1
      ORDER BY m.created_at ASC
      LIMIT 100;
    `, [id]);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const sendGroupMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const { id } = req.params;
    const { message, attachments = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Nội dung tin nhắn không được để trống' });
    }

    const senderId = req.user.id;
    const userRoles = req.user.roles || [];

    if (!userRoles.includes('admin')) {
      const memCheck = await pool.query(`
        SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2
      `, [id, senderId]);
      if (memCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Chỉ thành viên trong nhóm mới có quyền gửi tin nhắn trong chatroom nội bộ.',
        });
      }
    }

    const insertRes = await pool.query(`
      INSERT INTO group_messages (group_id, user_id, message, attachments)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING *;
    `, [id, senderId, message.trim(), JSON.stringify(attachments || [])]);

    const msg = insertRes.rows[0];

    const userRes = await pool.query(`SELECT username, display_name, avatar_url FROM users WHERE id = $1`, [senderId]);
    msg.username = userRes.rows[0]?.username;
    msg.display_name = userRes.rows[0]?.display_name;
    msg.avatar_url = userRes.rows[0]?.avatar_url;

    res.status(201).json({
      success: true,
      data: msg,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteGroupMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }

    const { id, messageId } = req.params;
    const userRoles = req.user.roles || [];

    const msgRes = await pool.query(`SELECT user_id FROM group_messages WHERE id = $1 AND group_id = $2`, [messageId, id]);
    if (msgRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tin nhắn không tồn tại' });
    }

    const isOwner = msgRes.rows[0].user_id === req.user.id;
    let isLeaderOrMod = false;
    if (!isOwner && !userRoles.includes('admin')) {
      const leaderCheck = await pool.query(`
        SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
      `, [id, req.user.id]);
      isLeaderOrMod = leaderCheck.rows.length > 0 && ['leader', 'mod'].includes(leaderCheck.rows[0].role);
    }

    if (!isOwner && !isLeaderOrMod && !userRoles.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Bạn chỉ có thể xóa tin nhắn của chính mình.',
      });
    }

    await pool.query(`DELETE FROM group_messages WHERE id = $1`, [messageId]);

    res.json({ success: true, message: 'Đã xóa tin nhắn' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
