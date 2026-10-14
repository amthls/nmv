import { Module } from '@nestjs/common';
import { DatabaseModule } from './infra/database/database.module';
import { ExportsModule } from './modules/exports/exports.module';
import { SystemModule } from './modules/system/system.module';
import { UploadModule } from './modules/upload/upload.module';

@Module({ imports: [DatabaseModule, SystemModule, UploadModule, ExportsModule] })
export class AppModule {}
