import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { pool } from '../../config';

/** The community Postgres pool (config.ts), for modules that want it injected. */
@Injectable()
export class DbService {
  query(text: string, params?: any[]) {
    return pool.query(text, params);
  }

  async withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
