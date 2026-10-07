import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool } from '../../config/db';
import { publishExportJob } from '../queue.service';
import { ExportBook, listExportableChapters, loadBook, MAX_EXPORT_CHAPTERS, MAX_EXPORT_PAGES, storyFingerprint } from './content';
import { writeEpub } from './epub';
import { writePdf } from './pdf';
import { ZipWriter } from './zip';

/**
 * EPUB / PDF export jobs.
 *
 *   API  requestExport()  -> story_exports row (cache_key = what the file contains)
 *        already built?   -> answer at once
 *        otherwise        -> RabbitMQ `novel.exports` -> export-worker -> processExport()
 *                            (broker down: run in the API process, one at a time)
 *
 * Files live in EXPORT_DIR/<export id>/ (NOT under /uploads, which is public): they are only
 * handed out by the download endpoint, after checking the story still allows downloads.
 */

export type ExportFormat = 'epub' | 'pdf';
export type ExportMode = 'merged' | 'single';

// Bump when the writers change, so files built by older code are rebuilt
const EXPORT_VERSION = 2;

export const EXPORT_DIR = process.env.EXPORT_DIR || path.resolve(__dirname, '../../../exports');
const KEEP_DAYS = Number(process.env.EXPORT_KEEP_DAYS || 7);

export class ExportRequestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const MIME: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

function uuidFrom(text: string) {
  const h = crypto.createHash('sha1').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function safeFileName(name: string, max = 120) {
  const clean = name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  return (clean.length > max ? clean.slice(0, max).trim() : clean) || 'truyen';
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, ''));

// ---------------------------------------------------------------------------- request (API side)

export async function requestExport(params: {
  storyId: string;
  format: ExportFormat;
  mode: ExportMode;
  chapterIds: string[] | null; // null = every published chapter
  userId: string | null;
}) {
  const rows = await listExportableChapters(params.storyId, params.chapterIds);
  if (rows.length === 0) throw new ExportRequestError('Không có chương nào hợp lệ để tải.');
  if (rows.length > MAX_EXPORT_CHAPTERS) {
    throw new ExportRequestError(`Mỗi lần tải tối đa ${MAX_EXPORT_CHAPTERS} chương. Hãy chọn ít chương hơn.`);
  }
  const pages = rows.reduce((s, r) => s + (r.page_count || 0), 0);
  if (pages > MAX_EXPORT_PAGES) {
    throw new ExportRequestError(`Lựa chọn có ${pages} trang ảnh, vượt giới hạn ${MAX_EXPORT_PAGES} trang mỗi lần tải. Hãy chọn ít chương hơn.`);
  }

  const cacheKey = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      v: EXPORT_VERSION,
      story: params.storyId,
      storyContent: await storyFingerprint(params.storyId),
      format: params.format,
      // one chapter is one file either way
      mode: rows.length === 1 ? 'merged' : params.mode,
      chapters: rows.map((r) => [r.id, r.fingerprint]),
    }))
    .digest('hex');

  const ins = await pool.query(
    `INSERT INTO story_exports (story_id, format, mode, chapter_ids, cache_key, requested_by)
     VALUES ($1, $2, $3, $4::uuid[], $5, $6)
     ON CONFLICT (cache_key) DO UPDATE SET last_used_at = NOW()
     RETURNING *, (xmax = 0) AS inserted`,
    [params.storyId, params.format, rows.length === 1 ? 'merged' : params.mode, rows.map((r) => r.id), cacheKey, params.userId]
  );
  let row = ins.rows[0];

  const ageMs = Date.now() - new Date(row.updated_at).getTime();
  const fileMissing = row.status === 'ready' && !(row.file_path && fs.existsSync(path.join(EXPORT_DIR, row.file_path)));
  const stale =
    (row.status === 'queued' && ageMs > 2 * 60_000) || // the job message was lost
    (row.status === 'processing' && ageMs > 15 * 60_000); // the worker died mid-way
  if (!row.inserted && (row.status === 'failed' || fileMissing || stale)) {
    const reset = await pool.query(
      `UPDATE story_exports SET status = 'queued', progress = 0, error = NULL, file_path = NULL, file_name = NULL, file_size = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [row.id]
    );
    row = { ...reset.rows[0], inserted: true };
  }
  if (row.inserted) await enqueueExport(row.id);
  return row;
}

// ---------------------------------------------------------------------------- queue hand-off

let inlineChain: Promise<void> = Promise.resolve();

export async function enqueueExport(id: string) {
  if (await publishExportJob(id)) return;
  // No broker: build it here, strictly one at a time so the API stays responsive
  inlineChain = inlineChain.then(() => processExport(id).catch(() => {}));
}

// ---------------------------------------------------------------------------- build (worker side)

export async function processExport(id: string): Promise<void> {
  const claim = await pool.query(
    `UPDATE story_exports SET status = 'processing', progress = 0, error = NULL, updated_at = NOW()
      WHERE id = $1 AND (status = 'queued' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes'))
      RETURNING *`,
    [id]
  );
  const job = claim.rows[0];
  if (!job) return; // already built, being built, or gone

  const dir = path.join(EXPORT_DIR, id);
  const started = Date.now();
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
    await fs.promises.mkdir(dir, { recursive: true });

    const book = await loadBook(job.story_id, job.chapter_ids);
    if (book.chapters.length === 0) throw new Error('Các chương đã chọn không còn tồn tại.');
    const format: ExportFormat = job.format;
    const total = book.chapters.length;

    let lastSaved = 0;
    const progress = async (done: number) => {
      if (Date.now() - lastSaved < 1000 && done < total) return;
      lastSaved = Date.now();
      const pct = Math.min(99, Math.round((done / total) * 100));
      await pool.query(`UPDATE story_exports SET progress = $2, updated_at = NOW() WHERE id = $1`, [id, pct]);
    };

    const write = (b: ExportBook, file: string, subtitle: string | undefined, uid: string, onChapterDone?: (i: number) => Promise<void>) =>
      format === 'epub'
        ? writeEpub(b, file, { identifier: uid, subtitle, onChapterDone })
        : writePdf(b, file, { subtitle, onChapterDone });

    const storyName = safeFileName(book.story.title, 100);
    let fileName: string;
    const tmp = path.join(dir, `building.${format}`);

    if (job.mode === 'merged' || total === 1) {
      const only = total === 1 ? book.chapters[0] : null;
      const first = book.chapters[0].number;
      const last = book.chapters[total - 1].number;
      fileName = only
        ? `${storyName} - ${safeFileName(only.title, 80)}.${format}`
        : `${storyName} - Chương ${fmtNum(first)}-${fmtNum(last)}.${format}`;
      await write(book, tmp, only ? only.title : undefined, uuidFrom(job.cache_key), (i) => progress(i + 1));
      await fs.promises.rename(tmp, path.join(dir, 'file'));
    } else {
      // One file per chapter, bundled in a ZIP (stored: EPUB/PDF are already compressed)
      fileName = `${storyName} - ${total} chương (${format.toUpperCase()}).zip`;
      const zip = new ZipWriter(path.join(dir, 'building.zip'));
      try {
        const width = String(total).length;
        const used = new Set<string>();
        for (let i = 0; i < total; i++) {
          const ch = book.chapters[i];
          await write({ story: book.story, chapters: [ch] }, tmp, ch.title, uuidFrom(`${job.cache_key}:${ch.id}`));
          let entry = `${String(i + 1).padStart(width, '0')}. ${safeFileName(ch.title, 90)}.${format}`;
          if (used.has(entry)) entry = entry.replace(new RegExp(`\\.${format}$`), ` (${ch.id.slice(0, 6)}).${format}`);
          used.add(entry);
          await zip.add(entry, await fs.promises.readFile(tmp), false);
          await fs.promises.unlink(tmp);
          await progress(i + 1);
        }
        await zip.finish();
      } catch (e) {
        zip.destroy();
        throw e;
      }
      await fs.promises.rename(path.join(dir, 'building.zip'), path.join(dir, 'file'));
    }

    const size = (await fs.promises.stat(path.join(dir, 'file'))).size;
    await pool.query(
      `UPDATE story_exports SET status = 'ready', progress = 100, file_name = $2, file_path = $3, file_size = $4, updated_at = NOW()
        WHERE id = $1`,
      [id, fileName, `${id}/file`, size]
    );
    console.log(`[Export] ${id} ${format}/${job.mode} ${total} chương -> ${(size / 1048576).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (err: any) {
    console.error(`[Export] ${id} failed:`, err?.stack || err);
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    await pool.query(
      `UPDATE story_exports SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`,
      [id, String(err?.message || err).slice(0, 500)]
    );
  }
}

/**
 * Called when the export worker starts. A build that was running when the previous worker died may
 * be what killed it (e.g. out of memory), so it is marked failed instead of retried forever; the
 * reader can retry it by hand. Jobs still waiting in `queued` are handed back to the queue.
 */
export async function recoverExports(): Promise<string[]> {
  await pool.query(
    `UPDATE story_exports SET status = 'failed', error = 'Quá trình tạo tệp bị gián đoạn. Hãy bấm thử lại.', updated_at = NOW()
      WHERE status = 'processing'`
  );
  const res = await pool.query(
    `UPDATE story_exports SET updated_at = NOW() WHERE status = 'queued' AND updated_at < NOW() - INTERVAL '1 minute' RETURNING id`
  );
  return res.rows.map((r: any) => r.id);
}

/** Delete files nobody downloaded for KEEP_DAYS, failed jobs, and folders without a row. */
export async function cleanupExports() {
  const old = await pool.query(
    `DELETE FROM story_exports
      WHERE last_used_at < NOW() - make_interval(days => $1::int)
         OR (status = 'failed' AND updated_at < NOW() - INTERVAL '1 day')
      RETURNING id`,
    [KEEP_DAYS]
  );
  for (const r of old.rows) await fs.promises.rm(path.join(EXPORT_DIR, r.id), { recursive: true, force: true }).catch(() => {});

  let removed = old.rows.length;
  if (fs.existsSync(EXPORT_DIR)) {
    const known = new Set((await pool.query(`SELECT id::text FROM story_exports`)).rows.map((r: any) => r.id));
    for (const name of await fs.promises.readdir(EXPORT_DIR)) {
      if (!known.has(name)) {
        await fs.promises.rm(path.join(EXPORT_DIR, name), { recursive: true, force: true }).catch(() => {});
        removed++;
      }
    }
  }
  if (removed) console.log(`[Export] cleanup: removed ${removed} old export(s)`);
}
