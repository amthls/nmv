import { pool } from '../config/db';
import { richTextToPlain } from '../utils/richText';

/**
 * Search integration for stories, backed by the in-house Go search service
 * (see /search-service) instead of Elasticsearch.
 *
 * Talks to its REST API through the built-in fetch (no extra dependency). The service
 * exposes the same narrow surface Elasticsearch did (index HEAD/PUT, _bulk, _doc, _search),
 * so this client and its query shapes are unchanged from the original ES integration.
 * PostgreSQL stays the source of truth: the search service only resolves the free-text
 * query (`q`) into a ranked list of story ids; every other filter still runs in SQL.
 * If the search service is disabled or unreachable, callers fall back to SQL ILIKE search.
 */

const ES_URL = (process.env.SEARCH_URL || '').replace(/\/+$/, '');
const ES_INDEX = process.env.SEARCH_INDEX || 'novel_stories';
const REQUEST_TIMEOUT_MS = 3000;

export const isSearchEnabled = () => ES_URL.length > 0;

async function es(method: string, path: string, body?: unknown, contentType = 'application/json') {
  const res = await fetch(`${ES_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': contentType },
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
// the edge-ngram sub-field gives search-as-you-type prefix matching on titles.
const INDEX_DEFINITION = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      filter: { edge_2_15: { type: 'edge_ngram', min_gram: 2, max_gram: 15 } },
      analyzer: {
        vi_fold: { tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
        vi_prefix: { tokenizer: 'standard', filter: ['lowercase', 'asciifolding', 'edge_2_15'] },
      },
    },
  },
  mappings: {
    properties: {
      title: {
        type: 'text',
        analyzer: 'vi_fold',
        fields: { prefix: { type: 'text', analyzer: 'vi_prefix', search_analyzer: 'vi_fold' } },
      },
      original_title: { type: 'text', analyzer: 'vi_fold' },
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

async function ensureIndex() {
  try {
    await es('HEAD', `/${ES_INDEX}`);
  } catch (err: any) {
    // HEAD on a missing index returns 404 with an empty body
    if (err.status !== 404) throw err;
    await es('PUT', `/${ES_INDEX}`, INDEX_DEFINITION);
    console.log(`[Search] Created search index "${ES_INDEX}"`);
  }
}

/** Rebuild the whole index from PostgreSQL (idempotent, safe to run on every start). */
export async function reindexAllStories(): Promise<number> {
  await ensureIndex();
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

/**
 * Resolve a free-text query into story ids ordered by relevance.
 * Returns null when Elasticsearch is disabled or fails, so the caller can fall back to SQL.
 */
export async function searchStoryIds(query: string, size = 1000): Promise<string[] | null> {
  if (!isSearchEnabled()) return null;
  try {
    const result = await es('POST', `/${ES_INDEX}/_search`, {
      size,
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
            // Typo tolerance only on short name fields; on long text (synopsis) it matches unrelated words
            {
              multi_match: {
                query,
                type: 'best_fields',
                operator: 'and',
                fuzziness: 'AUTO',
                fields: ['title^2', 'original_title^1.5', 'author_name', 'artist_name'],
              },
            },
            { match: { 'title.prefix': { query, operator: 'and', boost: 2 } } },
          ],
          minimum_should_match: 1,
        },
      },
    });
    return (result.hits?.hits ?? []).map((h: any) => h._id as string);
  } catch (err: any) {
    console.error('[Search] Query failed, falling back to SQL search:', err.message);
    return null;
  }
}
