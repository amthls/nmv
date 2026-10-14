import { pool } from '../../config/db';

/**
 * What an export contains, loaded from the database and normalised for the EPUB / PDF writers of the media service:
 * plain text only (no HTML), NFC Unicode, no characters that are illegal in XML.
 */

export type Block =
  | { kind: 'paragraph'; text: string; note?: string }
  | { kind: 'heading'; text: string }
  | { kind: 'separator' }
  | { kind: 'image'; url: string; note?: string };

export interface ExportChapter {
  id: string;
  title: string;
  number: number;
  updatedAt: string;
  volumeKey: string | null; // chapters of one volume share it (null: no volume)
  volumeTitle: string | null;
  blocks: Block[]; // novel
  pages: string[]; // manga page image URLs, in order
}

export interface ExportStory {
  id: string;
  title: string;
  slug: string;
  type: 'novel' | 'manga';
  author: string | null;
  artist: string | null;
  group: string | null;
  synopsis: string | null;
  coverUrl: string | null;
  updatedAt: string;
}

export interface ExportBook {
  story: ExportStory;
  chapters: ExportChapter[];
}

// ---------------------------------------------------------------------------- text helpers

// Characters XML 1.0 forbids (and lone surrogates), which would make an EPUB unreadable
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function cleanText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.normalize('NFC').replace(XML_ILLEGAL, '').replace(/\r\n?/g, '\n').replace(/[ \t ]+$/gm, '').trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** Rich text (sanitized CKEditor HTML) or plain text -> plain text with paragraph breaks. */
export function htmlToText(input: string): string {
  if (!/<\/?[a-z][^>]*>/i.test(input)) return input;
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|blockquote|figure|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

const MD_IMAGE = /^!\[[^\]]*\]\(([^)\s]+)\)$/;

/** Legacy chapters store plain text in `content` (blank-line paragraphs, markdown images). */
function blocksFromContent(content: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of htmlToText(content).split(/\n\s*\n|\n/)) {
    const line = cleanText(raw);
    if (!line) continue;
    const img = line.match(MD_IMAGE);
    if (img) blocks.push({ kind: 'image', url: img[1] });
    else if (/^(\*\s*){3,}$|^-{3,}$/.test(line)) blocks.push({ kind: 'separator' });
    else blocks.push({ kind: 'paragraph', text: line });
  }
  return blocks;
}

function blocksFromJson(items: any[]): Block[] {
  const blocks: Block[] = [];
  for (const b of items) {
    if (!b || typeof b !== 'object') continue;
    const text = cleanText(htmlToText(typeof b.text === 'string' ? b.text : ''));
    const note = cleanText(b.note) || undefined;
    if (b.type === 'separator') {
      blocks.push({ kind: 'separator' });
      continue;
    }
    if (b.type === 'heading' && text) {
      blocks.push({ kind: 'heading', text });
      continue;
    }
    if (text) {
      // one block may hold several paragraphs typed with line breaks
      const parts = text.split(/\n+/).map((t) => t.trim()).filter(Boolean);
      parts.forEach((t, i) => blocks.push({ kind: 'paragraph', text: t, note: i === parts.length - 1 && !b.image_url ? note : undefined }));
    }
    if (typeof b.image_url === 'string' && b.image_url && b.image_url !== 'placeholder') {
      blocks.push({ kind: 'image', url: b.image_url, note }); // the line's note goes under its picture
    } else if (!text && note) {
      blocks.push({ kind: 'paragraph', text: '', note });
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------- loading

export const MAX_EXPORT_CHAPTERS = 1000;
export const MAX_EXPORT_PAGES = 4000; // manga pages in one request

/**
 * Published chapters of an approved story, in reading order (volume order, then chapter number),
 * each with a fingerprint of what ends up in the file. `updated_at` cannot be used for that: a
 * trigger bumps it on every view-count update, which would rebuild the file after each read.
 */
export async function listExportableChapters(storyId: string, chapterIds: string[] | null) {
  const res = await pool.query(
    `SELECT c.id, c.chapter_number,
            md5(concat_ws(E'\\x1f', c.title, c.chapter_number::text, c.content, c.content_blocks::text, v.id::text, v.title, v.volume_number::text,
                (SELECT string_agg(p.image_url, ',' ORDER BY p.page_number) FROM chapter_pages p WHERE p.chapter_id = c.id))) AS fingerprint,
            (SELECT count(*) FROM chapter_pages p WHERE p.chapter_id = c.id)::int AS page_count
       FROM chapters c
       LEFT JOIN volumes v ON v.id = c.volume_id
      WHERE c.story_id = $1 AND c.is_published = true
        AND ($2::uuid[] IS NULL OR c.id = ANY($2::uuid[]))
      ORDER BY v.volume_number ASC NULLS LAST, v.sort_order ASC, c.chapter_number ASC`,
    [storyId, chapterIds]
  );
  return res.rows as { id: string; chapter_number: string; fingerprint: string; page_count: number }[];
}

/** Fingerprint of the story fields printed in the file (title page, cover, metadata). */
export async function storyFingerprint(storyId: string): Promise<string> {
  const res = await pool.query(
    `SELECT md5(concat_ws(E'\\x1f', s.title, s.story_type::text, s.author_name, s.artist_name, s.synopsis, s.cover_image_url, g.name)) AS f
       FROM stories s LEFT JOIN translation_groups g ON g.id = s.group_id WHERE s.id = $1`,
    [storyId]
  );
  return res.rows[0]?.f || '';
}

export async function loadBook(storyId: string, chapterIds: string[]): Promise<ExportBook> {
  const sRes = await pool.query(
    `SELECT s.id, s.title, s.slug, s.story_type, s.author_name, s.artist_name, s.synopsis,
            s.cover_image_url, s.updated_at, g.name AS group_name
       FROM stories s LEFT JOIN translation_groups g ON g.id = s.group_id
      WHERE s.id = $1`,
    [storyId]
  );
  const s = sRes.rows[0];
  if (!s) throw new Error('Truyện không tồn tại.');
  const story: ExportStory = {
    id: s.id,
    title: cleanText(s.title) || 'Không tên',
    slug: s.slug,
    type: s.story_type === 'manga' ? 'manga' : 'novel',
    author: cleanText(s.author_name) || null,
    artist: cleanText(s.artist_name) || null,
    group: cleanText(s.group_name) || null,
    synopsis: s.synopsis ? cleanText(htmlToText(s.synopsis)) || null : null,
    coverUrl: s.cover_image_url || null,
    updatedAt: new Date(s.updated_at).toISOString(),
  };

  const cRes = await pool.query(
    `SELECT c.id, c.title, c.chapter_number, c.content, c.content_blocks, c.updated_at,
            v.id AS volume_id, v.title AS volume_title, v.volume_number
       FROM chapters c LEFT JOIN volumes v ON v.id = c.volume_id
      WHERE c.story_id = $1 AND c.is_published = true AND c.id = ANY($2::uuid[])
      ORDER BY v.volume_number ASC NULLS LAST, v.sort_order ASC, c.chapter_number ASC`,
    [storyId, chapterIds]
  );
  const pagesRes = story.type === 'manga'
    ? await pool.query(
        `SELECT chapter_id, image_url FROM chapter_pages WHERE chapter_id = ANY($1::uuid[]) ORDER BY chapter_id, page_number`,
        [chapterIds]
      )
    : { rows: [] as any[] };
  const pagesBy = new Map<string, string[]>();
  for (const p of pagesRes.rows) {
    if (!pagesBy.has(p.chapter_id)) pagesBy.set(p.chapter_id, []);
    pagesBy.get(p.chapter_id)!.push(p.image_url);
  }

  const chapters: ExportChapter[] = cRes.rows.map((c: any) => {
    const blocks = Array.isArray(c.content_blocks) && c.content_blocks.length > 0
      ? blocksFromJson(c.content_blocks)
      : blocksFromContent(c.content || '');
    let pages = pagesBy.get(c.id) || [];
    if (story.type === 'manga' && pages.length === 0) {
      pages = blocks.filter((b): b is Extract<Block, { kind: 'image' }> => b.kind === 'image').map((b) => b.url);
    }
    const number = Number(c.chapter_number);
    const volumeTitle = c.volume_id
      ? cleanText(c.volume_title) || `Tập ${c.volume_number}`
      : null;
    return {
      id: c.id,
      title: cleanText(c.title) || `Chương ${number}`,
      number,
      updatedAt: new Date(c.updated_at).toISOString(),
      volumeKey: c.volume_id || null,
      volumeTitle,
      blocks,
      pages,
    };
  });
  return { story, chapters };
}
