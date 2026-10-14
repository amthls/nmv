import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { InternalRepository } from './internal.repository';
import { InternalService } from './internal.service';

/** Service-to-service /internal/* from catalog: smart codes, profile stats, purge of comments of a deleted story. */
@Module({
  controllers: [InternalController],
  providers: [InternalService, InternalRepository],
})
export class InternalModule {}
