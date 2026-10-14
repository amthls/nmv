import { Module } from '@nestjs/common';
import { ExportsInternalController } from './exports-internal.controller';
import { ExportsRepository } from './exports.repository';
import { ExportsService } from './exports.service';

/** Chapter export for the workspace import, and EPUB/PDF sources for the media service. */
@Module({
  controllers: [ExportsInternalController],
  providers: [ExportsService, ExportsRepository],
})
export class ExportsModule {}
