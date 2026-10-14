import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';

/** Service-to-service /internal/* from catalog: smart codes, profile stats, purge of comments of a deleted story. */
@Module({ controllers: [InternalController] })
export class InternalModule {}
