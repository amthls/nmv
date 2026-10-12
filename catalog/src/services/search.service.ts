import { pool } from '../config/db';
import { richTextToPlain } from '../utils/richText';
import { redis, redisReady } from '../config/redis';

/**
 * Search integration for stories, backed by Elasticsearch.
 *
 * Talks to its REST API through the built-in fetch (no extra dependency).
 * PostgreSQL stays the source of truth: Elasticsearch only resolves the free-text
 * query (`q`) into a ranked list of story ids; every other filter still runs in SQL.
 * If Elasticsearch is disabled or unreachable, callers fall back to SQL ILIKE search.
 */

const ES_URL = (process.env.SEARCH_URL || '').replace(/\/+$/, '');
const ES_INDEX = process.env.SEARCH_INDEX || 'novel_stories';
const REQUEST_TIMEOUT_MS = 3000;
// fetch() refuses credentials inside the URL, so the password goes in a header
const AUTH = process.env.SEARCH_PASSWORD
  ? { Authorization: `Basic ${Buffer.from(`${process.env.SEARCH_USER || 'elastic'}:${process.env.SEARCH_PASSWORD}`).toString('base64')}` }
  : undefined;

export const isSearchEnabled = () => ES_URL.length > 0;

async function es(method: string, path: string, body?: unknown, contentType = 'application/json') {
  const res = await fetch(`${ES_URL}${path}`, {
    method,
    headers: body === undefined ? AUTH : { ...AUTH, 'Content-Type': contentType },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err: any = new Error(`Search service ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Fold Vietnamese diacritics (incl. đ -> d) so "tien hiep" matches "Tiên Hiệp";
// the edge-ngram sub-fields give search-as-you-type prefix matching on titles,
// down to a single letter ("c" -> "Chainsaw Man").
// Bump INDEX_VERSION whenever this definition changes: the index is rebuilt on next start.
const INDEX_VERSION = 2;
const PREFIX_FIELD = { prefix: { type: 'text', analyzer: 'vi_prefix', search_analyzer: 'vi_fold' } };
const INDEX_DEFINITION = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      filter: { edge_1_20: { type: 'edge_ngram', min_gram: 1, max_gram: 20 } },
      analyzer: {
        vi_fold: { tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
        vi_prefix: { tokenizer: 'standard', filter: ['lowercase', 'asciifolding', 'edge_1_20'] },
      },
    },
  },
  mappings: {
    _meta: { version: INDEX_VERSION },
    properties: {
      title: { type: 'text', analyzer: 'vi_fold', fields: PREFIX_FIELD },
      original_title: { type: 'text', analyzer: 'vi_fold', fields: PREFIX_FIELD },
      author_name: { type: 'text', analyzer: 'vi_fold' },
      artist_name: { type: 'text', analyzer: 'vi_fold' },
      synopsis: { type: 'text', analyzer: 'vi_fold' },
      group_name: { type: 'text', analyzer: 'vi_fold' },
      tags: { type: 'text', analyzer: 'vi_fold' },
      approval_status: { type: 'keyword' },
    },
  },
};

const STORY_DOC_SQL = `
  SELECT
    s.id, s.title, s.original_title, s.author_name, s.artist_name, s.synopsis, s.approval_status,
    g.name AS group_name,
    COALESCE(array_agg(DISTINCT t.name) FILTER (WHERE t.id IS NOT NULL), '{}') AS tags
  FROM stories s
  LEFT JOIN translation_groups g ON s.group_id = g.id
  LEFT JOIN story_tags st ON st.story_id = s.id
  LEFT JOIN tags t ON t.id = st.tag_id
`;

function toDoc(row: any) {
  const { id, ...doc } = row;
  // synopsis may hold sanitized HTML from the rich-text editor; index only the visible text
  return { id, doc: { ...doc, synopsis: richTextToPlain(doc.synopsis) } };
}

async function createIndex() {
  await es('PUT', `/${ES_INDEX}`, INDEX_DEFINITION);
  console.log(`[Search] Created search index "${ES_INDEX}" (v${INDEX_VERSION})`);
}

/**
 * Make sure the index exists. With rebuildIfOutdated (full reindex only), an index built
 * from an older INDEX_DEFINITION is dropped and recreated, since analyzers can't be changed in place.
 */
async function ensureIndex(rebuildIfOutdated = false) {
  let mapping: any;
  try {
    mapping = await es('GET', `/${ES_INDEX}/_mapping`);
  } catch (err: any) {
    if (err.status !== 404) throw err;
    return createIndex();
  }
  const version = mapping?.[ES_INDEX]?.mappings?._meta?.version;
  if (rebuildIfOutdated && version !== INDEX_VERSION) {
    await es('DELETE', `/${ES_INDEX}`);
    console.log(`[Search] Index "${ES_INDEX}" is v${version ?? '?'}, rebuilding as v${INDEX_VERSION}`);
    await createIndex();
  }
}

/** Rebuild the whole index from PostgreSQL (idempotent, safe to run on every start). */
export async function reindexAllStories(): Promise<number> {
  await ensureIndex(true);
  const { rows } = await pool.query(`${STORY_DOC_SQL} GROUP BY s.id, g.id`);
  if (rows.length === 0) return 0;

  const lines: string[] = [];
  for (const row of rows) {
    const { id, doc } = toDoc(row);
    lines.push(JSON.stringify({ index: { _index: ES_INDEX, _id: id } }), JSON.stringify(doc));
  }
  const result = await es('POST', '/_bulk?refresh=true', lines.join('\n') + '\n', 'application/x-ndjson');
  if (result.errors) {
    throw new Error('Search service bulk reindex reported item errors');
  }
  return rows.length;
}

/** Start-up sync: retries in the background so the API never waits for the search service. */
export function startSearchSync() {
  if (!isSearchEnabled()) {
    console.log('[Search] SEARCH_URL not set - using SQL ILIKE search');
    return;
  }
  let attempts = 0;
  const tryOnce = async () => {
    attempts += 1;
    try {
      const count = await reindexAllStories();
      console.log(`[Search] Indexed ${count} stories into "${ES_INDEX}"`);
    } catch (err: any) {
      if (attempts >= 30) {
        console.error('[Search] Giving up on initial index sync:', err.message);
        return;
      }
      setTimeout(tryOnce, 10000).unref();
    }
  };
  tryOnce();
}

/** Upsert one story after create/update. Never throws - search must not break writes. */
export async function indexStory(storyId: string): Promise<void> {
  if (!isSearchEnabled()) return;
  try {
    const { rows } = await pool.query(`${STORY_DOC_SQL} WHERE s.id = $1 GROUP BY s.id, g.id`, [storyId]);
    if (rows.length === 0) return;
    await ensureIndex();
    const { id, doc } = toDoc(rows[0]);
    await es('PUT', `/${ES_INDEX}/_doc/${id}?refresh=true`, doc);
  } catch (err: any) {
    console.error('[Search] indexStory failed:', err.message);
  }
}

export async function removeStoryFromIndex(storyId: string): Promise<void> {
  if (!isSearchEnabled()) return;
  try {
    await es('DELETE', `/${ES_INDEX}/_doc/${storyId}?refresh=true`);
  } catch (err: any) {
    if (err.status !== 404) console.error('[Search] removeStoryFromIndex failed:', err.message);
  }
}

/*
 * Elasticsearch is a single small node (256 MB heap, 2 CPUs) and every story search goes through it, so it is shielded
 * (Plan/load.md):
 *  1. answers kept in Redis per query for 60 s: other filters, pages or sort orders on the same words never reach it;
 *  2. the same query asked by many people at once runs once (shared promise);
 *  3. at most MAX_ES_SEARCHES run at a time; a search waiting longer than QUEUE_WAIT_MS takes the SQL path instead of
 *     piling more work on ES;
 *  4. after a failure or a timeout ES is left alone for BREAKER_MS (SQL meanwhile), instead of every search waiting 3 s;
 *  5. ES itself stops a search after 1 s.
 */
const ID_CACHE_TTL_S = 60;
const MAX_ES_SEARCHES = 4;
const QUEUE_WAIT_MS = 1000;
const BREAKER_MS = 30_000;
let esSearches = 0;
const esQueue: Array<() => void> = [];
let esPausedUntil = 0;
const sharedSearches = new Map<string, Promise<string[] | null>>();

async function esSlot(): Promise<boolean> {
  if (esSearches < MAX_ES_SEARCHES) {
    esSearches += 1;
    return true;
  }
  return new Promise((resolve) => {
    const take = () => { clearTimeout(timer); esSearches += 1; resolve(true); };
    const timer = setTimeout(() => {
      const i = esQueue.indexOf(take);
      if (i >= 0) esQueue.splice(i, 1);
      resolve(false);
    }, QUEUE_WAIT_MS);
    esQueue.push(take);
  });
}

function releaseEsSlot() {
  esSearches -= 1;
  esQueue.shift()?.();
}

/**
 * Resolve a free-text query into story ids ordered by relevance.
 * Returns null when Elasticsearch is disabled, busy or failing, so the caller falls back to SQL.
 */
export async function searchStoryIds(query: string, size = 1000): Promise<string[] | null> {
  if (!isSearchEnabled() || Date.now() < esPausedUntil) return null;
  const key = `search:ids:${size}:${query.toLowerCase().replace(/\s+/g, ' ')}`;
  try {
    const hit = redis && redisReady() ? await redis.get(key) : null;
    if (hit) return JSON.parse(hit);
  } catch { /* no cache: ask ES */ }
  const shared = sharedSearches.get(key);
  if (shared) return shared;
  const run = (async () => {
    if (!(await esSlot())) {
      console.warn('[Search] Elasticsearch busy, using SQL search for this query');
      return null;
    }
    try {
      const ids = await runEsSearch(query, size);
      if (ids && redis && redisReady()) redis.set(key, JSON.stringify(ids), 'EX', ID_CACHE_TTL_S).catch(() => {});
      return ids;
    } finally {
      releaseEsSlot();
    }
  })().finally(() => sharedSearches.delete(key));
  sharedSearches.set(key, run);
  return run;
}

async function runEsSearch(query: string, size: number): Promise<string[] | null> {
  try {
    const result = await es('POST', `/${ES_INDEX}/_search`, {
      size,
      timeout: '1s',
      _source: false,
      query: {
        bool: {
          should: [
            // Exact (diacritic-insensitive) match on every field, all words required
            {
              multi_match: {
                query,
                type: 'best_fields',
                operator: 'and',
                fields: ['title^4', 'original_title^3', 'author_name^2', 'artist_name^2', 'tags^1.5', 'group_name', 'synopsis'],
              },
            },
            // Typo tolerance only on short name fields; on long text (synopsis) it matches unrelated words.
            // AUTO:4,7 = no typos under 4 letters ("cha" must not match "cua"), 1 up to 7, then 2;
            // the first letter must be right, which also keeps fuzzy expansion cheap.
            {
              multi_match: {
                query,
                type: 'best_fields',
                operator: 'and',
                fuzziness: 'AUTO:4,7',
                prefix_length: 1,
                fields: ['title^2', 'original_title^1.5', 'author_name', 'artist_name'],
              },
            },
            // Search-as-you-type: every word is a prefix of a title word ("c", "chainsaw m")
            {
              multi_match: {
                query,
                type: 'best_fields',
                operator: 'and',
                fields: ['title.prefix^2', 'original_title.prefix'],
              },
            },
            // Titles containing the typed text in order rank first ("chainsaw m" -> "Chainsaw Man")
            { match_phrase_prefix: { title: { query, boost: 3 } } },
          ],
          minimum_should_match: 1,
        },
      },
    });
    if (result.timed_out) throw new Error('search timed out (partial results)');
    return (result.hits?.hits ?? []).map((h: any) => h._id as string);
  } catch (err: any) {
    esPausedUntil = Date.now() + BREAKER_MS;
    console.error(`[Search] Query failed, SQL search for the next ${BREAKER_MS / 1000}s:`, err.message);
    return null;
  }
}
