import { Module } from '@nestjs/common';
import { StoriesController } from './stories.controller';
import { StoriesInternalController } from './stories-internal.controller';
import { StoriesRepository } from './stories.repository';
import { StoriesService } from './stories.service';

/** Stories: lists, pages, edits, collaborators, take-downs; the hot shelf and the 60-day purge jobs live beside it. */
@Module({
  controllers: [StoriesController, StoriesInternalController],
  providers: [StoriesService, StoriesRepository],
  exports: [StoriesService],
})
export class StoriesModule {}
