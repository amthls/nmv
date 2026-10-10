import '../config/env';
import crypto from 'crypto';
import { pool } from '../config/db';
import { rng } from '../services/recommender/algorithms';

/**
 * Simulated readers, so the recommender has behaviour to learn from on a fresh install.
 *
 *   docker exec novel_backend node dist/scripts/simulateReaders.js            # 200 readers + 150 guests
 *   docker exec novel_backend node dist/scripts/simulateReaders.js --users=400
 *   docker exec novel_backend node dist/scripts/simulateReaders.js --clear    # remove all of it
 *
 * Accounts are `sim_reader_###` with an unknown random password (nobody can sign in as them).
 * Each has a taste (1-2 genre families + manga/novel preference) and reads in sessions: after a
 * story they often pick a similar one next, which is the pattern co-visitation should find.
 * Re-running replaces the previous simulation. Their favorites update story counters
 * through the usual triggers, and --clear rolls those back the same way.
 */

const USER_PREFIX = 'sim_reader_';
const GUEST_PREFIX = 'sim';

const FAMILIES: Record<string, string[]> = {
  fantasy: ['fantasy', 'isekai', 'magic', 'reincarnation', 'op-mc', 'system', 'adventure', 'monsters'],
  romance: ['romance', 'comedy', 'school-life', 'slice-of-life', 'harem', 'drama'],
  action: ['action', 'shounen', 'martial-arts', 'gore'],
  dark: ['seinen', 'psychological', 'horror', 'supernatural', 'sci-fi'],
};
const FAMILY_NAMES = Object.keys(FAMILIES);

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`));
const hashNum = (s: string) => parseInt(crypto.createHash('md5').update(s).digest('hex').slice(0, 8), 16);

async function clear() {
  const users = await pool.query(`DELETE FROM users WHERE username LIKE $1 RETURNING id`, [`${USER_PREFIX}%`]);
  const guests = await pool.query(`DELETE FROM rec_events WHERE visitor_id LIKE $1`, [`${GUEST_PREFIX}%`]);
  console.log(`Removed ${users.rowCount} simulated readers and ${guests.rowCount} simulated guest events.`);
}

interface SimStory { id: string; type: string; family: string; quality: number; chapters: { id: string; n: number }[] }

async function loadStories(): Promise<SimStory[]> {
  const r = await pool.query(`
    SELECT s.id, s.story_type,
      COALESCE(array_agg(DISTINCT t.slug) FILTER (WHERE t.id IS NOT NULL), '{}') AS tags,
      COALESCE((SELECT json_agg(json_build_object('id', c.id, 'n', c.chapter_number) ORDER BY c.chapter_number)
                FROM chapters c WHERE c.story_id = s.id AND c.is_published), '[]') AS chapters
    FROM stories s
    LEFT JOIN story_tags st ON st.story_id = s.id
    LEFT JOIN tags t ON t.id = st.tag_id
    WHERE s.approval_status = 'approved'
    GROUP BY s.id`);
  const rand = rng(7);
  return r.rows.filter((row) => row.chapters.length > 0).map((row) => {
    // genre family from the tags; untagged stories get a stable pseudo-random one
    const counts = FAMILY_NAMES.map((f) => row.tags.filter((t: string) => FAMILIES[f].includes(t)).length);
    const best = Math.max(...counts);
    const family = best > 0 ? FAMILY_NAMES[counts.indexOf(best)] : FAMILY_NAMES[hashNum(row.id) % FAMILY_NAMES.length];
    // some stories are simply more popular than others (long tail)
    const quality = Math.exp((rand() - 0.5) * 2.2);
    return { id: row.id, type: row.story_type, family, quality, chapters: row.chapters };
  });
}

interface Persona { main: string; second: string | null; type: 'manga' | 'novel' | null; activity: number }

function affinity(p: Persona, s: SimStory) {
  let a = s.family === p.main ? 1.6 : s.family === p.second ? 0.9 : 0;
  if (p.type) a += s.type === p.type ? 0.6 : -0.6;
  return a;
}

function weightedPick<T>(items: T[], weight: (x: T) => number, rand: () => number): T | null {
  const ws = items.map(weight);
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let x = rand() * total;
  for (let i = 0; i < items.length; i++) { x -= ws[i]; if (x <= 0) return items[i]; }
  return items[items.length - 1];
}

async function simulate(nUsers: number, nGuests: number) {
  await clear();
  const stories = await loadStories();
  if (stories.length < 5) throw new Error('Cần ít nhất 5 truyện đã duyệt có chương để mô phỏng.');
  const rand = rng(20261008);
  const now = Date.now();

  const hist: [string, string, string, Date, number][] = []; // user, story, chapter, read_at, seconds
  const favs: [string, string, Date][] = [];
  const events: [string | null, string | null, string, string | null, string, Date][] = [];

  /** One reader's sessions: returns the stories read, in order. */
  const readSessions = (p: Persona, emit: (s: SimStory, chapters: { id: string; n: number }[], t: number) => void) => {
    const nStories = Math.max(2, Math.round(p.activity));
    const read = new Set<string>();
    let t = now - (5 + rand() * 85) * 86_400_000;
    let prev: SimStory | null = null;
    for (let k = 0; k < nStories && t < now - 600_000; k++) {
      const pool = stories.filter((s) => !read.has(s.id));
      // "up next": often a story like the one just finished
      const followUp = prev && rand() < 0.55;
      const pick = weightedPick(pool, (s) => {
        let w = Math.exp(1.6 * affinity(p, s)) * s.quality;
        if (followUp && prev) w *= s.family === prev.family ? 6 : 0.3;
        return w;
      }, rand);
      if (!pick) break;
      read.add(pick.id);
      const aff = affinity(p, pick);
      const full = rand() < (aff > 1.5 ? 0.75 : 0.35);
      const nCh = full ? pick.chapters.length : 1 + Math.floor(rand() * pick.chapters.length);
      emit(pick, pick.chapters.slice(0, nCh), t);
      t += (nCh * (5 + rand() * 20) + 5 + rand() * 120) * 60_000;
      if (rand() < 0.3) t += (1 + rand() * 3) * 86_400_000; // new session another day
      prev = pick;
    }
    return read;
  };

  const persona = (): Persona => {
    const main = FAMILY_NAMES[Math.floor(rand() * FAMILY_NAMES.length)];
    const others = FAMILY_NAMES.filter((f) => f !== main);
    const tr = rand();
    return {
      main,
      second: rand() < 0.4 ? others[Math.floor(rand() * others.length)] : null,
      type: tr < 0.4 ? 'manga' : tr < 0.7 ? 'novel' : null,
      activity: 3 + Math.pow(rand(), 1.8) * 20, // most read a few stories, some read a lot
    };
  };

  // 1. Accounts
  const userIds: string[] = [];
  for (let i = 1; i <= nUsers; i++) {
    const name = `${USER_PREFIX}${String(i).padStart(3, '0')}`;
    const ins = await pool.query(
      `INSERT INTO users (username, display_name, bio, created_at)
       VALUES ($1, $2, $3, NOW() - INTERVAL '120 days') RETURNING id`,
      [name, `Độc giả mô phỏng ${String(i).padStart(3, '0')}`,
        'Tài khoản mô phỏng, dùng để huấn luyện hệ thống gợi ý truyện.'],
    );
    userIds.push(ins.rows[0].id);
  }
  await pool.query(`INSERT INTO user_roles (user_id, role) SELECT unnest($1::uuid[]), 'reader' ON CONFLICT DO NOTHING`, [userIds]);

  // 2. Signed-in reading behaviour
  for (const userId of userIds) {
    const p = persona();
    readSessions(p, (s, chapters, t) => {
      events.push([userId, null, s.id, null, 'view', new Date(t - 60_000)]);
      chapters.forEach((c, i) => hist.push([userId, s.id, c.id, new Date(t + i * 12 * 60_000), Math.round(240 + rand() * 900)]));
      const aff = affinity(p, s);
      if (aff > 1.5 && rand() < 0.35) favs.push([userId, s.id, new Date(t)]);
    });
    // browsing: opened a few story pages without reading
    for (let b = 0; b < 2; b++) {
      const s = weightedPick(stories, (x) => Math.exp(affinity(p, x)) * x.quality, rand);
      if (s) events.push([userId, null, s.id, null, 'view', new Date(now - rand() * 60 * 86_400_000)]);
    }
  }

  // 3. Guests (anonymous visitor ids): views and chapter reads only
  for (let g = 0; g < nGuests; g++) {
    const vid = `${GUEST_PREFIX}${crypto.randomBytes(14).toString('hex')}`.slice(0, 32);
    const p = { ...persona(), activity: 2 + rand() * 5 };
    readSessions(p, (s, chapters, t) => {
      events.push([null, vid, s.id, null, 'view', new Date(t - 60_000)]);
      chapters.forEach((c, i) => events.push([null, vid, s.id, c.id, 'read', new Date(t + i * 12 * 60_000)]));
    });
  }

  // 4. Bulk insert
  const bulk = async (sql: string, rows: any[][], types: string[]) => {
    for (let off = 0; off < rows.length; off += 5000) {
      const chunk = rows.slice(off, off + 5000);
      await pool.query(sql, types.map((_, c) => chunk.map((r) => r[c])));
    }
  };
  await bulk(`INSERT INTO reading_history (user_id, story_id, chapter_id, read_at, time_spent_seconds)
              SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::timestamptz[], $5::int[]) ON CONFLICT DO NOTHING`,
    hist, ['uuid', 'uuid', 'uuid', 'timestamptz', 'int']);
  await bulk(`INSERT INTO user_favorites (user_id, story_id, category, created_at)
              SELECT u, s, 'reading', t FROM unnest($1::uuid[], $2::uuid[], $3::timestamptz[]) AS x(u, s, t) ON CONFLICT DO NOTHING`,
    favs, ['uuid', 'uuid', 'timestamptz']);
  await bulk(`INSERT INTO rec_events (user_id, visitor_id, story_id, chapter_id, kind, created_at)
              SELECT * FROM unnest($1::uuid[], $2::varchar[], $3::uuid[], $4::uuid[], $5::varchar[], $6::timestamptz[])`,
    events, ['uuid', 'varchar', 'uuid', 'uuid', 'varchar', 'timestamptz']);

  console.log(`Simulated ${nUsers} readers + ${nGuests} guests over ${stories.length} stories: ` +
    `${hist.length} chapter reads, ${favs.length} follows, ${events.length} events.`);
}

(async () => {
  try {
    if (arg('clear')) await clear();
    else {
      const n = parseInt(arg('users')?.split('=')[1] || '200');
      const g = parseInt(arg('guests')?.split('=')[1] || '150');
      await simulate(n, g);
    }
  } catch (err: any) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
