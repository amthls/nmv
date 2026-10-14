import { Controller, Get, HttpCode, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Mw } from '../../common/guards/express-middleware.guard';
import { reportLimiter } from '../../common/utils/auth';
import type { AuthedRequest } from '../../common/utils/auth';
import * as reports from './reports.service';

@Controller('reports')
export class ReportsController {
  @Post() @HttpCode(200) @UseGuards(AuthGuard, Mw(reportLimiter))
  create(@Req() req: AuthedRequest, @Res() res: Response) { return reports.createReport(req, res); }

  @Get() @UseGuards(AuthGuard)
  list(@Req() req: AuthedRequest, @Res() res: Response) { return reports.getReports(req, res); }

  @Put(':id/resolve') @UseGuards(AuthGuard)
  resolve(@Req() req: AuthedRequest, @Res() res: Response) { return reports.resolveReport(req, res); }
}
