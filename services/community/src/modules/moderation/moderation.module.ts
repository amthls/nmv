import { Module } from '@nestjs/common';
import { CommentsModule } from '../comments/comments.module';
import { ModerationController } from './moderation.controller';
import { ModerationRepository } from './moderation.repository';
import { ModerationService } from './moderation.service';

/** GET /moderation/removed (staff) and the identity.user.deleted event handler. */
@Module({
  imports: [CommentsModule],
  controllers: [ModerationController],
  providers: [ModerationService, ModerationRepository],
  exports: [ModerationService],
})
export class ModerationModule {}
