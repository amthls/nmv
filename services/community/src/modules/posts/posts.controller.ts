import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseFilters, UseGuards } from '@nestjs/common';
import { ClientDbErrorFilter } from '../../common/filters/http-exception.filter';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard, OptionalAuthGuard } from '../../common/guards/auth.guard';
import { Mw } from '../../common/guards/express-middleware.guard';
import { postLimiter, reactLimiter, Viewer } from '../../common/utils/auth';
import { PostsService } from './posts.service';

@Controller('posts')
@UseFilters(ClientDbErrorFilter)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get() @UseGuards(OptionalAuthGuard)
  list(@CurrentUser() user: Viewer | undefined, @Query() query: Record<string, any>) { return this.posts.list(user, query); }

  @Get('sidebar') @UseGuards(OptionalAuthGuard)
  sidebar(@CurrentUser() user: Viewer | undefined) { return this.posts.sidebar(user); }

  @Get(':slug') @UseGuards(OptionalAuthGuard)
  bySlug(@CurrentUser() user: Viewer | undefined, @Param('slug') slug: string) { return this.posts.bySlug(user, slug); }

  @Post() @HttpCode(201) @UseGuards(AuthGuard, Mw(postLimiter))
  create(@CurrentUser() user: Viewer, @Body() body: any) { return this.posts.create(user, body); }

  @Put(':id') @UseGuards(AuthGuard)
  update(@CurrentUser() user: Viewer, @Param('id') id: string, @Body() body: any) { return this.posts.update(user, id, body); }

  @Delete(':id') @UseGuards(AuthGuard)
  remove(@CurrentUser() user: Viewer, @Param('id') id: string) { return this.posts.remove(user, id); }

  @Post(':id/approve') @HttpCode(200) @UseGuards(AuthGuard)
  approve(@CurrentUser() user: Viewer, @Param('id') id: string, @Body() body: any) { return this.posts.review(user, id, body, true); }

  @Post(':id/reject') @HttpCode(200) @UseGuards(AuthGuard)
  reject(@CurrentUser() user: Viewer, @Param('id') id: string, @Body() body: any) { return this.posts.review(user, id, body, false); }

  @Post(':id/react') @HttpCode(200) @UseGuards(AuthGuard, Mw(reactLimiter))
  react(@CurrentUser() user: Viewer, @Param('id') id: string, @Body() body: any) { return this.posts.react(user, id, body); }

  @Post(':id/pin') @HttpCode(200) @UseGuards(AuthGuard)
  pin(@CurrentUser() user: Viewer, @Param('id') id: string) { return this.posts.togglePin(user, id); }

  @Post(':id/mute') @HttpCode(200) @UseGuards(AuthGuard)
  mute(@CurrentUser() user: Viewer, @Param('id') id: string) { return this.posts.toggleMute(user, id); }
}
