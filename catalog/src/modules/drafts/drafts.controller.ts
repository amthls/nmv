import { Body, Controller, Param, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { DraftsService, DraftUser, Reply } from './drafts.service';

/** The answer carries its own status (a workspace answer is passed on as it came), so it is set here, not by @HttpCode. */
const send = (res: Response, r: Reply) => {
  res.status(r.status);
  return r.body;
};

/** Chapter drafts under /api/v1/drafts: content passes the HTML filter here; the workspace keeps the draft. */
@Controller('drafts')
@UseGuards(AuthGuard)
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Post()
  async create(@CurrentUser() user: DraftUser, @Body() body: any, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.drafts.create(user, body));
  }

  @Put(':id')
  async save(@Param('id') id: string, @CurrentUser() user: DraftUser, @Body() body: any, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.drafts.save(id, user, body));
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @CurrentUser() user: DraftUser, @Body() body: any, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.drafts.publish(id, user, body));
  }

  @Post(':id/submit')
  async submit(@Param('id') id: string, @CurrentUser() user: DraftUser, @Body() body: any, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.drafts.submit(id, user, body));
  }

  @Post(':id/withdraw')
  async withdraw(@Param('id') id: string, @CurrentUser() user: DraftUser, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.drafts.withdraw(id, user));
  }

  @Post(':id/return')
  async giveBack(@Param('id') id: string, @CurrentUser() user: DraftUser, @Body() body: any, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.drafts.giveBack(id, user, body));
  }

  @Post(':id/share')
  async share(@Param('id') id: string, @CurrentUser() user: DraftUser, @Body() body: any, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.drafts.share(id, user, body));
  }

  @Post(':id/transfer')
  async transfer(@Param('id') id: string, @CurrentUser() user: DraftUser, @Body() body: any, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.drafts.transfer(id, user, body));
  }

  @Post(':id/offer')
  async offer(@Param('id') id: string, @CurrentUser() user: DraftUser, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.drafts.offer(id, user));
  }
}
