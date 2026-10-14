import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';

/** GET /moderation/removed (staff). */
@Module({ controllers: [ModerationController] })
export class ModerationModule {}
