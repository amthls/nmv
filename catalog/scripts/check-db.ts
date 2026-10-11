import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/novel_platform?schema=public',
});

async function checkDatabase() {
  console.log('🔍 Đang kiểm tra kết nối cơ sở dữ liệu PostgreSQL...');
  console.log(`📡 URL: ${process.env.DATABASE_URL || 'default'}`);

  try {
    const client = await pool.connect();
    console.log('✅ Kết nối PostgreSQL thành công!\n');

    // Kiểm tra version
    const versionRes = await client.query('SELECT version();');
    console.log(`📌 PostgreSQL Version: ${versionRes.rows[0].version.split(',')[0]}`);

    // Kiểm tra danh sách bảng
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);

    console.log(`\n📋 Tổng số bảng trong CSDL: ${tablesRes.rows.length}`);

    // Kiểm tra số lượng bản ghi từng bảng chính
    const queries = [
      { name: 'Users', query: 'SELECT count(*) FROM users;' },
      { name: 'User Roles', query: 'SELECT count(*) FROM user_roles;' },
      { name: 'User Settings', query: 'SELECT count(*) FROM user_settings;' },
      { name: 'Tag Categories', query: 'SELECT count(*) FROM tag_categories;' },
      { name: 'Tags', query: 'SELECT count(*) FROM tags;' },
      { name: 'Translation Groups', query: 'SELECT count(*) FROM translation_groups;' },
      { name: 'Group Members', query: 'SELECT count(*) FROM group_members;' },
      { name: 'Stories', query: 'SELECT count(*) FROM stories;' },
      { name: 'Chapters', query: 'SELECT count(*) FROM chapters;' },
    ];

    console.log('\n📊 Thống kê dữ liệu hiện tại:');
    console.log('--------------------------------------------');
    for (const q of queries) {
      try {
        const countRes = await client.query(q.query);
        console.log(`  • ${q.name.padEnd(25)}: ${countRes.rows[0].count} records`);
      } catch (err: any) {
        console.log(`  • ${q.name.padEnd(25)}: [Chưa có bảng hoặc lỗi: ${err.message}]`);
      }
    }
    console.log('--------------------------------------------');

    client.release();
    await pool.end();
    console.log('\n🎉 Hoàn tất kiểm tra database! Hệ thống sẵn sàng.');
  } catch (error: any) {
    console.error('\n❌ Lỗi kết nối cơ sở dữ liệu:');
    console.error(error.message);
    console.error('\n💡 Hướng dẫn xử lý:');
    console.error('1. Kiểm tra Docker: `docker compose ps`');
    console.error('2. Khởi động DB: `yarn db:up`');
    console.error('3. Import lại schema: `yarn db:import`');
    process.exit(1);
  }
}

checkDatabase();
