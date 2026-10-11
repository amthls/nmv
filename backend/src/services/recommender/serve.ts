import { pool } from '../../config/db';
import { libraryData } from '../libraryClient';

/**
 * Serving side: reads the precomputed tables (fast), mixes in what the viewer did since the
 * last training run, and turns every pick into a card with a short Vietnamese reason label.
 */

export interface Viewer { userId: string | null; visitorId: string | null }

/** Columns the story cards need (same shape as the explore/trending lists). */
const CARD_SQL = `
  SELECT s.id, s.title, s.slug, s.cover_image_url, s.story_type, s.status, s.author_name,
    s.total_chapters, s.total_views, s.total_favorites, s.last_chapter_at, s.created_at
  FROM stories s
  WHERE s.id = ANY ($1::uuid[]) AND s.approval_status = 'approved'`;

async function cards(ids: string[]) {
  if (ids.length === 0) return new Map<string, any>();
  const r = await pool.query(CARD_SQL, [ids]);
  return new Map(r.rows.map((row) => [row.id, row]));
}

const pctLabel = (p: number) => `${Math.max(1, Math.round(p * 100))}%`;

/**
 * A signed-in reader's history from the library service (stories read, reads of the last 60 days, unfinished stories).
 * Empty when the library does not answer: the picks then fall back to what everyone reads.
 */
type LibraryHistory = { read_story_ids: string[]; recent: { story_id: string; t: string }[]; continue: any[] };
const historyCache = new Map<string, { at: number; v: Promise<LibraryHistory> }>(); // one page asks 3 times
function libraryHistory(userId: string): Promise<LibraryHistory> {
  const hit = historyCache.get(userId);
  if (hit && Date.now() - hit.at < 5000) return hit.v;
  if (historyCache.size > 5000) historyCache.clear();
  const v = libraryData<LibraryHistory>(`/internal/reco/user/${userId}`, 2000).catch((err) => {
    console.warn(`[rec] reading history of ${userId} unavailable: ${err.message}`);
    return { read_story_ids: [], recent: [], continue: [] };
  });
  historyCache.set(userId, { at: Date.now(), v });
  return v;
}

/** Stories the viewer has read (signed in: history; guest: read events). */
async function readStories(v: Viewer): Promise<Set<string>> {
  if (v.userId) return new Set((await libraryHistory(v.userId)).read_story_ids);
  const r = v.visitorId
      ? await pool.query(`SELECT DISTINCT story_id FROM rec_events WHERE visitor_id = $1 AND kind = 'read'`, [v.visitorId])
      : { rows: [] as any[] };
  return new Set(r.rows.map((x: any) => x.story_id));
}

/** The viewer's latest stories (reads count more than page views), newest first. */
async function recentStories(v: Viewer, limit = 8): Promise<{ story_id: string; w: number }[]> {
  if (!v.userId && !v.visitorId) return [];
  const [history, ev] = await Promise.all([
    v.userId ? libraryHistory(v.userId).then((h) => h.recent) : Promise.resolve([]),
    pool.query(`SELECT story_id, CASE WHEN kind = 'read' THEN 1.0 ELSE 0.4 END AS w, created_at AS t
                FROM rec_events WHERE ${v.userId ? 'user_id' : 'visitor_id'} = $1 AND kind IN ('view', 'read')
                  AND created_at > NOW() - INTERVAL '60 days'`, [v.userId || v.visitorId]),
  ]);
  const byStory = new Map<string, { w: number; t: number }>();
  for (const e of [...history.map((h) => ({ story_id: h.story_id, w: 1, t: h.t })), ...ev.rows]) {
    const cur = byStory.get(e.story_id) || { w: 0, t: 0 };
    byStory.set(e.story_id, { w: cur.w + Number(e.w), t: Math.max(cur.t, new Date(e.t).getTime()) });
  }
  // newer stories weigh more
  return [...byStory.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, limit)
    .map(([story_id, x], i) => ({ story_id, w: Math.min(3, x.w) * Math.pow(0.8, i) }));
}

/** Stories started but not finished: the "continue reading" cards. */
async function continueReading(v: Viewer, limit = 3) {
  if (!v.userId) return [];
  return (await libraryHistory(v.userId)).continue.slice(0, limit);
}

/** Sum of related-story scores of the viewer's recent stories: works for guests and fresh activity. */
async function sessionCandidates(recent: { story_id: string; w: number }[]) {
  if (recent.length === 0) return new Map<string, { score: number; source: string }>();
  const weights = new Map(recent.map((r) => [r.story_id, r.w]));
  const r = await pool.query(
    `SELECT story_id, similar_id, score FROM rec_item_similar WHERE story_id = ANY ($1::uuid[])`,
    [recent.map((x) => x.story_id)],
  );
  const out = new Map<string, { score: number; source: string; best: number }>();
  for (const row of r.rows) {
    const v = (weights.get(row.story_id) || 0) * row.score;
    const cur = out.get(row.similar_id);
    if (!cur) out.set(row.similar_id, { score: v, source: row.story_id, best: v });
    else {
      cur.score += v;
      if (v > cur.best) { cur.best = v; cur.source = row.story_id; }
    }
  }
  return out;
}

/** "Đề xuất cho bạn": continue reading first, then the model's picks, then popular stories. */
export async function homeRecommendations(v: Viewer, limit = 18) {
  const [cont, read, recent] = await Promise.all([continueReading(v), readStories(v), recentStories(v)]);

  const picks = new Map<string, { score: number; reason: string; source?: string | null; tag?: string | null; pct?: number | null }>();
  if (v.userId) {
    const r = await pool.query(
      `SELECT story_id, score, reason, reason_story_id, reason_tag, pct FROM rec_user_scores WHERE user_id = $1 ORDER BY score DESC`,
      [v.userId],
    );
    for (const row of r.rows) picks.set(row.story_id, { score: row.score, reason: row.reason, source: row.reason_story_id, tag: row.reason_tag, pct: row.pct });
  }
  // what they did since the last training run (and everything, for guests)
  const session = await sessionCandidates(recent);
  const maxSession = Math.max(1e-9, ...Array.from(session.values()).map((s) => s.score));
  session.forEach((s, id) => {
    const boost = (s.score / maxSession) * (picks.size ? 0.35 : 1);
    const cur = picks.get(id);
    if (cur) cur.score += boost;
    else picks.set(id, { score: boost, reason: 'because_read', source: s.source });
  });

  const contIds = new Set(cont.map((c: any) => c.story_id));
  let ranked = Array.from(picks.entries())
    .filter(([id]) => !read.has(id) && !contIds.has(id))
    .sort((a, b) => b[1].score - a[1].score);

  // top up with popular stories
  if (ranked.length < limit) {
    const pop = await pool.query(`
      SELECT s.id FROM stories s LEFT JOIN rec_item_factors f ON f.story_id = s.id
      WHERE s.approval_status = 'approved'
      ORDER BY COALESCE(f.popularity, 0) DESC, s.total_views DESC LIMIT $1`, [limit * 2]);
    for (const row of pop.rows) {
      if (ranked.length >= limit) break;
      if (!read.has(row.id) && !contIds.has(row.id) && !picks.has(row.id)) ranked.push([row.id, { score: 0, reason: 'popular' }]);
    }
  }
  ranked = ranked.slice(0, Math.max(0, limit - cont.length));

  const sourceIds = ranked.map(([, p]) => p.source).filter(Boolean) as string[];
  const info = await cards([...cont.map((c: any) => c.story_id), ...ranked.map(([id]) => id), ...sourceIds]);
  const out: any[] = [];
  for (const c of cont) {
    const s = info.get(c.story_id);
    if (s) out.push({ ...s, rec_reason: 'continue', rec_label: `Đọc tiếp chương ${Number(c.chapter_number)}`, continue_slug: c.chapter_slug });
  }
  for (const [id, p] of ranked) {
    const s = info.get(id);
    if (!s) continue;
    const src = p.source ? info.get(p.source) : null;
    let label = 'Đang được đọc nhiều';
    let reason = p.reason;
    if (reason === 'because_read' && src) label = `Vì bạn đọc ${src.title}`;
    else if (reason === 'taste' && p.tag) label = `Hợp gu ${p.tag}`;
    else if (reason === 'similar_users' && p.pct) label = `${pctLabel(p.pct)} người cùng gu đã đọc`;
    else reason = 'popular';
    out.push({ ...s, rec_reason: reason, rec_label: label });
  }
  return { personalized: picks.size > 0 || cont.length > 0, stories: out };
}

/** "Truyện liên quan": the story's neighbours, re-ranked by the viewer's taste vector. */
export async function relatedStories(storyId: string, v: Viewer, limit = 18) {
  const [rel, read, userVec] = await Promise.all([
    pool.query(
      `SELECT r.similar_id, r.score, r.co_readers, r.pct_readers, r.covisit, r.reason, r.reason_tag, f.factors
       FROM rec_item_similar r LEFT JOIN rec_item_factors f ON f.story_id = r.similar_id
       WHERE r.story_id = $1 ORDER BY r.score DESC`, [storyId]),
    readStories(v),
    v.userId ? pool.query('SELECT factors FROM rec_user_factors WHERE user_id = $1', [v.userId]) : Promise.resolve({ rows: [] as any[] }),
  ]);
  let rows = rel.rows;

  // Cold start (story too new for the model): same genres / type, most read first
  if (rows.length === 0) {
    const fb = await pool.query(`
      SELECT s.id AS similar_id, count(st2.tag_id)::real AS score, min(t.name) AS reason_tag
      FROM stories base
      JOIN stories s ON s.id <> base.id AND s.approval_status = 'approved'
      LEFT JOIN story_tags st1 ON st1.story_id = base.id
      LEFT JOIN story_tags st2 ON st2.story_id = s.id AND st2.tag_id = st1.tag_id
      LEFT JOIN tags t ON t.id = st2.tag_id
      WHERE base.id = $1
      GROUP BY s.id, s.story_type, base.story_type, s.total_views
      ORDER BY count(st2.tag_id) DESC, (s.story_type = base.story_type) DESC, s.total_views DESC
      LIMIT $2`, [storyId, limit * 2]);
    rows = fb.rows.map((r) => ({ ...r, co_readers: 0, pct_readers: 0, covisit: 0, reason: r.reason_tag ? 'content' : 'popular' }));
  }

  const u: number[] | null = userVec.rows[0]?.factors || null;
  if (u) {
    // personal taste nudges the order: 80% "what readers of this story read", 20% "what you like"
    const prefs = rows.map((r) => (r.factors ? r.factors.reduce((s: number, f: number, i: number) => s + f * u[i], 0) : 0));
    const lo = Math.min(...prefs), hi = Math.max(...prefs);
    const maxScore = Math.max(1e-9, ...rows.map((r) => r.score));
    rows = rows.map((r, i) => ({ ...r, final: 0.8 * (r.score / maxScore) + 0.2 * (hi > lo ? (prefs[i] - lo) / (hi - lo) : 0) }))
      .sort((a, b) => b.final - a.final);
  }
  // hide what the viewer already read, unless that would leave the row nearly empty
  const unread = rows.filter((r) => !read.has(r.similar_id) && r.similar_id !== storyId);
  rows = (unread.length >= 6 ? unread : rows.filter((r) => r.similar_id !== storyId)).slice(0, limit);

  const info = await cards(rows.map((r) => r.similar_id));
  const out: any[] = [];
  for (const r of rows) {
    const s = info.get(r.similar_id);
    if (!s) continue;
    let label: string;
    if (r.reason === 'co_read' && r.co_readers > 0) label = `${pctLabel(r.pct_readers)} người đọc truyện này cũng đọc`;
    else if (r.reason === 'next_read') label = 'Thường được đọc tiếp theo';
    else if (r.reason === 'same_author') label = 'Cùng tác giả';
    else if (r.reason_tag) label = `Cùng thể loại ${r.reason_tag}`;
    else if (r.reason === 'popular') label = 'Đang được đọc nhiều';
    else label = 'Nội dung tương tự';
    out.push({ ...s, rec_reason: r.reason, rec_label: label });
  }
  return { stories: out };
}
