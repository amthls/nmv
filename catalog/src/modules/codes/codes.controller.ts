import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalAuthGuard } from '../../common/guards/auth.guard';
import { CodesService } from './codes.service';

@Controller('codes')
export class CodesController {
  constructor(private readonly codes: CodesService) {}

  /** GET /api/v1/codes/:code → { type, path } of the page to open. */
  @Get(':code')
  @UseGuards(OptionalAuthGuard)
  async resolve(@Param('code') code: string, @CurrentUser() user?: { id: string; roles?: string[] }) {
    return { success: true, data: await this.codes.resolve(code, user) };
  }
}
