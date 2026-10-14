import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../../infra/database/db.service';
import { insertWithUniqueSlug } from '../../utils/ids';

/** SQL of translation groups, their members and join requests. */
@Injectable()
export class GroupsRepository {
  constructor(private readonly db: DbService) {}

  // ---------------------------------------------------------------- groups

  /** One page of groups; `conditions` and `params` are built by the service (placeholders $1..$n). */
  async list(conditions: string, params: any[], limit: number, offset: number) {
    const result = await this.db.query(`
      SELECT
        g.*,
        u.username as creator_username,
        u.display_name as creator_name,
        u.avatar_url as creator_avatar,
        (
          SELECT json_build_object('username', lu.username, 'display_name', lu.display_name)
          FROM group_members lm JOIN users lu ON lu.id = lm.user_id
          WHERE lm.group_id = g.id AND lm.role = 'leader'
          ORDER BY lm.joined_at ASC LIMIT 1
        ) as leader,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
        (SELECT COUNT(*) FROM stories WHERE group_id = g.id AND approval_status = 'approved') as story_count,
        COUNT(*) OVER () AS total_count
      FROM translation_groups g
      JOIN users u ON g.created_by = u.id
      ${conditions}
      ORDER BY g.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `, [...params, limit, offset]);
    return result.rows;
  }

  async findBySlug(slug: string) {
    const result = await this.db.query(`
      SELECT
        g.*,
        u.username as creator_username,
        u.display_name as creator_name,
        u.avatar_url as creator_avatar,
        (SELECT COUNT(*)::int FROM stories WHERE group_id = g.id AND approval_status = 'approved') AS story_count
      FROM translation_groups g
      JOIN users u ON g.created_by = u.id
      WHERE g.slug = $1;
    `, [slug]);
    return result.rows[0] || null;
  }

  async members(groupId: string) {
    const r = await this.db.query(`
      SELECT
        gm.id, gm.role, gm.joined_at,
        u.id as user_id, u.username, u.display_name, u.avatar_url
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
      ORDER BY
        CASE gm.role
          WHEN 'leader' THEN 1
          WHEN 'mod' THEN 2
          WHEN 'translator' THEN 3
          WHEN 'editor' THEN 4
          ELSE 5
        END ASC, gm.joined_at ASC;
    `, [groupId]);
    return r.rows;
  }

  async pendingRequestOf(groupId: string, userId: string) {
    const r = await this.db.query(`
        SELECT id, status, created_at FROM group_join_requests
        WHERE group_id = $1 AND user_id = $2 AND status = 'pending'
      `, [groupId, userId]);
    return r.rows[0] || null;
  }

  async approvedStories(groupId: string) {
    const r = await this.db.query(`
      SELECT
        s.id, s.title, s.slug, s.cover_image_url, s.story_type, s.status,
        s.total_chapters, s.total_views,
        s.last_chapter_at, s.author_name
      FROM stories s
      WHERE s.group_id = $1 AND s.approval_status = 'approved'
      ORDER BY s.last_chapter_at DESC NULLS LAST, s.created_at DESC
      LIMIT 200; -- shortcut: a group page lists its 200 most recently updated stories; page it when a group has more
    `, [groupId]);
    return r.rows;
  }

  async nameTaken(name: string, exceptGroupId?: string) {
    const r = await this.db.query(
      `SELECT 1 FROM translation_groups WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [name, exceptGroupId ?? null]
    );
    return r.rows.length > 0;
  }

  /** INSERT with a free slug (name, name-2...), returns the group row. */
  async insertGroup(baseSlug: string, name: string, f: Record<string, any>, creatorId: string) {
    const groupRes = await insertWithUniqueSlug(this.db, 'translation_groups', baseSlug, (uniqueSlug) => this.db.query(`
      INSERT INTO translation_groups (
        name, slug, description, avatar_url, banner_url, website_url, discord_url, rules, created_by, approval_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved'
      ) RETURNING *;
    `, [
      name,
      uniqueSlug,
      f.description ?? null,
      f.avatar_url ?? null,
      f.banner_url ?? null,
      f.website_url ?? null,
      f.discord_url ?? null,
      f.rules ?? null,
      creatorId,
    ]));
    return groupRes.rows[0];
  }

  async addLeader(groupId: string, userId: string) {
    await this.db.query(`
      INSERT INTO group_members (group_id, user_id, role)
      VALUES ($1, $2, 'leader'::group_role)
      ON CONFLICT DO NOTHING;
    `, [groupId, userId]);
  }

  /** UPDATE the sent fields ([column, value] pairs, undefined skipped); returns the row or undefined. */
  async updateFields(id: string, fields: Record<string, unknown>) {
    const sets: string[] = [];
    const params: any[] = [];
    for (const [column, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    sets.push('updated_at = NOW()');
    params.push(id);

    const r = await this.db.query(`
      UPDATE translation_groups SET ${sets.join(', ')}
      WHERE id = $${params.length}
      RETURNING *;
    `, params);
    return r.rows[0];
  }

  async updateWorkflow(id: string, ordered: string[], mergers: string[] | null) {
    const r = await this.db.query(
      `UPDATE translation_groups SET workflow = $1, mergers = COALESCE($3, mergers), updated_at = NOW() WHERE id = $2 RETURNING workflow, mergers`,
      [ordered, id, mergers],
    );
    return r.rows[0];
  }

  async groupName(id: string): Promise<string | null> {
    const r = await this.db.query(`SELECT name FROM translation_groups WHERE id = $1`, [id]);
    return r.rows[0]?.name ?? null;
  }

  async groupExists(id: string) {
    const r = await this.db.query(`SELECT 1 FROM translation_groups WHERE id = $1`, [id]);
    return !!r.rowCount;
  }

  /** GET /internal/groups/:id/members */
  async memberIdsAndRoles(groupId: string) {
    const r = await this.db.query(`SELECT user_id, role FROM group_members WHERE group_id = $1`, [groupId]);
    return r.rows;
  }

  // ---------------------------------------------------------------- members

  async roleOf(groupId: string, userId: string): Promise<string | null> {
    const r = await this.db.query(`SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`, [groupId, userId]);
    return r.rows[0]?.role ?? null;
  }

  async countLeaders(groupId: string): Promise<number> {
    const r = await this.db.query(`SELECT COUNT(*)::int AS count FROM group_members WHERE group_id = $1 AND role = 'leader'`, [groupId]);
    return r.rows[0].count;
  }

  /** Exact (case-insensitive) match: no LIKE wildcards, so "%" can't pick a random user. */
  async findUserByUsername(username: string) {
    const r = await this.db.query(`
      SELECT id, username, display_name, is_banned FROM users
      WHERE lower(username) = lower($1)
      LIMIT 1;
    `, [username]);
    return r.rows[0];
  }

  /** Never overwrites an existing member's role; returns the new member row id, or null when already a member. */
  async insertMember(groupId: string, userId: string, role: string): Promise<string | null> {
    const r = await this.db.query(`
      INSERT INTO group_members (group_id, user_id, role)
      VALUES ($1, $2, $3::group_role)
      ON CONFLICT (group_id, user_id) DO NOTHING
      RETURNING id;
    `, [groupId, userId, role]);
    return r.rows[0]?.id ?? null;
  }

  /** Adding someone settles their open join request. */
  async approvePendingRequest(groupId: string, userId: string, reviewerId: string) {
    await this.db.query(`
      UPDATE group_join_requests SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
      WHERE group_id = $2 AND user_id = $3 AND status = 'pending'
    `, [reviewerId, groupId, userId]);
  }

  async setRole(groupId: string, userId: string, role: string) {
    await this.db.query(`
      UPDATE group_members SET role = $1::group_role WHERE group_id = $2 AND user_id = $3;
    `, [role, groupId, userId]);
  }

  async removeMember(groupId: string, userId: string) {
    await this.db.query(`
      DELETE FROM group_members WHERE group_id = $1 AND user_id = $2;
    `, [groupId, userId]);
  }

  // ---------------------------------------------------------------- join requests

  async groupForRequest(id: string) {
    const r = await this.db.query(`SELECT id, name, approval_status FROM translation_groups WHERE id = $1`, [id]);
    return r.rows[0];
  }

  async isMember(groupId: string, userId: string) {
    const r = await this.db.query(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [groupId, userId]);
    return r.rows.length > 0;
  }

  async hasRecentRejection(groupId: string, userId: string, hours: number) {
    const r = await this.db.query(`
      SELECT 1 FROM group_join_requests
      WHERE group_id = $1 AND user_id = $2 AND status = 'rejected'
        AND reviewed_at > NOW() - make_interval(hours => $3)
    `, [groupId, userId, hours]);
    return r.rows.length > 0;
  }

  /** Throws the pg error (23505 = already pending) to the caller. */
  async insertRequest(groupId: string, userId: string, message: string | null) {
    const r = await this.db.query(`
        INSERT INTO group_join_requests (group_id, user_id, message)
        VALUES ($1, $2, $3)
        RETURNING id, status, created_at
      `, [groupId, userId, message]);
    return r.rows[0];
  }

  async managerIds(groupId: string): Promise<string[]> {
    const r = await this.db.query(`
      SELECT user_id FROM group_members WHERE group_id = $1 AND role IN ('leader', 'mod')
    `, [groupId]);
    return r.rows.map((x) => x.user_id);
  }

  async cancelPending(groupId: string, userId: string) {
    const r = await this.db.query(`
      DELETE FROM group_join_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'
    `, [groupId, userId]);
    return r.rowCount;
  }

  async pendingRequests(groupId: string) {
    const r = await this.db.query(`
      SELECT
        r.id, r.message, r.status, r.created_at,
        u.id as user_id, u.username, u.display_name, u.avatar_url
      FROM group_join_requests r
      JOIN users u ON r.user_id = u.id
      WHERE r.group_id = $1 AND r.status = 'pending'
      ORDER BY r.created_at ASC
      LIMIT 200;
    `, [groupId]);
    return r.rows;
  }

  /** Inside the review transaction: lock the request row so two managers can't both act on it. */
  async lockRequest(tx: Queryable, requestId: string, groupId: string) {
    const r = await tx.query(`
      SELECT r.id, r.user_id, r.status, g.name as group_name
      FROM group_join_requests r
      JOIN translation_groups g ON g.id = r.group_id
      WHERE r.id = $1 AND r.group_id = $2
      FOR UPDATE OF r
    `, [requestId, groupId]);
    return r.rows[0];
  }

  async settleRequest(tx: Queryable, requestId: string, approve: boolean, reviewerId: string) {
    await tx.query(`
      UPDATE group_join_requests
      SET status = $1::approval_status, reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $3
    `, [approve ? 'approved' : 'rejected', reviewerId, requestId]);
  }

  async addMemberIfMissing(tx: Queryable, groupId: string, userId: string) {
    await tx.query(`
        INSERT INTO group_members (group_id, user_id, role)
        VALUES ($1, $2, 'member')
        ON CONFLICT (group_id, user_id) DO NOTHING
      `, [groupId, userId]);
  }
}
