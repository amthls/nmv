import { Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InternalAuthGuard } from '../../common/guards/auth.guard';
import * as moderation from '../moderation/moderation.service';

@Controller('internal')
@UseGuards(InternalAuthGuard)
export class InternalController {
  @Get('codes/:kind/:no')
  code(@Req() req: Request, @Res() res: Response) { return moderation.resolveCode(req, res); }

  @Get('users/:id/stats')
  stats(@Req() req: Request, @Res() res: Response) { return moderation.userStats(req, res); }

  @Post('comments/purge') @HttpCode(200)
  purge(@Req() req: Request, @Res() res: Response) { return moderation.purgeStoryComments(req, res); }
}
