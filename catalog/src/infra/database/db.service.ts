import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult } from 'pg';
import { pool } from '../../config/db';

/** Something to run SQL on: the pool, or one client inside a transaction. */
export type Queryable = { query: (text: string, params?: any[]) => Promise<QueryResult<any>> };

/**
 * The catalog's Postgres (through PgBouncer, transaction pooling): no session state, so a transaction must
 * keep one client from BEGIN to COMMIT, which withTransaction does. Repositories take a Queryable so the same
 * SQL runs on the pool or inside a transaction.
 */
@Injectable()
export class DbService implements Queryable {
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
