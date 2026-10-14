import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';

/** Comments on stories, chapters and posts, likes. */
@Module({ controllers: [CommentsController] })
export class CommentsModule {}
