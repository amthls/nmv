import { Module } from '@nestjs/common';
import { DatabaseModule } from './infra/database/database.module';
import { CommentsModule } from './modules/comments/comments.module';
import { InternalModule } from './modules/internal/internal.module';
import { LegacyImportModule } from './modules/legacy-import/legacy-import.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { NotifyModule } from './modules/notify/notify.module';
import { PostsModule } from './modules/posts/posts.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SystemModule } from './modules/system/system.module';

@Module({
  imports: [DatabaseModule, SystemModule, CommentsModule, ReportsModule, ModerationModule, PostsModule, InternalModule, NotifyModule, LegacyImportModule],
})
export class AppModule {}
