import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';

/** Fandom posts, reactions, review (approve/reject), pin/mute, sidebar. */
@Module({ controllers: [PostsController] })
export class PostsModule {}
