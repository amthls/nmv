import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { ExportBook, fetchImage, prepareImage } from './content';
import { FONT_DIR, FONT_FILES } from './epub';
import { textWriter } from './pdfText';

/**
 * PDF writer (pdfkit).
 *   novel -> A5 pages, Literata embedded (subset per file, full Vietnamese), page numbers,
 *            bookmarks per volume/chapter, translator notes, illustrations
 *   manga -> one PDF page per image at the image's own size (JPEG bytes embedded as-is)
 */

const A5: [number, number] = [419.53, 595.28];
const MARGIN = { top: 54, bottom: 58, left: 48, right: 48 };
const BODY_SIZE = 11;
const PX_TO_PT = 0.75; // 96 dpi screen pixels -> points
const GOLD = '#a8790f';

export interface PdfOptions {
  subtitle?: string;
  onChapterDone?: (index: number) => Promise<void> | void;
}

/** pdfkit buffers whatever the file stream has not taken yet; wait when it piles up (big manga). */
async function relieve(doc: PDFKit.PDFDocument) {
  const state = (doc as any)._readableState;
  while (state && state.length > 16 * 1024 * 1024) await new Promise((r) => setTimeout(r, 5));
}

export async function writePdf(book: ExportBook, outPath: string, opts: PdfOptions = {}): Promise<void> {
  const { story, chapters } = book;
  const isManga = story.type === 'manga';
  const title = opts.subtitle ? `${story.title} – ${opts.subtitle}` : story.title;

  const doc = new PDFDocument({
    autoFirstPage: false,
    size: A5,
    margins: MARGIN,
    pdfVersion: '1.7',
    lang: 'vi-VN',
    displayTitle: true,
    compress: true,
    info: Object.fromEntries(
      Object.entries({
        Title: title,
        Author: [story.author, story.group].filter(Boolean).join(' / '),
        Subject: story.synopsis ? story.synopsis.slice(0, 500) : '',
        Creator: 'NovelHub',
        Producer: 'NovelHub (pdfkit)',
        CreationDate: new Date(), // also seeds the PDF file ID
        ModDate: new Date(),
      }).filter(([, v]) => v !== '')
    ) as PDFKit.DocumentInfo,
  });
  const out = fs.createWriteStream(outPath);
  const finished = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
    doc.on('error', reject);
  });
  doc.pipe(out);

  doc.registerFont('Body', path.join(FONT_DIR, FONT_FILES.regular));
  doc.registerFont('Bold', path.join(FONT_DIR, FONT_FILES.bold));
  doc.registerFont('Italic', path.join(FONT_DIR, FONT_FILES.italic));
  doc.registerFont('BoldItalic', path.join(FONT_DIR, FONT_FILES.boldItalic));
  const write = textWriter(doc); // doc.text() with fallback fonts for 【】, CJK, symbols

  // ---- page numbers (novel body pages only)
  let numbering = false;
  let pageNo = 0;
  doc.on('pageAdded', () => {
    if (!numbering) return;
    pageNo++;
    // This also runs when a paragraph flows onto a new page: put back the text state afterwards
    const st = doc as any;
    const { x, y } = doc;
    const font = st._font;
    const size = st._fontSize;
    const fill = st._fillColor as [any, number] | undefined;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // drawing inside the bottom margin must not trigger a new page
    doc.font('Body').fontSize(8.5).fillColor('#777777')
      .text(String(pageNo), 0, doc.page.height - 34, { width: doc.page.width, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
    st._font = font;
    doc.fontSize(size);
    if (fill) doc.fillColor(fill[0], fill[1]);
    else doc.fillColor('#000000');
    doc.x = x;
    doc.y = y;
  });

  const contentWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomY = () => doc.page.height - doc.page.margins.bottom;
  const contentHeight = () => doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

  try {
    // ---- cover
    const coverRaw = await fetchImage(story.coverUrl);
    if (coverRaw) {
      try {
        const [img] = await prepareImage(coverRaw, { maxWidth: 1600, sliceTall: false });
        if (isManga) {
          doc.addPage({ size: [img.width * PX_TO_PT, img.height * PX_TO_PT], margin: 0 });
          doc.image(img.data, 0, 0, { width: img.width * PX_TO_PT, height: img.height * PX_TO_PT });
        } else {
          doc.addPage({ size: A5, margin: 0 });
          const scale = Math.min(A5[0] / img.width, A5[1] / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          doc.rect(0, 0, A5[0], A5[1]).fill('#111111');
          doc.image(img.data, (A5[0] - w) / 2, (A5[1] - h) / 2, { width: w, height: h });
        }
      } catch {
        /* no cover page */
      }
    }

    // ---- title page
    doc.addPage({ size: A5, margins: MARGIN });
    doc.fillColor('#000000');
    doc.y = A5[1] * 0.24;
    doc.fontSize(22);
    write('Bold', story.title, { align: 'center', lineGap: 4 });
    if (opts.subtitle) {
      doc.moveDown(0.6).fontSize(13);
      write('Bold', opts.subtitle, { align: 'center' });
    }
    doc.moveDown(1.2).fontSize(11);
    for (const line of [
      story.author ? `Tác giả: ${story.author}` : null,
      story.artist ? `Họa sĩ: ${story.artist}` : null,
      story.group ? `Nhóm dịch: ${story.group}` : null,
    ]) if (line) write('Body', line, { align: 'center', lineGap: 3 });
    if (!isManga && story.synopsis) {
      doc.moveDown(2).fontSize(10).fillColor('#333333');
      const synopsis = story.synopsis.length > 1500 ? story.synopsis.slice(0, 1500).trimEnd() + '…' : story.synopsis;
      write('Italic', synopsis, { align: 'justify', lineGap: 2.5, paragraphGap: 5, height: bottomY() - doc.y - 40, ellipsis: true });
    }
    doc.page.margins.bottom = 0; // footer line sits in the bottom margin: no page break
    doc.font('Body').fontSize(8.5).fillColor('#777777')
      .text(`Tải từ NovelHub · ${new Date().toLocaleDateString('vi-VN')}`, MARGIN.left, A5[1] - 40, { width: contentWidth(), align: 'center', lineBreak: false });
    doc.page.margins.bottom = MARGIN.bottom;
    doc.fillColor('#000000');

    // ---- chapters
    let volumeItem: PDFKit.PDFOutline | null = null;
    let currentVolume: string | null = null;
    const merged = chapters.length > 1;
    numbering = !isManga;

    for (let ci = 0; ci < chapters.length; ci++) {
      const ch = chapters[ci];

      if (isManga) {
        let first = true;
        for (const url of ch.pages) {
          const raw = await fetchImage(url);
          if (!raw) continue;
          let pieces;
          try {
            pieces = await prepareImage(raw, { maxWidth: 2000, sliceTall: true });
          } catch {
            continue;
          }
          for (const piece of pieces) {
            const w = piece.width * PX_TO_PT;
            const h = piece.height * PX_TO_PT;
            doc.addPage({ size: [w, h], margin: 0 });
            doc.image(piece.data, 0, 0, { width: w, height: h });
            if (first) {
              ({ volumeItem, currentVolume } = addOutline(doc, ch, merged, volumeItem, currentVolume));
              first = false;
            }
            await relieve(doc);
          }
        }
        if (first) {
          // no page could be loaded: say so instead of silently dropping the chapter
          doc.addPage({ size: A5, margins: MARGIN });
          ({ volumeItem, currentVolume } = addOutline(doc, ch, merged, volumeItem, currentVolume));
          doc.y = A5[1] * 0.4;
          doc.fontSize(15);
          write('Bold', ch.title, { align: 'center' });
          doc.moveDown().font('Body').fontSize(11).text('Không tải được ảnh của chương này.', { align: 'center' });
        }
      } else {
        // Volume divider page when a merged book enters a new volume
        if (merged && ch.volumeKey && ch.volumeKey !== currentVolume) {
          doc.addPage({ size: A5, margins: MARGIN });
          volumeItem = doc.outline.addItem(ch.volumeTitle || 'Tập', { expanded: false });
          currentVolume = ch.volumeKey;
          doc.y = A5[1] * 0.38;
          doc.fontSize(20).fillColor('#000000');
          write('Bold', ch.volumeTitle || 'Tập', { align: 'center' });
        } else if (!ch.volumeKey) {
          volumeItem = null;
          currentVolume = null;
        }

        doc.addPage({ size: A5, margins: MARGIN });
        (volumeItem || doc.outline).addItem(ch.title);
        doc.y = MARGIN.top + 28;
        doc.fontSize(16).fillColor('#000000');
        write('Bold', ch.title, { align: 'center', lineGap: 3 });
        doc.moveDown(1.6);

        if (ch.blocks.length === 0) {
          doc.font('Italic').fontSize(BODY_SIZE).fillColor('#777777')
            .text('(Chương này chưa có nội dung.)', MARGIN.left, doc.y, { width: contentWidth(), align: 'center' });
          doc.fillColor('#000000');
        }
        for (const b of ch.blocks) {
          if (b.kind === 'paragraph') {
            if (b.text) {
              doc.fontSize(BODY_SIZE).fillColor('#000000');
              write('Body', b.text, MARGIN.left, doc.y, { width: contentWidth(), align: 'justify', lineGap: 3.6, paragraphGap: 8 });
            }
            if (b.note) drawNote(b.note);
          } else if (b.kind === 'heading') {
            if (doc.y + 60 > bottomY()) doc.addPage({ size: A5, margins: MARGIN });
            doc.moveDown(0.6).fontSize(12.5).fillColor('#000000');
            write('Bold', b.text, MARGIN.left, doc.y, { width: contentWidth(), align: 'center', paragraphGap: 8 });
          } else if (b.kind === 'separator') {
            if (doc.y + 40 > bottomY()) doc.addPage({ size: A5, margins: MARGIN });
            doc.moveDown(0.4).font('Body').fontSize(BODY_SIZE).fillColor('#555555')
              .text('*   *   *', MARGIN.left, doc.y, { width: contentWidth(), align: 'center', paragraphGap: 12 });
            doc.fillColor('#000000');
          } else if (b.kind === 'image') {
            await drawImage(b.url);
            if (b.note) drawNote(b.note);
          }
        }
      }
      await opts.onChapterDone?.(ci);
      await relieve(doc);
    }

    doc.end();
    await finished;
  } catch (err) {
    try { doc.end(); } catch {}
    out.destroy();
    throw err;
  }

  // ---- helpers (closures over doc)

  function drawNote(note: string) {
    const x = MARGIN.left + 12;
    const width = contentWidth() - 12;
    doc.font('Italic').fontSize(9.5);
    const textH = doc.heightOfString(note, { width, lineGap: 2.5 });
    const needed = textH + 26;
    if (doc.y + Math.min(needed, 120) > bottomY() && needed < contentHeight()) doc.addPage({ size: A5, margins: MARGIN });
    const startY = doc.y + 1;
    const startPage = pageNo;
    doc.font('Bold').fontSize(8).fillColor(GOLD).text('GHI CHÚ CỦA DỊCH GIẢ', x, startY, { width, characterSpacing: 0.4 });
    doc.moveDown(0.2).fontSize(9.5).fillColor('#333333');
    write('Italic', note, x, doc.y, { width, lineGap: 2.5 });
    const endY = doc.y;
    if (pageNo === startPage) {
      doc.save().moveTo(MARGIN.left + 2, startY).lineTo(MARGIN.left + 2, endY).lineWidth(2).strokeColor(GOLD).stroke().restore();
    }
    doc.fillColor('#000000').font('Body').fontSize(BODY_SIZE);
    doc.x = MARGIN.left;
    doc.y = endY + 10;
  }

  async function drawImage(url: string) {
    const raw = await fetchImage(url);
    if (!raw) return;
    let img;
    try {
      [img] = await prepareImage(raw, { maxWidth: 1600, sliceTall: false });
    } catch {
      return;
    }
    const maxW = contentWidth();
    const maxH = contentHeight();
    const scale = Math.min(maxW / img.width, maxH / img.height, 1.5);
    const w = img.width * scale;
    const h = img.height * scale;
    if (doc.y + h > bottomY()) doc.addPage({ size: A5, margins: MARGIN });
    const y = doc.y + 4;
    doc.image(img.data, MARGIN.left + (maxW - w) / 2, y, { width: w, height: h });
    doc.x = MARGIN.left;
    doc.y = y + h + 12;
    if (doc.y > bottomY()) doc.addPage({ size: A5, margins: MARGIN });
  }
}

/** Bookmark the current page, nested under its volume when a merged file spans volumes. */
function addOutline(
  doc: PDFKit.PDFDocument,
  ch: { title: string; volumeKey: string | null; volumeTitle: string | null },
  merged: boolean,
  volumeItem: PDFKit.PDFOutline | null,
  currentVolume: string | null
) {
  if (merged && ch.volumeKey) {
    if (ch.volumeKey !== currentVolume) {
      volumeItem = doc.outline.addItem(ch.volumeTitle || 'Tập', { expanded: false });
      currentVolume = ch.volumeKey;
    }
    volumeItem!.addItem(ch.title);
  } else {
    volumeItem = null;
    currentVolume = null;
    doc.outline.addItem(ch.title);
  }
  return { volumeItem, currentVolume };
}
