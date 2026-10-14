import { Injectable } from '@nestjs/common';
import { ENABLE_DEMO_ACCOUNTS } from '../../config/env';
import { communityStats } from '../../infra/clients/community.client';
import { libraryData } from '../../infra/clients/library.client';
import { InputError, isUuid } from '../../utils/validation';
import { parseProfileInput, parseSettingsInput } from './dto/user-input';
import { UsersRepository } from './users.repository';

type Actor = { id: string; roles: string[] };

/**
 * Who may moderate whom. One place for the rules, used by the actions and to tell the
 * profile page which buttons to show:
 *  - nobody acts on themselves or on an admin;
 *  - admins act on everyone else, mods only on regular users (not on other mods);
 *  - admins and mods may make a regular user a mod; only admins take the mod role away.
 */
export function moderationRights(
  actor: { id: string; roles: string[] },
  target: { id: string; roles: string[]; is_banned: boolean; deleted_at: string | null }
) {
  const actorAdmin = actor.roles.includes('admin');
  const actorMod = actor.roles.includes('mod');
  const targetAdmin = target.roles.includes('admin');
  const targetMod = target.roles.includes('mod');
  const self = actor.id === target.id;
  const alive = !target.deleted_at;
  const outranks = !self && !targetAdmin && (actorAdmin || (actorMod && !targetMod));
  return {
    ban: alive && outranks && !target.is_banned,
    unban: alive && outranks && target.is_banned,
    delete: alive && outranks,
    grant_mod: alive && !self && !target.is_banned && !targetAdmin && !targetMod && (actorAdmin || actorMod),
    revoke_mod: alive && !self && actorAdmin && targetMod,
  };
}

/** Profiles of users: the signed-in user's own page and settings, public profiles, and the lists other services ask for. */
@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  /** GET /auth/me: profile and visible roles of the signed-in user (email and account facts: GET /api/identity/me). */
  async me(userId: string) {
    const row = await this.repo.findMe(userId);
    if (!row) throw new InputError('Không tìm thấy thông tin tài khoản.', 404);
    return row;
  }

  /** Listing real usernames publicly is an account-enumeration gift; opt-in only (ENABLE_DEMO_ACCOUNTS=true). */
  async demoAccounts() {
    if (!ENABLE_DEMO_ACCOUNTS) return { success: true, data: [], disabled: true };
    return { success: true, data: await this.repo.demoAccounts() };
  }

  list() {
    return this.repo.listActive();
  }

  /** GET /profile/me: the account page (base row, settings, statistics and overview blocks). */
  async ownProfile(currentUserId: string) {
    // 1. User base and roles
    const user = await this.repo.findOwnProfile(currentUserId);
    if (!user) throw new InputError('Không tìm thấy người dùng', 404);

    // 2. User Settings
    user.settings = (await this.repo.findSettings(currentUserId)) || {
      theme: 'dark',
      primary_color: '#6C5CE7',
      font_family: 'Noto Serif',
      font_size: 18,
      line_height: 1.8,
      reading_mode: 'scroll',
    };

    // 3. User Statistics
    const [library, community, groups, storiesUploaded, chaptersUploaded] = await Promise.all([
      // reading, follows, bookmarks, albums: the library service (an empty account page part if it is down)
      libraryData(`/internal/users/${currentUserId}/overview`).catch((err) => {
        console.warn(`[library] overview of ${currentUserId} unavailable: ${err.message}`);
        return { stats: {}, recent_reads: [], albums: [], tags: [] };
      }),
      communityStats(currentUserId),
      this.repo.countGroupMemberships(currentUserId),
      this.repo.countStoriesUploaded(currentUserId),
      this.repo.countChaptersUploaded(currentUserId),
    ]);
    const { posts, comments, comment_likes: commentLikes } = community;
    const lib = library.stats;
    const [storiesRead, chaptersRead, readingSeconds, favorites, bookmarks, albums, savedAlbums, albumSaves, followers, following] = [
      lib.stories_read, lib.chapters_read, lib.reading_seconds, lib.favorites, lib.bookmarks, lib.albums, lib.saved_albums,
      lib.album_saves_received, lib.followers, lib.following,
    ].map((n) => Number(n) || 0);

    user.stats = {
      stories_read: storiesRead,
      chapters_read: chaptersRead,
      reading_minutes: Math.round(readingSeconds / 60),
      favorites_count: favorites,
      bookmarks_count: bookmarks,
      posts_count: posts,
      comments_count: comments,
      groups_count: groups,
      albums_count: albums,
      saved_albums_count: savedAlbums,
      album_saves_received: albumSaves,
      followers_count: followers,
      following_count: following,
      stories_uploaded: storiesUploaded,
      chapters_uploaded: chaptersUploaded,
      comment_likes_received: commentLikes,
    };

    // 4. Overview blocks for the account page
    // last reads, albums, genres read most: from the library overview above
    const [groupRows, myStories] = await Promise.all([
      this.repo.groupsOfUser(currentUserId),
      this.repo.latestStoriesOfUploader(currentUserId),
    ]);
    user.recent_reads = library.recent_reads;
    user.albums = library.albums;
    user.groups = groupRows;
    user.my_stories = myStories;
    user.top_tags = library.tags;
    return user;
  }

  /**
   * Public profile of another user: only what is safe to show anyone (no email, settings,
   * reading history, bookmarks or favorites). Banned/deleted accounts are hidden except from
   * site staff, who also get a `moderation` block (status and the actions they may take; the email
   * comes from identity: GET /api/identity/users/:id/private).
   */
  async publicProfile(username: string, viewer?: Actor) {
    const viewerRoles = viewer?.roles || [];
    const isStaff = viewerRoles.includes('admin') || viewerRoles.includes('mod');

    const row = await this.repo.findPublicByUsername(String(username).slice(0, 50));
    if (!row || ((row.is_banned || row.deleted_at) && !isStaff)) {
      throw new InputError('Không tìm thấy người dùng', 404);
    }

    const [stories, groups, community] = await Promise.all([
      this.repo.approvedStoriesOfUploader(row.id),
      this.repo.approvedGroupsOfUser(row.id),
      communityStats(row.id),
    ]);

    const allRoles: string[] = row.roles.map((r: any) => r.role);
    const data: any = {
      id: row.id,
      code: row.code,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      banner_url: row.banner_url,
      bio: row.bio,
      created_at: row.created_at,
      roles: row.roles.filter((r: any) => r.is_visible !== false).map((r: any) => r.role),
      stats: {
        stories_count: stories.length,
        posts_count: community.approved_posts,
        comments_count: community.comments,
        groups_count: groups.length,
      },
      stories: stories.slice(0, 12),
      groups,
    };

    if (isStaff) {
      data.moderation = {
        roles: allRoles,
        is_banned: row.is_banned,
        ban_reason: row.ban_reason,
        banned_at: row.banned_at,
        deleted_at: row.deleted_at,
        can: moderationRights(
          { id: viewer!.id, roles: viewerRoles },
          { id: row.id, roles: allRoles, is_banned: row.is_banned, deleted_at: row.deleted_at }
        ),
      };
    }
    return data;
  }

  /** PUT /profile/me */
  async updateProfile(userId: string, body: unknown) {
    return this.repo.updateProfile(userId, parseProfileInput(body));
  }

  /** PUT /profile/me/settings */
  async updateSettings(userId: string, body: unknown) {
    return this.repo.upsertSettings(userId, parseSettingsInput(body));
  }

  /**
   * Delete-check (identity → catalog): may this account be deleted without leaving a translation group with no
   * leader? Groups live here, accounts in identity.
   */
  async deleteCheck(id: string) {
    if (!isUuid(id)) return { ok: true };
    const names = await this.repo.soleLeaderGroupNames(id);
    if (names.length > 0) {
      return {
        ok: false,
        message: `Người dùng này là Trưởng nhóm duy nhất của: ${names.join(', ')}. Hãy chỉ định Trưởng nhóm khác trước khi xóa.`,
      };
    }
    return { ok: true };
  }

  /**
   * POST /internal/users/profiles {ids?: uuid[], usernames?: string[]} (at most 500): what other services show for a
   * person (messaging: inbox, threads, group chat). Deleted accounts come back flagged, banned ones too.
   */
  profiles(body: any) {
    const ids = Array.isArray(body?.ids) ? body.ids.filter(isUuid).slice(0, 500) : [];
    const names = Array.isArray(body?.usernames) ? body.usernames.filter((u: unknown) => typeof u === 'string').slice(0, 500) : [];
    return this.repo.profilesByIdsOrNames(ids, names);
  }
}
