import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsRepository } from './exports.repository';
import { ExportsService } from './exports.service';

/** EPUB/PDF export requests and downloads. The build loop (builder/) is started from server.ts. */
@Module({
  controllers: [ExportsController],
  providers: [ExportsService, ExportsRepository],
})
export class ExportsModule {}
