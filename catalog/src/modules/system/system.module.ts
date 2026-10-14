import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Health check (the 6-hourly reconcile job joins it when the worker moves to Nest). */
@Module({
  controllers: [HealthController],
})
export class SystemModule {}
