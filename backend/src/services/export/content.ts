import dns from 'dns';
import fs from 'fs';
import net from 'net';
import path from 'path';
import sharp from 'sharp';
import { pool } from '../../config/db';

/**
 * What an export contains, loaded from the database and normalised for the EPUB / PDF writers:
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

// ---------------------------------------------------------------------------- images

const UPLOAD_ROOTS = [
  path.resolve(__dirname, '../../../../uploads'),
  path.resolve(__dirname, '../../../uploads'),
  path.resolve(__dirname, '../../uploads'),
];

function localUpload(url: string): string | null {
  const rel = decodeURIComponent(url.replace(/^\/uploads\//, '').split(/[?#]/)[0]);
  for (const root of UPLOAD_ROOTS) {
    const candidate = path.resolve(root, '.' + path.sep + rel);
    if (!candidate.startsWith(root + path.sep)) return null;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const MAX_REMOTE_BYTES = 25 * 1024 * 1024;

// Remote images (e.g. a cover URL typed by a user) must not let the worker reach internal services
// (postgres, rabbitmq, search, cloud metadata...): only public addresses, re-checked on each redirect.
const PRIVATE = new net.BlockList();
for (const [net4, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) {
  PRIVATE.addSubnet(net4, bits, 'ipv4');
}
for (const [net6, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]] as const) {
  PRIVATE.addSubnet(net6, bits, 'ipv6');
}

function isPublicIp(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];
  const family = net.isIP(ip);
  if (!family) return false;
  return !PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return isPublicIp(host);
  try {
    const addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => isPublicIp(a.address));
  } catch {
    return false;
  }
}

async function fetchRemote(url: string): Promise<Buffer | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
    if (!(await isPublicHost(parsed.hostname))) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(parsed, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': 'NovelHub-export/1.0' } });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        if (!next) return null;
        current = new URL(next, parsed).toString();
        continue;
      }
      if (!res.ok || !res.body) return null;
      if (Number(res.headers.get('content-length') || 0) > MAX_REMOTE_BYTES) return null;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > MAX_REMOTE_BYTES) {
          ctrl.abort();
          return null;
        }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Raw bytes of a site image (/uploads/...) or a public http(s) image; null when unavailable. */
export async function fetchImage(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    if (url.startsWith('/uploads/')) {
      const file = localUpload(url);
      return file ? await fs.promises.readFile(file) : null;
    }
    return await fetchRemote(url);
  } catch {
    return null;
  }
}

export interface PreparedImage {
  data: Buffer; // baseline-compatible JPEG, sRGB
  width: number;
  height: number;
}

/**
 * Turn any uploaded image into JPEG pieces every EPUB reader and PDF viewer can show:
 * WebP/AVIF/PNG/GIF are re-encoded (quality 92, 4:4:4 chroma), sRGB JPEGs are kept byte for byte,
 * and very tall strips (webtoons) are cut into readable pages.
 */
export async function prepareImage(
  input: Buffer,
  opts: { maxWidth: number; sliceTall: boolean }
): Promise<PreparedImage[]> {
  const meta = await sharp(input, { failOn: 'none', limitInputPixels: 100_000_000 }).metadata();
  let width = meta.width || 0;
  let height = meta.height || 0;
  if (!width || !height) throw new Error('ảnh hỏng');
  if ((meta.orientation || 1) >= 5) [width, height] = [height, width];

  const keepAsIs =
    meta.format === 'jpeg' && (meta.space === 'srgb' || meta.space === 'b-w') && (meta.orientation || 1) === 1 &&
    width <= opts.maxWidth && !(opts.sliceTall && height > width * 3);
  if (keepAsIs) return [{ data: input, width, height }];

  const scale = width > opts.maxWidth ? opts.maxWidth / width : 1;
  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);

  const encode = (img: ReturnType<typeof sharp>) =>
    img.flatten({ background: '#ffffff' }).toColourspace('srgb')
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4', progressive: false, mozjpeg: false })
      .toBuffer();

  // Rotated, scaled, flattened full image first; slices are cut from that
  const base = sharp(input, { failOn: 'none', limitInputPixels: 100_000_000 }).rotate();
  if (!(opts.sliceTall && outH > outW * 3)) {
    const data = await encode(scale < 1 ? base.resize({ width: outW }) : base);
    return [{ data, width: outW, height: outH }];
  }

  // Webtoon strip: pages about 1.6x as tall as wide, equal heights
  const full = await (scale < 1 ? base.resize({ width: outW }) : base).png({ compressionLevel: 1 }).toBuffer();
  const count = Math.ceil(outH / (outW * 1.6));
  const sliceH = Math.ceil(outH / count);
  const pieces: PreparedImage[] = [];
  for (let top = 0; top < outH; top += sliceH) {
    const h = Math.min(sliceH, outH - top);
    const data = await encode(sharp(full).extract({ left: 0, top, width: outW, height: h }));
    pieces.push({ data, width: outW, height: h });
  }
  return pieces;
}
