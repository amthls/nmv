import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import type { AuthedRequest } from '../../common/utils/auth';
import * as moderation from './moderation.service';

@Controller('moderation')
export class ModerationController {
  @Get('removed') @UseGuards(AuthGuard)
  removed(@Req() req: AuthedRequest, @Res() res: Response) { return moderation.getRemovedContent(req, res); }
}
