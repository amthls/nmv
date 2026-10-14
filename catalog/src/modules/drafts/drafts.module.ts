import { Module } from '@nestjs/common';
import { DraftsController } from './drafts.controller';
import { DraftsRepository } from './drafts.repository';
import { DraftsService } from './drafts.service';

/** Chapter drafts and proposals: content checks here, storage in the workspace service. */
@Module({
  controllers: [DraftsController],
  providers: [DraftsService, DraftsRepository],
})
export class DraftsModule {}
