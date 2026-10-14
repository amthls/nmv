import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

/** Image and manga page uploads. Resized copies and static files (/uploads) are Express middleware in server.ts. */
@Module({ controllers: [UploadController], providers: [UploadService] })
export class UploadModule {}
