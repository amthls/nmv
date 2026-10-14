import { Controller, Get, HttpException, Param, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from '../../common/guards/auth.guard';
import { GroupsService } from './groups.service';

/** Service-to-service routes about groups (not under /api/v1). */
@Controller('internal/groups')
export class GroupsInternalController {
  constructor(private readonly groups: GroupsService) {}

  /** messaging → catalog: who is in a group (404 {success:false} when it does not exist). */
  @Get(':id/members')
  @UseGuards(InternalAuthGuard)
  async members(@Param('id') id: string) {
    const rows = await this.groups.membersForChat(id);
    if (!rows) throw new HttpException({ success: false }, 404);
    return { success: true, data: rows };
  }
}
