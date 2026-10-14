import { Injectable } from '@nestjs/common';
import { slugify } from '../../common/utils/slugify';
import { enqueueNotificationJob } from '../../services/queue.service';
import { NotifyItem } from '../../services/notification.service';
import { InputError, isUuid, requiredText } from '../../utils/validation';
import { GROUP_ROLES, MANAGER_ROLES, MERGER_ROLES, WORKFLOW_STEPS, readGroupFields } from './dto/group-input';
import { GroupsRepository } from './groups.repository';

export type GroupUser = { id: string; username: string; display_name?: string; roles?: string[] };
export type GroupActor = { groupRole: string | null; isLeader: boolean; isManager: boolean };

const roleRank = (role: string) => (role === 'leader' ? 3 : role === 'mod' ? 2 : 1);
const notFound = () => new InputError('Nhóm dịch không tồn tại', 404);

/** translation_groups.name is UNIQUE: a race on it answers 409 like the pre-check does. */
function mapNameConflict(error: any): never {
  if (error?.code === '23505' && String(error.constraint || '').includes('name')) {
    throw new InputError('Tên nhóm dịch này đã được sử dụng.', 409);
  }
  throw error;
}

function notify(items: NotifyItem[], what: string) {
  enqueueNotificationJob({ kind: 'notify', items })
    .catch((err) => console.error(`[Groups] ${what} notification failed:`, err.message));
}

/** Translation groups: pages, settings, members and their roles, workflow. */
@Injectable()
export class GroupsService {
  constructor(private readonly repo: GroupsRepository) {}

  /** The signed-in user's role inside this group. Site admin/mod get no extra rights in groups. */
  async actorOf(groupId: string, user?: GroupUser): Promise<GroupActor> {
    const groupRole = user ? await this.repo.roleOf(groupId, user.id) : null;
    return {
      groupRole,
      isLeader: groupRole === 'leader', // full control over the group
      isManager: MANAGER_ROLES.includes(groupRole || ''), // leader or group mod
    };
  }

  async requireManager(groupId: string, user?: GroupUser) {
    if (!user || !user.id) throw new InputError('Bạn chưa đăng nhập.', 401);
    const actor = await this.actorOf(groupId, user);
    if (!actor.isManager) throw new InputError('Chỉ Trưởng nhóm hoặc Quản lý mới có quyền thực hiện thao tác này', 403);
  }

  /**
   * Role changes follow the group hierarchy:
   *  - anyone may step down (lower their own role), never promote themselves;
   *  - a leader may manage everyone except other leaders (co-leaders can't demote each other);
   *  - a group mod may only manage regular members and only hand out regular roles.
   * The "group keeps at least one leader" rule is checked separately.
   */
  private assertCanManageMember(actor: GroupActor, isSelf: boolean, targetRole: string, newRole?: string) {
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

  private async assertNameFree(name: string, exceptGroupId?: string) {
    if (await this.repo.nameTaken(name, exceptGroupId)) throw new InputError('Tên nhóm dịch này đã được sử dụng.', 409);
  }

  async list(query: any, user?: GroupUser) {
    const { q, filter_status } = query;
    // paged (Plan/load-and-layout.md D2): 24 a page, at most 100
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 24));
    const page = Math.max(1, Number(query.page) || 1);

    const params: any[] = [];
    let conditions = 'WHERE 1=1';

    if (filter_status === 'my_groups') {
      if (!user) throw new InputError('Bạn chưa đăng nhập.', 401);
      params.push(user.id);
      conditions += ` AND g.id IN (SELECT group_id FROM group_members WHERE user_id = $${params.length}::uuid)`;
    } else {
      conditions += ` AND (g.approval_status = 'approved' OR g.approval_status IS NULL)`;
    }

    if (q && typeof q === 'string' && q.trim()) {
      params.push(`%${q.trim().slice(0, 100)}%`);
      conditions += ` AND (g.name ILIKE $${params.length} OR g.description ILIKE $${params.length})`;
    }

    const rows = await this.repo.list(conditions, params, limit, (page - 1) * limit);
    const total = Number(rows[0]?.total_count || 0);
    return {
      success: true,
      data: rows.map(({ total_count, ...g }) => g),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasNextPage: page * limit < total },
    };
  }

  async getBySlug(slug: string, viewer?: GroupUser) {
    const group = await this.repo.findBySlug(slug);
    if (!group) throw notFound();
    group.members = await this.repo.members(group.id);
    // Signed-in viewer: do they already have a join request waiting?
    group.my_join_request = null;
    if (viewer?.id) group.my_join_request = await this.repo.pendingRequestOf(group.id, viewer.id);
    group.stories = await this.repo.approvedStories(group.id);
    return group;
  }

  async create(user: GroupUser, body: any) {
    try {
      const creatorId = user.id;
      const fields = readGroupFields(body || {});
      const name = requiredText(body?.name, 100, 'Tên nhóm');
      await this.assertNameFree(name);

      const baseSlug = slugify(name) || 'nhom-dich';
      // Slug: the name, or name-2, name-3... when taken (checked against the database)
      const group = await this.repo.insertGroup(baseSlug, name, fields, creatorId);
      // Automatically add creator as group Leader
      await this.repo.addLeader(group.id, creatorId);
      return group;
    } catch (error) {
      return mapNameConflict(error);
    }
  }

  async update(id: string, user: GroupUser, body: any) {
    try {
      if (!isUuid(id)) throw notFound();
      const actor = await this.actorOf(id, user);
      if (!actor.isManager) throw new InputError('Bạn không có quyền chỉnh sửa nhóm này', 403);

      const fields = readGroupFields(body || {});
      if (body?.name !== undefined && !fields.name) throw new InputError('Tên nhóm không được để trống.');
      if (fields.name) await this.assertNameFree(fields.name, id);

      // Only fields that were sent change; null clears an optional field
      const row = await this.repo.updateFields(id, fields);
      if (!row) throw notFound();
      return row;
    } catch (error) {
      return mapNameConflict(error);
    }
  }

  async addMember(id: string, user: GroupUser, body: any) {
    if (!isUuid(id)) throw notFound();
    const actor = await this.actorOf(id, user);
    if (!actor.isManager) throw new InputError('Chỉ Trưởng nhóm hoặc Quản lý mới có quyền thêm thành viên', 403);

    const usernameOrEmail = requiredText(body?.username_or_email, 255, 'Tên đăng nhập');
    const role = body?.role ?? 'member';
    // A new leader is appointed by changing an existing member's role, not by adding someone
    if (!GROUP_ROLES.includes(role) || role === 'leader') throw new InputError('Vai trò không hợp lệ', 400);
    this.assertCanManageMember(actor, false, 'member', role);

    const targetUser = await this.repo.findUserByUsername(usernameOrEmail);
    if (!targetUser || targetUser.is_banned) throw new InputError('Không tìm thấy người dùng với username/email này', 404);

    const groupName = await this.repo.groupName(id);
    if (groupName === null) throw notFound();

    // Never overwrite an existing member's role here (that silently demoted leaders); use the role endpoint
    const memberId = await this.repo.insertMember(id, targetUser.id, role);
    if (!memberId) throw new InputError(`${targetUser.display_name || targetUser.username} đã là thành viên của nhóm.`, 409);

    // Their open join request (if any) is settled by this
    await this.repo.approvePendingRequest(id, targetUser.id, user.id);

    notify([{
      userId: targetUser.id, type: 'group_member_add',
      title: `Bạn đã được thêm vào nhóm ${groupName}`,
      message: null,
      referenceType: 'group', referenceId: id, senderId: user.id,
      dedupeKey: `group-added:${id}:${targetUser.id}:${memberId}`,
    }], 'member added');

    return {
      message: `Đã thêm thành viên ${targetUser.display_name || targetUser.username} vào nhóm với vai trò ${role}`,
      data: { user: { id: targetUser.id, username: targetUser.username, display_name: targetUser.display_name }, role },
    };
  }

  async changeMemberRole(id: string, memberUserId: string, user: GroupUser, body: any) {
    const { role } = body || {};
    if (!isUuid(id) || !isUuid(memberUserId)) throw new InputError('Thành viên không tồn tại trong nhóm', 404);
    await this.requireManager(id, user);
    if (!GROUP_ROLES.includes(role)) throw new InputError('Vai trò không hợp lệ', 400);

    const targetRole = await this.repo.roleOf(id, memberUserId);
    if (targetRole === null) throw new InputError('Thành viên không tồn tại trong nhóm', 404);

    this.assertCanManageMember(await this.actorOf(id, user), memberUserId === user.id, targetRole, role);

    if (targetRole === 'leader' && role !== 'leader' && (await this.repo.countLeaders(id)) <= 1) {
      throw new InputError('Không thể hạ cấp Trưởng nhóm duy nhất. Hãy chỉ định một Trưởng nhóm khác trước.', 400);
    }
    await this.repo.setRole(id, memberUserId, role);
  }

  /** Remove a member (leader/group mod), or leave the group yourself (any member). */
  async removeMember(id: string, memberUserId: string, user: GroupUser) {
    if (!isUuid(id) || !isUuid(memberUserId)) throw new InputError('Thành viên không tồn tại trong nhóm', 404);
    const isSelf = user.id === memberUserId;
    if (!isSelf) await this.requireManager(id, user);

    const targetRole = await this.repo.roleOf(id, memberUserId);
    if (targetRole === null) throw new InputError('Thành viên không tồn tại trong nhóm', 404);

    if (!isSelf) this.assertCanManageMember(await this.actorOf(id, user), false, targetRole);

    if (targetRole === 'leader' && (await this.repo.countLeaders(id)) <= 1) {
      throw new InputError(isSelf
        ? 'Bạn là Trưởng nhóm duy nhất. Hãy chỉ định một Trưởng nhóm khác trước khi rời nhóm.'
        : 'Không thể xóa Trưởng nhóm duy nhất khỏi nhóm. Hãy chỉ định một Trưởng nhóm khác trước.', 400);
    }
    await this.repo.removeMember(id, memberUserId);
    return isSelf;
  }

  /**
   * PUT /groups/:id/workflow {steps, mergers?}: the steps a chapter of this group goes through before a story keeper merges it
   * (Plan/chapter-workspace.md, stage 4b), kept in the fixed order raw -> translate -> edit -> proofread, and the roles besides
   * the leader that may merge (Plan/catalog.md, I3). Leader/mod only.
   */
  async updateWorkflow(id: string, user: GroupUser, body: any) {
    if (!isUuid(id)) throw notFound();
    const actor = await this.actorOf(id, user);
    if (!actor.isManager) throw new InputError('Chỉ Trưởng nhóm/Mod nhóm đổi được quy trình.', 403);
    const { steps, mergers } = body || {};
    if (!Array.isArray(steps) || steps.some((s) => !WORKFLOW_STEPS.includes(s))) throw new InputError('Bước quy trình không hợp lệ.');
    const ordered = WORKFLOW_STEPS.filter((s) => steps.includes(s));
    if (ordered.length === 0) throw new InputError('Quy trình cần ít nhất một bước trước khi gộp.');
    // who besides the leader merges (the story owner and the leader always do); omitted: unchanged
    if (mergers !== undefined && (!Array.isArray(mergers) || mergers.some((m) => !MERGER_ROLES.includes(m)))) {
      throw new InputError('Vai trò được gộp không hợp lệ.');
    }
    if (mergers !== undefined && !actor.isLeader) throw new InputError('Chỉ Trưởng nhóm đổi được ai được gộp.', 403);
    const row = await this.repo.updateWorkflow(id, ordered, mergers === undefined ? null : MERGER_ROLES.filter((m) => mergers.includes(m)));
    if (!row) throw notFound();
    return { workflow: row.workflow, mergers: row.mergers };
  }

  /** GET /internal/groups/:id/members -> [{user_id, role}] (404 when the group does not exist): who may use the group's chat. */
  async membersForChat(id: string) {
    if (!isUuid(id) || !(await this.repo.groupExists(id))) return null;
    return this.repo.memberIdsAndRoles(id);
  }
}
