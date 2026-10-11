import { pool } from '../src/config/db';

async function migrate() {
  try {
    console.log('Migrating database schema for Groups and Smart Chapter Publishing...');

    // 1. Translation Groups schema enhancement
    await pool.query(`
      ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'approved';
      ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
      ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
      ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS rules TEXT;
      UPDATE translation_groups SET approval_status = 'approved' WHERE approval_status IS NULL;
    `);

    // 2. Group Messages Table (Internal Team Chat)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_messages (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        group_id    UUID NOT NULL REFERENCES translation_groups(id) ON DELETE CASCADE,
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message     TEXT NOT NULL,
        attachments JSONB DEFAULT '[]'::jsonb,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at ASC);
    `);

    // 3. Chapter Submissions Table (Line-based content with Leader Approval)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chapter_submissions (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        story_id            UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        volume_id           UUID REFERENCES volumes(id) ON DELETE SET NULL,
        chapter_number      DECIMAL(10,2) NOT NULL,
        title               VARCHAR(500) NOT NULL,
        slug                VARCHAR(500) NOT NULL,
        content_blocks      JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw_content         TEXT,
        word_count          INTEGER DEFAULT 0,
        uploader_id         UUID NOT NULL REFERENCES users(id),
        group_id            UUID REFERENCES translation_groups(id) ON DELETE SET NULL,
        approval_status     VARCHAR(20) DEFAULT 'pending',
        approved_by         UUID REFERENCES users(id),
        approved_at         TIMESTAMPTZ,
        is_active           BOOLEAN DEFAULT FALSE,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chapter_submissions_story ON chapter_submissions(story_id, chapter_number);
      CREATE INDEX IF NOT EXISTS idx_chapter_submissions_group ON chapter_submissions(group_id);
    `);

    // 4. Update chapters table with content_blocks support
    await pool.query(`
      ALTER TABLE chapters ADD COLUMN IF NOT EXISTS content_blocks JSONB DEFAULT '[]'::jsonb;
    `);

    console.log('✅ Database migration for Groups & Smart Chapter Publishing completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrate();
