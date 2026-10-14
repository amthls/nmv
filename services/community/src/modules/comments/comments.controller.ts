import { Controller, Delete, Get, HttpCode, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Mw } from '../../common/guards/express-middleware.guard';
import { commentLimiter } from '../../common/utils/auth';
import type { AuthedRequest } from '../../common/utils/auth';
import * as comments from './comments.service';

@Controller('comments')
export class CommentsController {
  @Get()
  list(@Req() req: Request, @Res() res: Response) { return comments.getComments(req, res); }

  @Post() @HttpCode(200) @UseGuards(AuthGuard, Mw(commentLimiter))
  create(@Req() req: AuthedRequest, @Res() res: Response) { return comments.createComment(req, res); }

  @Post(':id/like') @HttpCode(200) @UseGuards(AuthGuard)
  like(@Req() req: AuthedRequest, @Res() res: Response) { return comments.likeComment(req, res); }

  @Put(':id') @UseGuards(AuthGuard)
  update(@Req() req: AuthedRequest, @Res() res: Response) { return comments.updateComment(req, res); }

  @Delete(':id') @UseGuards(AuthGuard)
  remove(@Req() req: AuthedRequest, @Res() res: Response) { return comments.deleteComment(req, res); }
}
