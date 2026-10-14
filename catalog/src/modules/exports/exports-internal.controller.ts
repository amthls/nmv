import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from '../../common/guards/auth.guard';
import { ExportsService } from './exports.service';

/** Service-to-service routes: the workspace's chapter import and the media service's EPUB/PDF source (X-Internal-Auth). */
@Controller('internal')
@UseGuards(InternalAuthGuard)
export class ExportsInternalController {
  constructor(private readonly exports: ExportsService) {}

  /** GET /internal/chapters/export?after=<id>&limit=100 */
  @Get('chapters/export')
  async chapters(@Query() query: any) {
    return { success: true, data: await this.exports.chapters(query) };
  }

  /** POST /internal/exports/source {slug | story_id, chapter_ids: uuid[] | null} */
  @Post('exports/source')
  @HttpCode(200)
  async source(@Body() body: any) {
    return { success: true, data: await this.exports.source(body) };
  }

  /** POST /internal/exports/book {story_id, chapter_ids} */
  @Post('exports/book')
  @HttpCode(200)
  async book(@Body() body: any) {
    return { success: true, data: await this.exports.book(body) };
  }
}
