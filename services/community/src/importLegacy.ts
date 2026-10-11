import { Client } from 'pg';
import { pool } from './config';

/**
 * `node dist/server.js import-legacy`: copy posts, reactions, post mutes, comments, likes and reports from the
 * backend's database (LEGACY_DATABASE_URL = novel_platform) into community_db, keeping ids and smart codes. Runs once
 * (legacy_imports): what is deleted here later must not come back from the old tables. Reports get the snapshot
 * of the story/chapter they point at (preview, code, path), as new reports do.
 */
export async function importLegacy(legacyUrl: string) {
  if (!legacyUrl) throw new Error('LEGACY_DATABASE_URL is required');
  if ((await pool.query(`SELECT 1 FROM legacy_imports WHERE part = 'all'`)).rowCount) {
    console.log('import-legacy: already imported');
    return;
  }
  const old = new Client({ connectionString: legacyUrl });
  await old.connect();
  try {
    if (!(await old.query(`SELECT to_regclass('posts') IS NOT NULL AS ok`)).rows[0].ok) {
      console.log('import-legacy: no legacy tables, nothing to do');
      await pool.query(`INSERT INTO legacy_imports (part) VALUES ('all') ON CONFLICT DO NOTHING`);
      return;
    }
    const posts = (await old.query(`SELECT * FROM posts ORDER BY created_at`)).rows;
    const reactions = (await old.query(`SELECT id, post_id, user_id, reaction::text AS reaction, created_at FROM post_reactions`)).rows;
    const mutes = (await old.query(`SELECT user_id, post_id, created_at FROM post_notification_mutes`)).rows;
    // parents before replies
    const comments = (await old.query(`SELECT *, target_type::text AS target_type FROM comments ORDER BY depth, created_at`)).rows;
    const likes = (await old.query(`SELECT user_id, comment_id, created_at FROM comment_likes`)).rows;
    const reports = (await old.query(`
      SELECT r.*, t.preview, t.code AS t_code, t.path FROM reports r
      LEFT JOIN LATERAL (
        SELECT s.title AS preview, s.code, s.slug AS path FROM stories s WHERE r.target_type = 'story' AND s.id = r.target_id
        UNION ALL
        SELECT s.title || ' · ' || c.title, s.code || '-C' || trim_scale(c.chapter_number)::text, s.slug || '/' || c.slug
          FROM chapters c JOIN stories s ON s.id = c.story_id WHERE r.target_type = 'chapter' AND c.id = r.target_id
        UNION ALL
        SELECT p.title, p.code, p.slug FROM posts p WHERE r.target_type = 'post' AND p.id = r.target_id
        UNION ALL
        SELECT left(c.content, 160), NULL, NULL FROM comments c WHERE r.target_type = 'comment' AND c.id = r.target_id
      ) t ON true ORDER BY r.created_at`)).rows;

    const client = await pool.connect();
    const added = { posts: 0, reactions: 0, mutes: 0, comments: 0, likes: 0, reports: 0 };
    try {
      await client.query('BEGIN');
      const ins = async (key: keyof typeof added, sql: string, values: unknown[]) => {
        added[key] += (await client.query(sql, values)).rowCount || 0;
      };
      for (const p of posts) {
        await ins('posts', `INSERT INTO posts (id, user_id, title, slug, content, cover_image_url, images, story_id, is_published, is_draft,
            is_deleted, approval_status, approved_by, approved_at, view_count, comment_count, reaction_count, published_at, created_at,
            updated_at, category, is_pinned, rejection_reason, code_no, removed_by, removed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) ON CONFLICT (id) DO NOTHING`,
        [p.id, p.user_id, p.title, p.slug, p.content, p.cover_image_url, JSON.stringify(p.images ?? []), p.story_id, p.is_published,
          p.is_draft, p.is_deleted, p.approval_status, p.approved_by, p.approved_at, p.view_count, p.comment_count, p.reaction_count,
          p.published_at, p.created_at, p.updated_at, p.category, p.is_pinned, p.rejection_reason, p.code_no, p.removed_by, p.removed_at]);
      }
      for (const r of reactions) {
        await ins('reactions', `INSERT INTO post_reactions (id, post_id, user_id, reaction, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [r.id, r.post_id, r.user_id, r.reaction, r.created_at]);
      }
      for (const m of mutes) {
        await ins('mutes', `INSERT INTO post_notification_mutes (user_id, post_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [m.user_id, m.post_id, m.created_at]);
      }
      for (const c of comments) {
        await ins('comments', `INSERT INTO comments (id, user_id, target_type, target_id, parent_id, root_id, depth, content, is_edited,
            is_deleted, quoted_text, like_count, reply_count, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING`,
        [c.id, c.user_id, c.target_type, c.target_id, c.parent_id, c.root_id, c.depth, c.content, c.is_edited, c.is_deleted, c.quoted_text,
          c.like_count, c.reply_count, c.created_at, c.updated_at]);
      }
      for (const l of likes) {
        await ins('likes', `INSERT INTO comment_likes (user_id, comment_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [l.user_id, l.comment_id, l.created_at]);
      }
      for (const r of reports) {
        await ins('reports', `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, description, status, resolved_by, resolved_at,
            resolution_note, created_at, code_no, target_preview, target_code, target_path)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.description, r.status, r.resolved_by, r.resolved_at,
          r.resolution_note, r.created_at, r.code_no, r.preview, r.t_code, r.path]);
      }
      // New codes continue after the old ones
      await client.query(`SELECT setval('posts_code_seq', COALESCE((SELECT max(code_no) FROM posts), 0) + 1, false)`);
      await client.query(`SELECT setval('reports_code_seq', COALESCE((SELECT max(code_no) FROM reports), 0) + 1, false)`);
      await client.query(`INSERT INTO legacy_imports (part) VALUES ('all')`);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    console.log(`import-legacy: ${added.posts}/${posts.length} posts, ${added.reactions}/${reactions.length} reactions, `
      + `${added.mutes}/${mutes.length} post mutes, ${added.comments}/${comments.length} comments, ${added.likes}/${likes.length} likes, `
      + `${added.reports}/${reports.length} reports added`);
  } finally {
    await old.end();
  }
}
