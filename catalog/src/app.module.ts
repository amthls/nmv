import { Module } from '@nestjs/common';
import { DatabaseModule } from './infra/database/database.module';
import { SystemModule } from './modules/system/system.module';
import { CodesModule } from './modules/codes/codes.module';
import { GroupsModule } from './modules/groups/groups.module';
import { UsersModule } from './modules/users/users.module';
import { TagsModule } from './modules/tags/tags.module';
import { VolumesModule } from './modules/volumes/volumes.module';
import { SearchModule } from './modules/search/search.module';
import { ExportsModule } from './modules/exports/exports.module';
import { LibrarySyncModule } from './modules/library-sync/library-sync.module';
import { StoriesModule } from './modules/stories/stories.module';
import { ChaptersModule } from './modules/chapters/chapters.module';
import { DraftsModule } from './modules/drafts/drafts.module';

/** Every feature module of the catalog API (server.ts sets the global middleware, prefix and error filter). */
@Module({
  imports: [DatabaseModule, SystemModule, TagsModule, CodesModule, UsersModule, GroupsModule, StoriesModule, VolumesModule, SearchModule, ExportsModule, LibrarySyncModule, ChaptersModule, DraftsModule],
})
export class AppModule {}
