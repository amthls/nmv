import { Body, Controller, Get, HttpCode, Param, Post, Res, UseFilters, UseGuards } from '@nestjs/common';
import fs from 'fs';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { OptionalAuthGuard } from '../../common/guards/auth.guard';
import { Mw } from '../../common/guards/express-middleware.guard';
import { exportLimiter } from '../../common/utils/auth';
import { ExportsService } from './exports.service';

@Controller()
@UseFilters(HttpExceptionFilter)
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post('stories/:slug/exports') @HttpCode(200) @UseGuards(OptionalAuthGuard, Mw(exportLimiter))
  create(@CurrentUser() userId: string | undefined, @Param('slug') slug: string, @Body() body: any) {
    return this.exports.create(userId, slug, body);
  }

  @Get('exports/:id')
  get(@Param('id') id: string) { return this.exports.get(id); }

  /** The file is streamed straight to the response (no serializer), as before. */
  @Get('exports/:id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const file = await this.exports.file(id);
    for (const [name, value] of Object.entries(file.headers)) res.setHeader(name, value);
    const stream = fs.createReadStream(file.filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
