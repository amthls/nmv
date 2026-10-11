import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/novel_platform?schema=public',
});

async function importSql() {
  const sqlPath = path.resolve(__dirname, '../../sql/database.sql');
  console.log(`🚀 Đang đọc file SQL tại: ${sqlPath}`);

  if (!fs.existsSync(sqlPath)) {
    console.error(`❌ Không tìm thấy file SQL tại: ${sqlPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');

  try {
    const client = await pool.connect();
    console.log('📦 Đang thực thi SQL import vào PostgreSQL...');

    await client.query(sql);

    console.log('✅ Import SQL và Seed dữ liệu thành công!');
    client.release();
    await pool.end();
  } catch (error: any) {
    console.error('❌ Lỗi khi import SQL:', error.message);
    process.exit(1);
  }
}

importSql();
