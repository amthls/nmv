import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseFilters, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExposeMessageFilter } from '../../common/filters/http-exception.filter';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Mw } from '../../common/guards/express-middleware.guard';
import { reportLimiter, Viewer } from '../../common/utils/auth';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseFilters(ExposeMessageFilter)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post() @HttpCode(201) @UseGuards(AuthGuard, Mw(reportLimiter))
  create(@CurrentUser() user: Viewer, @Body() body: any) { return this.reports.create(user, body); }

  @Get() @UseGuards(AuthGuard)
  list(@CurrentUser() user: Viewer, @Query() query: Record<string, any>) { return this.reports.list(user, query); }

  @Put(':id/resolve') @UseGuards(AuthGuard)
  resolve(@CurrentUser() user: Viewer, @Param('id') id: string, @Body() body: any) { return this.reports.resolve(user, id, body); }
}
