import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard, OptionalAuthGuard } from '../../common/guards/auth.guard';
import { Mw } from '../../common/guards/express-middleware.guard';
import { cacheJson } from '../../middlewares/cache';
import { searchLimiter } from '../../middlewares/security';
import { visitorIdOf } from '../../infra/behavior/behavior-events';
import { StoriesService, StoryUser } from './stories.service';

/**
 * Stories under /api/v1/stories. Static paths come before :slug. Chapters and drafts routes live in their own modules.
 */
@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get()
  @UseGuards(Mw(searchLimiter))
  list(@Query() query: any) {
    return this.stories.explore(query);
  }

  // same answer for everyone: popular queries (and the search-as-you-type suggestions) hit Redis, not Elasticsearch
  @Post()
  @UseGuards(AuthGuard)
  async create(@CurrentUser() user: StoryUser, @Body() body: any) {
    return { success: true, message: 'Đăng bộ truyện mới thành công!', data: await this.stories.create(user, body) };
  }

  @Get('explore')
  @UseGuards(Mw(searchLimiter, cacheJson(30)))
  explore(@Query() query: any) {
    return this.stories.explore(query);
  }

  @Get('trending')
  @UseGuards(Mw(cacheJson(120)))
  async trending() {
    return { success: true, data: await this.stories.trending() };
  }

  @Get('recently-updated')
  @UseGuards(Mw(cacheJson(60)))
  async recentlyUpdated() {
    return { success: true, data: await this.stories.recentlyUpdated() };
  }

  @Get('illustrations')
  @UseGuards(Mw(cacheJson(300)))
  async illustrations() {
    return { success: true, data: await this.stories.featuredIllustrations() };
  }

  @Get('manageable')
  @UseGuards(AuthGuard)
  async manageable(@CurrentUser() user: StoryUser) {
    return { success: true, data: await this.stories.manageable(user) };
  }

  @Get(':slug')
  @UseGuards(OptionalAuthGuard)
  async bySlug(@Param('slug') slug: string, @CurrentUser() user: StoryUser | undefined, @Req() req: Request) {
    return { success: true, data: await this.stories.getBySlug(slug, user, visitorIdOf(req)) };
  }

  @Get(':slug/chapters/:chapterSlug')
  @UseGuards(OptionalAuthGuard)
  async chapter(@Param('slug') slug: string, @Param('chapterSlug') chapterSlug: string, @CurrentUser() user: StoryUser | undefined, @Req() req: Request) {
    return { success: true, data: await this.stories.getChapter(slug, chapterSlug, user, visitorIdOf(req)) };
  }

  @Put(':id')
  @UseGuards(AuthGuard)
  async update(@Param('id') id: string, @CurrentUser() user: StoryUser, @Body() body: any) {
    return { success: true, message: 'Cập nhật thông tin truyện thành công!', data: await this.stories.update(id, user, body) };
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  async delete(@Param('id') id: string, @CurrentUser() user: StoryUser) {
    const title = await this.stories.remove(id, user);
    return { success: true, message: `Đã xóa truyện "${title}" thành công!` };
  }

  // Admin/Mod take a story down (soft) or restore it; listed at GET /moderation/removed
  @Post(':id/remove')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async takeDown(@Param('id') id: string, @CurrentUser() user: StoryUser, @Body() body: any) {
    return { success: true, message: await this.stories.setRemoved(id, true, user, body) };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async restore(@Param('id') id: string, @CurrentUser() user: StoryUser, @Body() body: any) {
    return { success: true, message: await this.stories.setRemoved(id, false, user, body) };
  }

  @Get(':id/collaborators')
  async collaborators(@Param('id') id: string) {
    return { success: true, data: await this.stories.collaborators(id) };
  }

  @Post(':id/collaborators')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async addCollaborator(@Param('id') id: string, @CurrentUser() user: StoryUser, @Body() body: any) {
    const { target, role } = await this.stories.addCollaborator(id, user, body);
    return {
      success: true,
      message: `Đã thêm ${target.display_name || target.username} làm cộng tác viên quản lý truyện thành công!`,
      data: { user_id: target.id, username: target.username, role },
    };
  }

  @Delete(':id/collaborators/:userId')
  @UseGuards(AuthGuard)
  async removeCollaborator(@Param('id') id: string, @Param('userId') userId: string, @CurrentUser() user: StoryUser) {
    await this.stories.removeCollaborator(id, userId, user);
    return { success: true, message: 'Đã xóa quyền cộng tác viên quản lý truyện thành công!' };
  }
}
