import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const IS_PROD = process.env.NODE_ENV === 'production';

// Value that used to be hard-coded in the source: anyone who has read the repo can forge tokens with it.
const KNOWN_DEFAULT_JWT_SECRET = 'super_secret_jwt_novelhub_key_2026_x89a@!secure';

export const JWT_SECRET = process.env.JWT_SECRET || KNOWN_DEFAULT_JWT_SECRET;

if (IS_PROD && (!process.env.JWT_SECRET || JWT_SECRET === KNOWN_DEFAULT_JWT_SECRET || JWT_SECRET.length < 32)) {
  throw new Error(
    'JWT_SECRET is missing, too short (<32 chars) or still the public default. ' +
      'Set a long random value in .env (e.g. `openssl rand -hex 32`) before running in production.'
  );
}
if (!IS_PROD && JWT_SECRET === KNOWN_DEFAULT_JWT_SECRET) {
  console.warn('[Security] JWT_SECRET is the public default - fine for local dev only.');
}

/** The /auth/accounts demo list is public by design; keep it off unless explicitly enabled. */
export const ENABLE_DEMO_ACCOUNTS = process.env.ENABLE_DEMO_ACCOUNTS === 'true';

export const RABBITMQ_URL = process.env.RABBITMQ_URL || '';
