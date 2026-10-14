import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseFilters, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExposeMessageFilter } from '../../common/filters/http-exception.filter';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Mw } from '../../common/guards/express-middleware.guard';
import { commentLimiter, Viewer } from '../../common/utils/auth';
import { CommentsService } from './comments.service';

@Controller('comments')
@UseFilters(ExposeMessageFilter)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  list(@Query() query: Record<string, any>) { return this.comments.list(query); }

  @Post() @HttpCode(201) @UseGuards(AuthGuard, Mw(commentLimiter))
  create(@CurrentUser() user: Viewer, @Body() body: any) { return this.comments.create(user, body); }

  @Post(':id/like') @HttpCode(200) @UseGuards(AuthGuard)
  like(@CurrentUser() user: Viewer, @Param('id') id: string) { return this.comments.like(user, id); }

  @Put(':id') @UseGuards(AuthGuard)
  update(@CurrentUser() user: Viewer, @Param('id') id: string, @Body() body: any) { return this.comments.update(user, id, body); }

  @Delete(':id') @UseGuards(AuthGuard)
  remove(@CurrentUser() user: Viewer, @Param('id') id: string) { return this.comments.remove(user, id); }
}
