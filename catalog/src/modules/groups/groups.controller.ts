import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard, OptionalAuthGuard } from '../../common/guards/auth.guard';
import { Mw } from '../../common/guards/express-middleware.guard';
import { perUserLimiter } from '../../middlewares/security';
import { GroupUser, GroupsService } from './groups.service';
import { JoinRequestsService } from './join-requests.service';

const joinRequestLimiter = perUserLimiter({ windowMs: 60 * 60_000, limit: 10, message: 'Bạn gửi quá nhiều yêu cầu gia nhập. Vui lòng thử lại sau.' });

/** Translation groups under /api/v1/groups. */
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService, private readonly joins: JoinRequestsService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  list(@Query() query: any, @CurrentUser() user?: GroupUser) {
    return this.groups.list(query, user);
  }

  @Get(':slug')
  @UseGuards(OptionalAuthGuard)
  async bySlug(@Param('slug') slug: string, @CurrentUser() user?: GroupUser) {
    return { success: true, data: await this.groups.getBySlug(slug, user) };
  }

  @Post()
  @UseGuards(AuthGuard)
  async create(@CurrentUser() user: GroupUser, @Body() body: any) {
    return { success: true, message: 'Tạo nhóm dịch thành công', data: await this.groups.create(user, body) };
  }

  @Put(':id')
  @UseGuards(AuthGuard)
  async update(@Param('id') id: string, @CurrentUser() user: GroupUser, @Body() body: any) {
    return { success: true, message: 'Cập nhật thông tin nhóm dịch thành công', data: await this.groups.update(id, user, body) };
  }

  @Put(':id/workflow')
  @UseGuards(AuthGuard)
  async workflow(@Param('id') id: string, @CurrentUser() user: GroupUser, @Body() body: any) {
    return { success: true, message: 'Đã lưu quy trình của nhóm.', data: await this.groups.updateWorkflow(id, user, body) };
  }

  @Post(':id/members')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async addMember(@Param('id') id: string, @CurrentUser() user: GroupUser, @Body() body: any) {
    const r = await this.groups.addMember(id, user, body);
    return { success: true, message: r.message, data: r.data };
  }

  @Put(':id/members/:memberUserId')
  @UseGuards(AuthGuard)
  async changeRole(@Param('id') id: string, @Param('memberUserId') memberUserId: string, @CurrentUser() user: GroupUser, @Body() body: any) {
    await this.groups.changeMemberRole(id, memberUserId, user, body);
    return { success: true, message: 'Cập nhật vai trò thành viên thành công' };
  }

  @Delete(':id/members/:memberUserId')
  @UseGuards(AuthGuard)
  async removeMember(@Param('id') id: string, @Param('memberUserId') memberUserId: string, @CurrentUser() user: GroupUser) {
    const isSelf = await this.groups.removeMember(id, memberUserId, user);
    return { success: true, message: isSelf ? 'Bạn đã rời nhóm' : 'Đã xóa thành viên khỏi nhóm' };
  }

  // Join requests: user asks, group leader/mod (or admin) approves or rejects
  @Post(':id/join-requests')
  @UseGuards(AuthGuard, Mw(joinRequestLimiter))
  async requestJoin(@Param('id') id: string, @CurrentUser() user: GroupUser, @Body() body: any) {
    return {
      success: true,
      message: 'Đã gửi yêu cầu gia nhập. Vui lòng chờ trưởng nhóm duyệt.',
      data: await this.joins.request(id, user, body),
    };
  }

  @Delete(':id/join-requests/me')
  @UseGuards(AuthGuard)
  async cancelMine(@Param('id') id: string, @CurrentUser() user: GroupUser) {
    await this.joins.cancelMine(id, user);
    return { success: true, message: 'Đã hủy yêu cầu gia nhập.' };
  }

  @Get(':id/join-requests')
  @UseGuards(AuthGuard)
  async pending(@Param('id') id: string, @CurrentUser() user: GroupUser) {
    return { success: true, data: await this.joins.listPending(id, user) };
  }

  @Post(':id/join-requests/:requestId/approve')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async approve(@Param('id') id: string, @Param('requestId') requestId: string, @CurrentUser() user: GroupUser) {
    await this.joins.review(id, requestId, user, true);
    return { success: true, message: 'Đã duyệt, thành viên mới đã được thêm vào nhóm.' };
  }

  @Post(':id/join-requests/:requestId/reject')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async reject(@Param('id') id: string, @Param('requestId') requestId: string, @CurrentUser() user: GroupUser) {
    await this.joins.review(id, requestId, user, false);
    return { success: true, message: 'Đã từ chối yêu cầu gia nhập.' };
  }
}
