import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/novel_platform?schema=public';

// Raw PostgreSQL pool configured for high concurrency and crash prevention
export const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX || 50), // per process; behind PgBouncer this can be large
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return an error after 5s if acquiring connection fails
});

// Prevent unhandled error events on idle clients from crashing the process
pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error] Unexpected idle client error:', err.message);
});

// Prisma ORM Client
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

export default {
  pool,
  prisma,
};
