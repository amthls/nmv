import { Controller, Get } from '@nestjs/common';
import { queueStatus } from '../../infra/queue/queue.service';

/** GET /api/v1/health: liveness plus the RabbitMQ publisher state. */
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'NovelHub RESTful API',
      version: '1.0.0',
      queue: queueStatus(), // 'up' | 'down' | 'disabled' (RabbitMQ publisher connection)
    };
  }
}
