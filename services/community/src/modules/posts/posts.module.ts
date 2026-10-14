import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';

/** Fandom posts, reactions, review (approve/reject), pin/mute, sidebar. */
@Module({
  controllers: [PostsController],
  providers: [PostsService, PostsRepository],
})
export class PostsModule {}
