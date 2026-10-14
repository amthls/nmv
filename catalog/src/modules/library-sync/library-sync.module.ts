import { Module } from '@nestjs/common';
import { LibrarySyncInternalController } from './library-sync-internal.controller';
import { LibrarySyncRepository } from './library-sync.repository';

/** The library service's read copies of stories and chapters (Plan/library.md). */
@Module({
  controllers: [LibrarySyncInternalController],
  providers: [LibrarySyncRepository],
})
export class LibrarySyncModule {}
