import { Module } from '@nestjs/common';
import { ChaptersController } from './chapters.controller';
import { ChaptersRepository } from './chapters.repository';
import { ChaptersService } from './chapters.service';

/** Published chapters: post, edit, delete. The workspace sync and view counter live beside it. */
@Module({
  controllers: [ChaptersController],
  providers: [ChaptersService, ChaptersRepository],
  exports: [ChaptersRepository],
})
export class ChaptersModule {}
