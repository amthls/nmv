import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { InternalAuthGuard } from '../../common/guards/auth.guard';
import { InternalService } from './internal.service';

@Controller('internal')
@UseGuards(InternalAuthGuard)
export class InternalController {
  constructor(private readonly internal: InternalService) {}

  /** Not found answers 404 with {success:false} and no message, as before. */
  private found(res: Response, result: object | null) {
    if (!result) res.status(404);
    return result ?? { success: false };
  }

  @Get('codes/:kind/:no')
  async code(@Param('kind') kind: string, @Param('no') no: string, @Query() query: Record<string, any>, @Res({ passthrough: true }) res: Response) {
    return this.found(res, await this.internal.resolveCode(kind, no, query));
  }

  @Get('users/:id/stats')
  async stats(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    return this.found(res, await this.internal.userStats(id));
  }

  @Post('comments/purge') @HttpCode(200)
  purge(@Body() body: any) { return this.internal.purgeStoryComments(body); }
}
