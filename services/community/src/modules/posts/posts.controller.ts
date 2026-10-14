import { Controller, Delete, Get, HttpCode, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, OptionalAuthGuard } from '../../common/guards/auth.guard';
import { Mw } from '../../common/guards/express-middleware.guard';
import { postLimiter, reactLimiter } from '../../common/utils/auth';
import type { AuthedRequest } from '../../common/utils/auth';
import * as posts from './posts.service';

/** Every handler answers through `res` (status and JSON as before), (@HttpCode(200) only sets the default of POST: handlers that send 201 set it themselves). */
@Controller('posts')
export class PostsController {
  @Get() @UseGuards(OptionalAuthGuard)
  list(@Req() req: AuthedRequest, @Res() res: Response) { return posts.getPosts(req, res); }

  @Get('sidebar') @UseGuards(OptionalAuthGuard)
  sidebar(@Req() req: AuthedRequest, @Res() res: Response) { return posts.getFandomSidebar(req, res); }

  @Get(':slug') @UseGuards(OptionalAuthGuard)
  bySlug(@Req() req: AuthedRequest, @Res() res: Response) { return posts.getPostBySlug(req, res); }

  @Post() @HttpCode(200) @UseGuards(AuthGuard, Mw(postLimiter))
  create(@Req() req: AuthedRequest, @Res() res: Response) { return posts.createPost(req, res); }

  @Put(':id') @UseGuards(AuthGuard)
  update(@Req() req: AuthedRequest, @Res() res: Response) { return posts.updatePost(req, res); }

  @Delete(':id') @UseGuards(AuthGuard)
  remove(@Req() req: AuthedRequest, @Res() res: Response) { return posts.deletePost(req, res); }

  @Post(':id/approve') @HttpCode(200) @UseGuards(AuthGuard)
  approve(@Req() req: AuthedRequest, @Res() res: Response) { return posts.approvePost(req, res); }

  @Post(':id/reject') @HttpCode(200) @UseGuards(AuthGuard)
  reject(@Req() req: AuthedRequest, @Res() res: Response) { return posts.rejectPost(req, res); }

  @Post(':id/react') @HttpCode(200) @UseGuards(AuthGuard, Mw(reactLimiter))
  react(@Req() req: AuthedRequest, @Res() res: Response) { return posts.reactToPost(req, res); }

  @Post(':id/pin') @HttpCode(200) @UseGuards(AuthGuard)
  pin(@Req() req: AuthedRequest, @Res() res: Response) { return posts.togglePinPost(req, res); }

  @Post(':id/mute') @HttpCode(200) @UseGuards(AuthGuard)
  mute(@Req() req: AuthedRequest, @Res() res: Response) { return posts.togglePostMute(req, res); }
}
