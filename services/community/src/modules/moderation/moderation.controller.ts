import { Controller, Get, Query, UseFilters, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExposeMessageFilter } from '../../common/filters/http-exception.filter';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Viewer } from '../../common/utils/auth';
import { ModerationService } from './moderation.service';

@Controller('moderation')
@UseFilters(ExposeMessageFilter)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('removed') @UseGuards(AuthGuard)
  removed(@CurrentUser() user: Viewer, @Query() query: Record<string, any>) { return this.moderation.removed(user, query); }
}
