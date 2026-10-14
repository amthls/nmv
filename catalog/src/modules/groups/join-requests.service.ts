import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';
import { enqueueNotificationJob } from '../../infra/queue/queue.service';
import { groupJoinRequestNotifications, groupJoinDecisionNotification } from '../../infra/notification/notification.service';
import { InputError, isUuid } from '../../utils/validation';
import { GroupUser, GroupsService } from './groups.service';
import { GroupsRepository } from './groups.repository';

const REJECT_COOLDOWN_HOURS = 24; // after a rejection, wait before asking the same group again

/** A user asks to join; a group leader/mod approves or rejects it. */
@Injectable()
export class JoinRequestsService {
  constructor(
    private readonly repo: GroupsRepository,
    private readonly groups: GroupsService,
    private readonly db: DbService,
  ) {}

  async request(id: string, user: GroupUser, body: any) {
    const userId = user.id;
    if (!isUuid(id)) throw new InputError('Nhóm dịch không tồn tại', 404);

    const rawMessage = typeof body?.message === 'string' ? body.message.trim() : '';
    if (rawMessage.length > 500) throw new InputError('Lời nhắn tối đa 500 ký tự.', 400);
    const message = rawMessage || null;

    const group = await this.repo.groupForRequest(id);
    if (!group) throw new InputError('Nhóm dịch không tồn tại', 404);
    if (group.approval_status !== 'approved') throw new InputError('Nhóm này chưa được duyệt nên chưa nhận thành viên.', 400);

    if (await this.repo.isMember(id, userId)) throw new InputError('Bạn đã là thành viên của nhóm này.', 409);

    if (await this.repo.hasRecentRejection(id, userId, REJECT_COOLDOWN_HOURS)) {
      throw new InputError(`Yêu cầu trước của bạn đã bị từ chối. Vui lòng chờ ${REJECT_COOLDOWN_HOURS} giờ trước khi gửi lại.`, 429);
    }

    let request: any;
    try {
      request = await this.repo.insertRequest(id, userId, message);
    } catch (err: any) {
      if (err.code === '23505') { // uq_group_join_requests_pending
        throw new InputError('Bạn đã gửi yêu cầu, vui lòng chờ trưởng nhóm duyệt.', 409);
      }
      throw err;
    }

    const managerIds = await this.repo.managerIds(id);
    enqueueNotificationJob({
      kind: 'notify',
      items: groupJoinRequestNotifications({
        requestId: request.id, groupId: id, groupName: group.name,
        managerIds,
        requesterId: userId, requesterName: user.display_name || user.username,
        message,
      }),
    }).catch((err) => console.error('[Groups] join request notification failed:', err.message));
    return request;
  }

  async cancelMine(id: string, user: GroupUser) {
    if (!isUuid(id)) throw new InputError('Nhóm dịch không tồn tại', 404);
    if (!(await this.repo.cancelPending(id, user.id))) {
      throw new InputError('Bạn không có yêu cầu nào đang chờ duyệt.', 404);
    }
  }

  async listPending(id: string, user: GroupUser) {
    if (!isUuid(id)) throw new InputError('Nhóm dịch không tồn tại', 404);
    await this.groups.requireManager(id, user);
    return this.repo.pendingRequests(id);
  }

  async review(id: string, requestId: string, user: GroupUser, approve: boolean) {
    if (!isUuid(id) || !isUuid(requestId)) throw new InputError('Yêu cầu không tồn tại', 404);
    await this.groups.requireManager(id, user);

    const request = await this.db.withTransaction(async (tx) => {
      // Lock the row so two managers clicking at once can't both act on it
      const row = await this.repo.lockRequest(tx, requestId, id);
      if (!row) throw new InputError('Yêu cầu không tồn tại', 404);
      if (row.status !== 'pending') throw new InputError('Yêu cầu này đã được xử lý.', 409);
      await this.repo.settleRequest(tx, requestId, approve, user.id);
      if (approve) await this.repo.addMemberIfMissing(tx, id, row.user_id);
      return row;
    });

    enqueueNotificationJob({
      kind: 'notify',
      items: groupJoinDecisionNotification({
        requestId, groupId: id, groupName: request.group_name, requesterId: request.user_id, reviewerId: user.id, approved: approve,
      }),
    }).catch((err) => console.error('[Groups] join decision notification failed:', err.message));
  }
}
