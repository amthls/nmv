import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DbService } from '../../infra/database/db.service';

@Controller()
export class SystemController {
  constructor(private readonly db: DbService) {}

  @Get('health')
  health() {
    return { success: true };
  }

  @Get('ready')
  async ready(@Res() res: Response) {
    const ok = await this.db.query('SELECT 1').then(() => true, () => false);
    res.status(ok ? 200 : 503).json({ success: ok, data: { database: ok ? 'ok' : 'down' } });
  }
}
