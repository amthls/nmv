import { Module } from '@nestjs/common';
import { DatabaseModule } from './infra/database/database.module';
import { SystemModule } from './modules/system/system.module';
import { CodesModule } from './modules/codes/codes.module';
import { UsersModule } from './modules/users/users.module';
import { TagsModule } from './modules/tags/tags.module';

/**
 * Every feature module of the catalog API. Routes not moved to a module yet are still served by the legacy
 * Express routers that server.ts mounts before Nest's own routes (Plan/nestjs-go-layout.md).
 */
@Module({
  imports: [DatabaseModule, SystemModule, TagsModule, CodesModule, UsersModule],
})
export class AppModule {}
