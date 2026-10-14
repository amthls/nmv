import './common/utils/logger'; // first: every console.* line becomes JSON
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

export const PORT = Number(process.env.PORT || 8080);
export const IS_PROD = process.env.NODE_ENV === 'production';
export const BACKEND_URL = (process.env.CATALOG_INTERNAL_URL || 'http://catalog:5000').replace(/\/+$/, '');
// USER_SIG_KEY_MEDIA: identity signs the gateway's X-User-* for us alone; INTERNAL_KEY_CATALOG: our calls to the backend
export const USER_SIG_KEY = process.env.USER_SIG_KEY_MEDIA || '';
export const BACKEND_KEY = process.env.INTERNAL_KEY_CATALOG || '';
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
export const EXPORT_DIR = path.resolve(process.env.EXPORT_DIR || path.join(process.cwd(), 'exports'));
export const CACHE_DIR = path.resolve(process.env.IMAGE_CACHE_DIR || path.join(process.cwd(), '.cache', 'images'));

export const pool = new Pool({ connectionString: process.env.MEDIA_DATABASE_URL, max: 10 });
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

/** Applies migrations/*.sql not recorded yet, in one transaction under an advisory lock (two copies starting together). */
export async function migrate() {
  const dir = path.resolve(__dirname, '../migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('media_migrate'))`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`);
    for (const f of files) {
      if ((await client.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [f])).rowCount) continue;
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]);
      console.log(`applied migration ${f}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
