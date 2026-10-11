import '../utils/logger'; // first: JSON logs + redaction for everything that follows
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const IS_PROD = process.env.NODE_ENV === 'production';


/** The /auth/accounts demo list is public by design; keep it off unless explicitly enabled. */
export const ENABLE_DEMO_ACCOUNTS = process.env.ENABLE_DEMO_ACCOUNTS === 'true';

export const RABBITMQ_URL = process.env.RABBITMQ_URL || '';

if (IS_PROD && !process.env.REDIS_URL) {
  console.warn('[Config] REDIS_URL is not set: no API cache, per-process rate limits, direct view writes, no realtime push.');
}
