import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from '../../common/guards/auth.guard';
import { StoriesService } from './stories.service';

/** Service-to-service routes about stories (X-Internal-Auth; not under /api/v1). */
@Controller('internal')
@UseGuards(InternalAuthGuard)
export class StoriesInternalController {
  constructor(private readonly stories: StoriesService) {}

  /** GET /internal/permissions?user=&story= (cached 30 s by the workspace). */
  @Get('permissions')
  async permissions(@Query() query: any) {
    const { keeper, contributor, removed, name, role, workflow } = await this.stories.permissions(String(query.user || ''), String(query.story || ''));
    return { success: true, data: { keeper, contributor, removed, name, role, workflow } };
  }

  /** POST /internal/stories/brief {story_ids?, chapter_ids?} (at most 1000 each) -> {stories, chapters}. */
  @Post('stories/brief')
  @HttpCode(200)
  async brief(@Body() body: any) {
    return { success: true, data: await this.stories.brief(body) };
  }

  /** GET /internal/stories/removed?q=&limit= -> {total, rows}: stories taken down by Admin/Mod, for the "Đã gỡ" page. */
  @Get('stories/removed')
  async removed(@Query() query: any) {
    return { success: true, data: await this.stories.removedList(query) };
  }
}
