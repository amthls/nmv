import { pool } from '../../config/db';
import {
  AlsModel, ContentDoc, Interaction, ItemSim, coVisitation, contentSimilarity, dot, itemCosine, rankMetrics, trainAls,
} from './algorithms';

/**
 * Training job: reads every behaviour signal, fits the models and writes the precomputed
 * results (rec_item_similar, rec_user_scores, factors). Runs in the worker on a timer and on
 * demand for admins; a Postgres advisory lock keeps two runs from overlapping.
 */

const LOCK_KEY = 74_201_001;
const HISTORY_DAYS = 180;
const HALF_LIFE_DAYS = 120;
const RELATED_PER_STORY = 30;
const RECS_PER_USER = 40;
const EVAL_MAX_ACTORS = 400;

interface StoryInfo {
  id: string;
  title: string;
  author: string | null;
  tags: { slug: string; name: string }[];
  totalChapters: number;
}

interface Pair {
  readChapters: number;
  readSeconds: number;
  views: number;
  favorite: boolean;
  album: boolean;
  bookmarks: number;
  last: number;
}

interface Dataset {
  actors: string[]; // 'u:<user uuid>' | 'v:<visitor id>'
  items: StoryInfo[];
  interactions: Interaction[];
  readSets: Set<number>[]; // stories each actor actually read (not just opened)
  readOrder: number[][]; // stories read, oldest first (the last one is held out when validating)
  timelines: { item: number; t: number }[][];
  docs: ContentDoc[];
}

// ------------------------------------------------------------------ data

/** How much one actor cares about one story, from everything they did with it. */
function preference(p: Pair, totalChapters: number, now: number): number {
  let r = 0;
  if (p.readChapters > 0) {
    const completion = Math.min(1, p.readChapters / Math.max(1, totalChapters));
    r += 1 + 1.5 * Math.log2(1 + p.readChapters) + 2 * completion + Math.min(p.readSeconds / 900, 2);
  }
  r += Math.min(p.views * 0.4, 1.2);
  if (p.favorite) r += 2.5;
  if (p.album) r += 2;
  r += Math.min(p.bookmarks * 0.5, 1.5);
  if (r <= 0) return 0;
  const ageDays = (now - p.last) / 86_400_000;
  return r * Math.max(0.25, Math.pow(0.5, ageDays / HALF_LIFE_DAYS));
}

async function loadDataset(): Promise<Dataset> {
  const storyRes = await pool.query(`
    SELECT s.id, s.title, s.story_type, s.author_name, s.group_id, s.synopsis, COALESCE(s.total_chapters, 0) AS total_chapters,
      COALESCE(json_agg(json_build_object('slug', t.slug, 'name', t.name)) FILTER (WHERE t.id IS NOT NULL), '[]') AS tags
    FROM stories s
    LEFT JOIN story_tags st ON st.story_id = s.id
    LEFT JOIN tags t ON t.id = st.tag_id
    WHERE s.approval_status = 'approved'
    GROUP BY s.id
    ORDER BY s.created_at, s.id
  `);
  const items: StoryInfo[] = storyRes.rows.map((r) => ({
    id: r.id, title: r.title, author: r.author_name, tags: r.tags, totalChapters: Number(r.total_chapters),
  }));
  const docs: ContentDoc[] = storyRes.rows.map((r) => ({
    tags: r.tags.map((t: any) => t.slug), type: r.story_type, author: r.author_name, group: r.group_id,
    text: `${r.title} ${r.synopsis || ''}`,
  }));
  const itemIndex = new Map(items.map((s, i) => [s.id, i]));

  const pairs = new Map<string, Map<number, Pair>>();
  const pairOf = (actor: string, storyId: string): Pair | null => {
    const item = itemIndex.get(storyId);
    if (item === undefined) return null;
    let m = pairs.get(actor);
    if (!m) pairs.set(actor, (m = new Map()));
    let p = m.get(item);
    if (!p) m.set(item, (p = { readChapters: 0, readSeconds: 0, views: 0, favorite: false, album: false, bookmarks: 0, last: 0 }));
    return p;
  };
  const touch = (p: Pair, t: any) => { p.last = Math.max(p.last, new Date(t).getTime() || 0); };

  const since = `NOW() - INTERVAL '${HISTORY_DAYS} days'`;
  const [reads, events, favs, albums, bms, timelineRes] = await Promise.all([
    pool.query(`SELECT user_id, story_id, count(*)::int AS n, COALESCE(sum(time_spent_seconds), 0)::int AS secs, max(read_at) AS last
                FROM reading_history WHERE read_at > ${since} GROUP BY 1, 2`),
    // signed-in reads are already in reading_history; from events take their views, and everything for guests
    pool.query(`SELECT COALESCE('u:' || user_id::text, 'v:' || visitor_id) AS actor, story_id, kind,
                       count(*)::int AS n, count(DISTINCT chapter_id)::int AS chapters, max(created_at) AS last
                FROM rec_events
                WHERE kind IN ('view', 'read') AND created_at > ${since} AND (kind = 'view' OR user_id IS NULL)
                GROUP BY 1, 2, 3`),
    pool.query(`SELECT user_id, story_id, created_at FROM user_favorites`),
    pool.query(`SELECT DISTINCT ON (a.user_id, x.story_id) a.user_id, x.story_id, x.added_at
                FROM album_stories x JOIN albums a ON a.id = x.album_id`),
    pool.query(`SELECT user_id, story_id, count(*)::int AS n, max(created_at) AS last FROM bookmarks GROUP BY 1, 2`),
    pool.query(`
      SELECT actor, story_id, t FROM (
        SELECT 'u:' || user_id::text AS actor, story_id, read_at AS t FROM reading_history WHERE read_at > ${since}
        UNION ALL
        SELECT COALESCE('u:' || user_id::text, 'v:' || visitor_id), story_id, created_at
        FROM rec_events WHERE kind IN ('view', 'read') AND created_at > ${since}
      ) e ORDER BY actor, t`),
  ]);

  for (const r of reads.rows) {
    const p = pairOf(`u:${r.user_id}`, r.story_id);
    if (p) { p.readChapters += r.n; p.readSeconds += r.secs; touch(p, r.last); }
  }
  for (const r of events.rows) {
    const p = pairOf(r.actor, r.story_id);
    if (!p) continue;
    if (r.kind === 'view') p.views += r.n;
    else p.readChapters += Math.max(1, r.chapters);
    touch(p, r.last);
  }
  for (const r of favs.rows) { const p = pairOf(`u:${r.user_id}`, r.story_id); if (p) { p.favorite = true; touch(p, r.created_at); } }
  for (const r of albums.rows) { const p = pairOf(`u:${r.user_id}`, r.story_id); if (p) { p.album = true; touch(p, r.added_at); } }
  for (const r of bms.rows) { const p = pairOf(`u:${r.user_id}`, r.story_id); if (p) { p.bookmarks += r.n; touch(p, r.last); } }

  const now = Date.now();
  const actors: string[] = [];
  const interactions: Interaction[] = [];
  const readSets: Set<number>[] = [];
  const readOrder: number[][] = [];
  const actorIndex = new Map<string, number>();
  pairs.forEach((m, actor) => {
    const list: Interaction[] = [];
    const readSet = new Set<number>();
    const reads: { item: number; t: number }[] = [];
    m.forEach((p, item) => {
      const r = preference(p, items[item].totalChapters, now);
      if (r > 0) list.push({ actor: actors.length, item, r });
      if (p.readChapters > 0) {
        readSet.add(item);
        reads.push({ item, t: p.last });
      }
    });
    if (list.length === 0) return;
    actorIndex.set(actor, actors.length);
    actors.push(actor);
    interactions.push(...list);
    readSets.push(readSet);
    readOrder.push(reads.sort((x, y) => x.t - y.t).map((x) => x.item));
  });

  const timelines: { item: number; t: number }[][] = actors.map(() => []);
  for (const r of timelineRes.rows) {
    const a = actorIndex.get(r.actor);
    const item = itemIndex.get(r.story_id);
    if (a !== undefined && item !== undefined) timelines[a].push({ item, t: new Date(r.t).getTime() });
  }

  return { actors, items, interactions, readSets, readOrder, timelines, docs };
}

// ------------------------------------------------------------------ model

interface Model {
  als: AlsModel;
  cf: ItemSim;
  popularity: number[]; // 0..1
  byActor: Interaction[][];
}

function fit(interactions: Interaction[], nActors: number, nItems: number): Model {
  const als = trainAls(interactions, nActors, nItems);
  const cf = itemCosine(interactions, nActors, nItems);
  const pop = new Array(nItems).fill(0);
  const byActor: Interaction[][] = Array.from({ length: nActors }, () => []);
  for (const d of interactions) { pop[d.item] += Math.min(d.r, 3); byActor[d.actor].push(d); }
  const maxPop = Math.max(1e-9, ...pop);
  return { als, cf, popularity: pop.map((p) => p / maxPop), byActor };
}

type Reason = 'because_read' | 'taste' | 'similar_users' | 'popular';
interface Scored { item: number; score: number; reason: Reason; source: number | null }

/** Blend weights for the personal ranking; learned per training run (see evaluateAndTune). */
export interface UserWeights { als: number; knn: number; content: number; pop: number; prior: number }
/** Blend weights for "related stories"; learned the same way. */
export interface RelatedWeights { cf: number; cov: number; content: number; pop: number; prior: number }

const DEFAULT_USER_WEIGHTS: UserWeights = { als: 0.3, knn: 0.5, content: 0.15, pop: 0.05, prior: 2 };
const DEFAULT_RELATED_WEIGHTS: RelatedWeights = { cf: 0.5, cov: 0.3, content: 0.15, pop: 0.05, prior: 6 };

/** Per-candidate signals for one actor, each scaled to 0..1, computed once and blended cheaply. */
interface Components { items: number[]; als: Float64Array; knn: Float64Array; ct: Float64Array; pop: number[]; src: Int32Array; nRead: number }

function actorComponents(model: Model, content: Map<number, number>[], actor: number, exclude: Set<number>, nItems: number): Components {
  const mine = model.byActor[actor];
  const totalR = mine.reduce((s, d) => s + d.r, 0) || 1;
  const x = model.als.X[actor];
  const als = new Float64Array(nItems);
  const knn = new Float64Array(nItems);
  const ct = new Float64Array(nItems);
  const src = new Int32Array(nItems).fill(-1);
  const best = new Float64Array(nItems);
  for (let j = 0; j < nItems; j++) als[j] = dot(x, model.als.Y[j]);
  for (const d of mine) {
    model.cf.sim[d.item].forEach((s, j) => {
      const v = d.r * s;
      knn[j] += v;
      if (v > best[j]) { best[j] = v; src[j] = d.item; }
    });
    content[d.item].forEach((s, j) => {
      ct[j] += d.r * s;
      if (src[j] === -1) src[j] = d.item;
    });
  }
  const items: number[] = [];
  for (let j = 0; j < nItems; j++) if (!exclude.has(j)) items.push(j);
  const norm = (arr: Float64Array) => {
    let lo = Infinity, hi = -Infinity;
    for (const j of items) { lo = Math.min(lo, arr[j]); hi = Math.max(hi, arr[j]); }
    const span = hi - lo;
    for (const j of items) arr[j] = span > 1e-12 ? (arr[j] - lo) / span : 0;
  };
  for (const j of items) { knn[j] /= totalR; ct[j] /= totalR; }
  norm(als); norm(knn); norm(ct);
  return { items, als, knn, ct, pop: model.popularity, src, nRead: mine.length };
}

/**
 * Personal ranking: collaborative signals (ALS, item-CF) weigh more the more we know about the
 * reader; with few stories read it leans on content and popularity (prior = stories needed for
 * the collaborative part to count half).
 */
function blendActor(c: Components, w: UserWeights): Scored[] {
  const conf = c.nRead / (c.nRead + w.prior || 1);
  return c.items.map((j) => {
    const parts = {
      als: conf * w.als * c.als[j],
      knn: conf * w.knn * c.knn[j],
      content: (conf * w.content + (1 - conf) * 0.6) * c.ct[j],
      popular: (w.pop + (1 - conf) * 0.4) * c.pop[j],
    };
    const score = parts.als + parts.knn + parts.content + parts.popular;
    const top = (Object.keys(parts) as (keyof typeof parts)[]).reduce((a, b) => (parts[a] >= parts[b] ? a : b));
    const reason: Reason = top === 'als' ? 'similar_users' : top === 'knn' ? 'because_read' : top === 'content' ? 'taste' : 'popular';
    return { item: j, score, reason, source: c.src[j] >= 0 ? c.src[j] : null };
  }).sort((a, b) => b.score - a.score);
}

/** Re-rank so the row isn't ten stories of the same kind (maximal marginal relevance). */
function diversify(list: Scored[], content: Map<number, number>[], n: number, penalty = 0.15): Scored[] {
  const pool = list.slice(0, n * 3);
  const picked: Scored[] = [];
  while (picked.length < n && pool.length) {
    let best = 0, bestVal = -Infinity;
    pool.forEach((c, idx) => {
      const redundancy = Math.max(0, ...picked.map((p) => content[p.item].get(c.item) || 0));
      const val = c.score - penalty * redundancy;
      if (val > bestVal) { bestVal = val; best = idx; }
    });
    picked.push(pool.splice(best, 1)[0]);
  }
  return picked;
}

interface RelatedParts { j: number; cf: number; cov: number; ct: number; pop: number }

/** Candidate neighbours of story i with their raw signals (cf scaled to 0..1 per story). */
function relatedParts(model: Model, content: Map<number, number>[], covisit: Map<number, number>[], i: number): RelatedParts[] {
  const maxCf = Math.max(1e-9, ...Array.from(model.cf.sim[i].values()));
  const cands = new Set<number>([...model.cf.sim[i].keys(), ...covisit[i].keys(), ...content[i].keys()]);
  cands.delete(i);
  return Array.from(cands).map((j) => ({
    j, cf: (model.cf.sim[i].get(j) || 0) / maxCf, cov: covisit[i].get(j) || 0, ct: content[i].get(j) || 0, pop: model.popularity[j],
  }));
}

function relatedScore(p: RelatedParts, readers: number, w: RelatedWeights) {
  const conf = readers / (readers + w.prior || 1);
  return {
    co_read: conf * w.cf * p.cf,
    next_read: conf * w.cov * p.cov,
    content: (conf * w.content + (1 - conf) * 0.85) * p.ct,
    pop: (w.pop + (1 - conf) * 0.15) * p.pop,
  };
}
const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------ evaluation & weight learning

function grid<T>(axes: Record<string, number[]>): T[] {
  return Object.keys(axes).reduce<Record<string, number>[]>(
    (acc, key) => acc.flatMap((partial) => axes[key].map((v) => ({ ...partial, [key]: v }))), [{}]) as unknown as T[];
}

/**
 * Leave-last-out validation: hide each reader's most recent story, train on the rest, then
 *  - personal ranking: is the hidden story in their top 10?
 *  - related: is it in the top 10 related stories of the story they read just before?
 * Every single signal is scored, and a grid of blend weights is searched; the best NDCG@10
 * weights are used for the real run (a small learning-to-rank step on top of the models).
 */
function evaluateAndTune(ds: Dataset, content: Map<number, number>[]) {
  const nItems = ds.items.length;
  const sample = ds.readOrder.map((o, a) => (o.length >= 3 ? a : -1)).filter((a) => a >= 0).slice(0, EVAL_MAX_ACTORS);
  if (sample.length < 5) return { metrics: null, userWeights: DEFAULT_USER_WEIGHTS, relatedWeights: DEFAULT_RELATED_WEIGHTS };
  const heldOut = new Map(sample.map((a) => [a, ds.readOrder[a][ds.readOrder[a].length - 1]]));
  const train = ds.interactions.filter((d) => heldOut.get(d.actor) !== d.item);
  const model = fit(train, ds.actors.length, nItems);
  // the hidden story must not leak through "read next" counts either
  const covisit = coVisitation(ds.timelines.map((tl, a) => tl.filter((e) => heldOut.get(a) !== e.item)), nItems);

  const round = (v: number) => Math.round(v * 1000) / 1000;
  const score = (ranks: number[][], targets: number[]) => {
    let recall = 0, ndcg = 0;
    ranks.forEach((r, k) => { const m = rankMetrics(r, targets[k]); recall += m.recall; ndcg += m.ndcg; });
    return { recall_at_10: round(recall / ranks.length), ndcg_at_10: round(ndcg / ranks.length) };
  };

  // --- personal ranking
  const comps = sample.map((a) => actorComponents(model, content, a, new Set(ds.readOrder[a].slice(0, -1)), nItems));
  const targets = sample.map((a) => heldOut.get(a)!);
  const rankBy = (f: (c: Components, j: number) => number) =>
    comps.map((c) => c.items.slice().sort((x, y) => f(c, y) - f(c, x)));
  const single = {
    als: score(rankBy((c, j) => c.als[j]), targets),
    knn: score(rankBy((c, j) => c.knn[j]), targets),
    content: score(rankBy((c, j) => c.ct[j]), targets),
    popularity: score(rankBy((c, j) => c.pop[j]), targets),
  };
  let userWeights = DEFAULT_USER_WEIGHTS;
  let bestUser = -1;
  for (const w of grid<UserWeights>({ als: [0, 0.2, 0.4], knn: [0.3, 0.5, 0.8], content: [0, 0.1, 0.25], pop: [0, 0.05, 0.15], prior: [0, 2, 5] })) {
    const s = score(comps.map((c) => blendActor(c, w).map((x) => x.item)), targets);
    if (s.ndcg_at_10 > bestUser) { bestUser = s.ndcg_at_10; userWeights = w; }
  }
  const blended = score(comps.map((c) => blendActor(c, userWeights).map((x) => x.item)), targets);

  // --- related stories ("read next" after the second-to-last story)
  const relCases = sample.map((a) => {
    const order = ds.readOrder[a];
    const prev = order[order.length - 2];
    return { parts: relatedParts(model, content, covisit, prev), readers: model.cf.readers[prev] || 0, target: order[order.length - 1] };
  });
  const relTargets = relCases.map((c) => c.target);
  const rankRel = (w: RelatedWeights) => relCases.map((c) =>
    c.parts.map((p) => ({ j: p.j, s: total(relatedScore(p, c.readers, w)) })).sort((x, y) => y.s - x.s).map((x) => x.j));
  let relatedWeights = DEFAULT_RELATED_WEIGHTS;
  let bestRel = -1;
  for (const w of grid<RelatedWeights>({ cf: [0.2, 0.5, 0.8], cov: [0, 0.2, 0.5], content: [0, 0.15, 0.3], pop: [0, 0.1], prior: [2, 6] })) {
    const s = score(rankRel(w), relTargets);
    if (s.ndcg_at_10 > bestRel) { bestRel = s.ndcg_at_10; relatedWeights = w; }
  }

  return {
    userWeights,
    relatedWeights,
    metrics: {
      evaluated_readers: sample.length,
      k: 10,
      home: { blend: blended, ...single, weights: userWeights },
      related: {
        blend: score(rankRel(relatedWeights), relTargets),
        co_read_only: score(rankRel({ cf: 1, cov: 0, content: 0, pop: 0, prior: 0 }), relTargets),
        next_read_only: score(rankRel({ cf: 0, cov: 1, content: 0, pop: 0, prior: 0 }), relTargets),
        content_only: score(relCases.map((c) => c.parts.slice().sort((x, y) => y.ct - x.ct).map((p) => p.j)), relTargets),
        popularity: score(relCases.map((c) => c.parts.slice().sort((x, y) => y.pop - x.pop).map((p) => p.j)), relTargets),
        weights: relatedWeights,
      },
    },
  };
}

// ------------------------------------------------------------------ outputs

function relatedRows(ds: Dataset, model: Model, content: Map<number, number>[], covisit: Map<number, number>[], w: RelatedWeights) {
  const rows: any[][] = [];
  ds.items.forEach((story, i) => {
    const readers = model.cf.readers[i] || 0;
    const scored = relatedParts(model, content, covisit, i).map((p) => {
      const parts = relatedScore(p, readers, w);
      const score = total(parts);
      const other = ds.items[p.j];
      const sameAuthor = !!story.author && !!other.author && story.author.trim().toLowerCase() === other.author.trim().toLowerCase();
      // ranking uses the learned weights; the label states the strongest evidence
      const co = model.cf.co[i].get(p.j) || 0;
      const pct = readers ? co / readers : 0;
      const reason = pct >= 0.1 && co >= 2 ? 'co_read' : p.cov >= 0.3 ? 'next_read' : sameAuthor ? 'same_author'
        : co > 0 ? 'co_read' : 'content';
      const sharedTag = story.tags.find((t) => other.tags.some((o) => o.slug === t.slug))?.name || null;
      return { j: p.j, score, co, pct, cov: p.cov, ct: p.ct, reason, sharedTag };
    }).filter((s) => s.score > 0.005).sort((a, b) => b.score - a.score).slice(0, RELATED_PER_STORY);
    for (const s of scored) {
      rows.push([story.id, ds.items[s.j].id, s.score, s.co, s.pct, s.cov, s.ct, s.reason, s.sharedTag]);
    }
  });
  return rows;
}

function userRows(ds: Dataset, model: Model, content: Map<number, number>[], w: UserWeights) {
  const rows: any[][] = [];
  const nItems = ds.items.length;
  // nearest readers by taste vector, to say "x% of readers like you read it"
  const userActors = ds.actors.map((a, i) => (a.startsWith('u:') ? i : -1)).filter((i) => i >= 0);
  const norms = model.als.X.map((x) => Math.sqrt(dot(x, x)) || 1);
  for (const a of userActors) {
    const userId = ds.actors[a].slice(2);
    const ranked = blendActor(actorComponents(model, content, a, ds.readSets[a], nItems), w);
    const top = diversify(ranked, content, RECS_PER_USER);
    const neighbours = ds.actors
      .map((_, b) => ({ b, s: b === a ? -1 : dot(model.als.X[a], model.als.X[b]) / (norms[a] * norms[b]) }))
      .sort((p, q) => q.s - p.s).slice(0, 20).map((p) => p.b);
    // the user's main genre, for "Hợp gu <tag>"
    const tagWeight = new Map<string, number>();
    for (const d of model.byActor[a]) for (const t of ds.items[d.item].tags) tagWeight.set(t.name, (tagWeight.get(t.name) || 0) + d.r);
    for (const s of top) {
      // the label is the strongest piece of evidence we can state truthfully
      const pct = neighbours.filter((b) => ds.readSets[b].has(s.item)).length / Math.max(1, neighbours.length);
      const sourceId = s.source !== null ? ds.items[s.source].id : null;
      const tag = ds.items[s.item].tags.map((t) => t.name).filter((n) => tagWeight.get(n))
        .sort((x, y) => (tagWeight.get(y) || 0) - (tagWeight.get(x) || 0))[0] || null;
      const reason = pct >= 0.3 ? 'similar_users' : sourceId ? 'because_read' : tag ? 'taste' : 'popular';
      rows.push([userId, ds.items[s.item].id, s.score, reason, reason === 'because_read' ? sourceId : null,
        reason === 'taste' ? tag : null, reason === 'similar_users' ? pct : null]);
    }
  }
  return rows;
}

async function insertRows(client: any, table: string, columns: string[], types: string[], rows: any[][]) {
  for (let off = 0; off < rows.length; off += 2000) {
    const chunk = rows.slice(off, off + 2000);
    const arrays = columns.map((_, c) => chunk.map((r) => r[c]));
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) SELECT * FROM unnest(${types.map((t, i) => `$${i + 1}::${t}[]`).join(', ')})`,
      arrays,
    );
  }
}

// ------------------------------------------------------------------ entry point

export interface TrainResult { skipped?: boolean; run_id?: number; duration_ms?: number; users?: number; stories?: number; interactions?: number; metrics?: any }

export async function trainRecommender(): Promise<TrainResult> {
  const lock = await pool.connect();
  try {
    // Transaction-scoped lock, released by the COMMIT below. A session lock would break behind
    // PgBouncer (transaction pooling): lock and unlock could land on different server connections.
    await lock.query('BEGIN');
    const got = await lock.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK_KEY]);
    if (!got.rows[0].ok) return { skipped: true };
    const started = Date.now();
    const runRes = await pool.query(`INSERT INTO rec_model_runs (status) VALUES ('running') RETURNING id`);
    const runId = runRes.rows[0].id;
    try {
      const ds = await loadDataset();
      const nItems = ds.items.length;
      const content = contentSimilarity(ds.docs);
      const { metrics, userWeights, relatedWeights } = evaluateAndTune(ds, content);
      const model = fit(ds.interactions, ds.actors.length, nItems);
      const covisit = coVisitation(ds.timelines.map((tl) => tl.sort((a, b) => a.t - b.t)), nItems);

      const related = relatedRows(ds, model, content, covisit, relatedWeights);
      const recs = userRows(ds, model, content, userWeights);
      const userFactors = ds.actors.map((a, i) => [a, i] as const).filter(([a]) => a.startsWith('u:'))
        .map(([a, i]) => [a.slice(2), Array.from(model.als.X[i])]);
      const itemFactors = ds.items.map((s, i) => [s.id, Array.from(model.als.Y[i]), model.popularity[i]]);

      // CTR of the recommendation rows over the last week, to watch the effect of changes
      const ctrRes = await pool.query(`
        SELECT source, count(*) FILTER (WHERE kind = 'impression')::int AS impressions, count(*) FILTER (WHERE kind = 'click')::int AS clicks
        FROM rec_events WHERE kind IN ('impression', 'click') AND created_at > NOW() - INTERVAL '7 days' GROUP BY source`);
      const ctr = Object.fromEntries(ctrRes.rows.map((r) => [r.source, { ...r, ctr: r.impressions ? Math.round((r.clicks / r.impressions) * 1000) / 1000 : 0 }]));

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM rec_item_similar');
        await insertRows(client, 'rec_item_similar',
          ['story_id', 'similar_id', 'score', 'co_readers', 'pct_readers', 'covisit', 'content', 'reason', 'reason_tag'],
          ['uuid', 'uuid', 'real', 'int', 'real', 'real', 'real', 'varchar', 'varchar'], related);
        await client.query('DELETE FROM rec_user_scores');
        await insertRows(client, 'rec_user_scores',
          ['user_id', 'story_id', 'score', 'reason', 'reason_story_id', 'reason_tag', 'pct'],
          ['uuid', 'uuid', 'real', 'varchar', 'uuid', 'varchar', 'real'], recs);
        await client.query('DELETE FROM rec_user_factors');
        for (const [id, f] of userFactors) {
          await client.query('INSERT INTO rec_user_factors (user_id, factors) VALUES ($1, $2::real[])', [id, f]);
        }
        await client.query('DELETE FROM rec_item_factors');
        for (const [id, f, p] of itemFactors) {
          await client.query('INSERT INTO rec_item_factors (story_id, factors, popularity) VALUES ($1, $2::real[], $3)', [id, f, p]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const duration = Date.now() - started;
      const result = {
        run_id: runId, duration_ms: duration, users: ds.actors.length, stories: nItems, interactions: ds.interactions.length,
        metrics: { ...(metrics ? { offline: metrics } : {}), ctr_7d: ctr, related_pairs: related.length, user_recs: recs.length },
      };
      await pool.query(
        `UPDATE rec_model_runs SET status = 'ok', duration_ms = $2, users = $3, stories = $4, interactions = $5, metrics = $6 WHERE id = $1`,
        [runId, duration, result.users, result.stories, result.interactions, result.metrics],
      );
      return result;
    } catch (err: any) {
      await pool.query(`UPDATE rec_model_runs SET status = 'error', error = $2, duration_ms = $3 WHERE id = $1`,
        [runId, String(err?.stack || err).slice(0, 2000), Date.now() - started]);
      throw err;
    }
  } finally {
    await lock.query('COMMIT').catch(() => {});
    lock.release();
  }
}

/** Trains shortly after start, then every REC_TRAIN_INTERVAL_MIN minutes (default 30). */
export function scheduleRecommender() {
  const minutes = Math.max(1, Number(process.env.REC_TRAIN_INTERVAL_MIN || 30));
  const run = async () => {
    try {
      const r = await trainRecommender();
      if (r.skipped) console.log('[Recommender] another run is in progress, skipped');
      else console.log(`[Recommender] trained in ${r.duration_ms}ms: ${r.users} readers, ${r.stories} stories, ${r.interactions} interactions`);
    } catch (err: any) {
      console.error('[Recommender] training failed:', err.message);
    }
  };
  setTimeout(run, 15_000).unref();
  setInterval(run, minutes * 60_000).unref();
}
