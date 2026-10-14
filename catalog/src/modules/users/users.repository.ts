import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

/** SQL of the users feature (profiles, settings, roles shown on the site). The users table is a copy of identity's. */
@Injectable()
export class UsersRepository {
  constructor(private readonly db: DbService) {}

  /** GET /auth/me */
  async findMe(userId: string) {
    const r = await this.db.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
        COALESCE(u.email_verified, false) AS email_verified,
        COALESCE(json_agg(json_build_object('role', ur.role, 'is_visible', ur.is_visible)) FILTER (WHERE ur.role IS NOT NULL), '[]') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       WHERE u.id = $1::uuid
       GROUP BY u.id`,
      [userId]
    );
    return r.rows[0] || null;
  }

  async demoAccounts() {
    const r = await this.db.query(`
      SELECT u.id, u.username, u.display_name, u.avatar_url,
        COALESCE(json_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '[]') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      WHERE u.username IN ('admin', 'mod_sakura', 'trans_hana', 'reader_yuki', 'reader_ryu')
      GROUP BY u.id
      ORDER BY u.created_at ASC;
    `);
    return r.rows;
  }

  async listActive() {
    const r = await this.db.query(`
      SELECT
        u.id, u.username, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
        COALESCE(
          json_agg(
            json_build_object('role', ur.role, 'is_visible', ur.is_visible)
          ) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      WHERE u.is_banned = false
      GROUP BY u.id
      ORDER BY u.created_at ASC;
    `);
    return r.rows;
  }

  /** Own account page: base row, not banned. */
  async findOwnProfile(userId: string) {
    const r = await this.db.query(`
      SELECT
        u.id, u.code, u.username, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
        u.email_verified,
        COALESCE(
          json_agg(
            json_build_object('role', ur.role, 'is_visible', ur.is_visible)
          ) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      WHERE u.id = $1::uuid AND u.is_banned = false
      GROUP BY u.id;
    `, [userId]);
    return r.rows[0] || null;
  }

  async findSettings(userId: string) {
    const r = await this.db.query(`SELECT * FROM user_settings WHERE user_id = $1::uuid`, [userId]);
    return r.rows[0] || null;
  }

  private async count(sql: string, userId: string) {
    const r = await this.db.query(sql, [userId]);
    return parseInt(r.rows[0]?.n || '0');
  }

  countGroupMemberships(userId: string) {
    return this.count(`SELECT count(*) AS n FROM group_members WHERE user_id = $1`, userId);
  }

  countStoriesUploaded(userId: string) {
    return this.count(`SELECT count(*) AS n FROM stories WHERE uploader_id = $1`, userId);
  }

  countChaptersUploaded(userId: string) {
    return this.count(`SELECT count(*) AS n FROM chapters WHERE uploader_id = $1`, userId);
  }

  async groupsOfUser(userId: string) {
    const r = await this.db.query(`
        SELECT g.name, g.slug, g.avatar_url, gm.role, gm.joined_at
        FROM group_members gm JOIN translation_groups g ON g.id = gm.group_id
        WHERE gm.user_id = $1
        ORDER BY gm.joined_at ASC
      `, [userId]);
    return r.rows;
  }

  async latestStoriesOfUploader(userId: string) {
    const r = await this.db.query(`
        SELECT id, title, slug, cover_image_url, story_type, approval_status, total_chapters, total_views
        FROM stories WHERE uploader_id = $1
        ORDER BY created_at DESC LIMIT 6
      `, [userId]);
    return r.rows;
  }

  /** Public profile lookup by username (any status; the service hides banned/deleted from non-staff). */
  async findPublicByUsername(username: string) {
    const r = await this.db.query(`
      SELECT
        u.id, u.code, u.username, u.display_name, u.avatar_url, u.banner_url, u.bio, u.created_at,
        u.is_banned, u.ban_reason, u.banned_at, u.deleted_at,
        COALESCE(
          json_agg(
            json_build_object('role', ur.role, 'is_visible', ur.is_visible)
          ) FILTER (WHERE ur.role IS NOT NULL), '[]'
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      WHERE lower(u.username) = lower($1)
      GROUP BY u.id;
    `, [username]);
    return r.rows[0] || null;
  }

  async approvedStoriesOfUploader(userId: string) {
    const r = await this.db.query(`
        SELECT id, title, slug, cover_image_url, story_type, status, total_chapters, total_views
        FROM stories WHERE uploader_id = $1 AND approval_status = 'approved'
        ORDER BY last_chapter_at DESC NULLS LAST, created_at DESC
        LIMIT 60 -- shortcut: a profile shows the 60 latest stories; add paging when uploaders have more
      `, [userId]);
    return r.rows;
  }

  async approvedGroupsOfUser(userId: string) {
    const r = await this.db.query(`
        SELECT g.name, g.slug, g.avatar_url, gm.role
        FROM group_members gm JOIN translation_groups g ON g.id = gm.group_id
        WHERE gm.user_id = $1 AND g.approval_status = 'approved'
        ORDER BY gm.joined_at ASC
      `, [userId]);
    return r.rows;
  }

  /** UPDATE users with the given [column, value] pairs (+ updated_at); returns the saved row. */
  async updateProfile(userId: string, fields: [string, unknown][]) {
    const sets: string[] = [];
    const params: any[] = [];
    for (const [column, value] of fields) {
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    sets.push('updated_at = NOW()');
    params.push(userId);

    const r = await this.db.query(`
      UPDATE users SET ${sets.join(', ')}
      WHERE id = $${params.length}::uuid
      RETURNING id, username, display_name, avatar_url, banner_url, bio, updated_at;
    `, params);
    return r.rows[0];
  }

  /** Upsert only the settings that were sent (column defaults fill the rest for a new row). */
  async upsertSettings(userId: string, fields: [string, unknown][]) {
    const columns: string[] = ['user_id'];
    const params: any[] = [userId];
    for (const [column, value] of fields) {
      if (value === undefined) continue;
      columns.push(column);
      params.push(value);
    }
    const placeholders = params.map((_, i) => `$${i + 1}`);
    const updates = columns.slice(1).map((c) => `${c} = EXCLUDED.${c}`);
    updates.push('updated_at = NOW()');

    // Insert the row if the user has none yet (column defaults fill the rest), else update just these fields
    const r = await this.db.query(`
      INSERT INTO user_settings (${columns.join(', ')}) VALUES (${placeholders.join(', ')})
      ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}
      RETURNING *;
    `, params);
    return r.rows[0];
  }

  /** Names of the groups this user is the only leader of (delete-check from identity). */
  async soleLeaderGroupNames(userId: string): Promise<string[]> {
    const r = await this.db.query(`
    SELECT g.name FROM group_members gm JOIN translation_groups g ON g.id = gm.group_id
    WHERE gm.user_id = $1 AND gm.role = 'leader'
      AND (SELECT COUNT(*) FROM group_members x WHERE x.group_id = gm.group_id AND x.role = 'leader') = 1
  `, [userId]);
    return r.rows.map((x) => x.name);
  }

  /** POST /internal/users/profiles lookup. */
  async profilesByIdsOrNames(ids: string[], names: string[]) {
    const r = await this.db.query(
      `SELECT id, username, display_name, avatar_url, COALESCE(is_banned, false) AS is_banned, deleted_at IS NOT NULL AS deleted, code_no::int AS code_no,
       COALESCE((SELECT array_agg(role::text) FROM user_roles r WHERE r.user_id = users.id), '{}') AS roles
     FROM users WHERE id = ANY($1::uuid[]) OR username = ANY($2::text[])`,
      [ids, names]
    );
    return r.rows;
  }
}
