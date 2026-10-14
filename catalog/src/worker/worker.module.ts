import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infra/database/database.module';
import { WorkerService } from './worker.service';

/** Background worker (`node dist/worker.js`): no HTTP routes; WorkerService starts the consumers and timers. */
@Module({
  imports: [DatabaseModule],
  providers: [WorkerService],
})
export class WorkerModule {}
