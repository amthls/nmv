import { Module } from '@nestjs/common';
import { VolumesController } from './volumes.controller';
import { VolumesRepository } from './volumes.repository';
import { VolumesService } from './volumes.service';

/** Volumes (tập) of a story. */
@Module({
  controllers: [VolumesController],
  providers: [VolumesService, VolumesRepository],
})
export class VolumesModule {}
