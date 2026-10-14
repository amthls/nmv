import { Module } from '@nestjs/common';
import { CodesController } from './codes.controller';
import { CodesRepository } from './codes.repository';
import { CodesService } from './codes.service';

/** Smart codes (U-.., G.., LN-.., P-.., AL-.., RP-..). */
@Module({
  controllers: [CodesController],
  providers: [CodesService, CodesRepository],
})
export class CodesModule {}
