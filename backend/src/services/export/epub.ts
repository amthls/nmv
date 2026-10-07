import fs from 'fs';
import path from 'path';
import { ZipWriter } from './zip';
import { ExportBook, ExportChapter, fetchImage, prepareImage } from './content';

/**
 * EPUB 3.3 writer (with an EPUB 2 toc.ncx so older readers get a table of contents too).
 *   novel -> reflowable book, Literata embedded (full Vietnamese), one XHTML file per chapter
 *   manga -> fixed-layout book, one page per image (webtoon strips cut into pages)
 */

export const FONT_DIR = [path.resolve(__dirname, '../../../assets/fonts'), path.resolve(process.cwd(), 'assets/fonts')]
  .find((d) => fs.existsSync(d)) || path.resolve(__dirname, '../../../assets/fonts');

export const FONT_FILES = {
  regular: 'Literata-Regular.ttf',
  bold: 'Literata-Bold.ttf',
  italic: 'Literata-Italic.ttf',
  boldItalic: 'Literata-BoldItalic.ttf',
};

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const pad = (n: number, w = 4) => String(n).padStart(w, '0');

interface ManifestItem { id: string; href: string; type: string; props?: string }
interface NavPoint { title: string; href: string; children?: NavPoint[] }

function xhtml(title: string, body: string, opts: { cssHref?: string; viewport?: [number, number]; bodyClass?: string } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="vi" lang="vi">
<head>
<meta charset="UTF-8"/>
<title>${esc(title)}</title>
${opts.viewport ? `<meta name="viewport" content="width=${opts.viewport[0]}, height=${opts.viewport[1]}"/>\n` : ''}<link rel="stylesheet" type="text/css" href="${opts.cssHref || '../styles/book.css'}"/>
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ''}>
${body}
</body>
</html>
`;
}

const NOVEL_CSS = `@charset "UTF-8";
@font-face { font-family: "Literata"; font-weight: normal; font-style: normal; src: url(../fonts/${FONT_FILES.regular}); }
@font-face { font-family: "Literata"; font-weight: bold; font-style: normal; src: url(../fonts/${FONT_FILES.bold}); }
@font-face { font-family: "Literata"; font-weight: normal; font-style: italic; src: url(../fonts/${FONT_FILES.italic}); }
@font-face { font-family: "Literata"; font-weight: bold; font-style: italic; src: url(../fonts/${FONT_FILES.boldItalic}); }
html, body { margin: 0; padding: 0; }
body { font-family: "Literata", "Noto Serif", Georgia, serif; line-height: 1.65; text-align: justify; widows: 2; orphans: 2; hyphens: none; -epub-hyphens: none; -webkit-hyphens: none; }
p { margin: 0 0 0.8em 0; text-indent: 0; }
h1, h2 { font-weight: bold; line-height: 1.3; text-align: center; hyphens: none; page-break-after: avoid; break-after: avoid; }
h1.chapter-title { font-size: 1.45em; margin: 1.6em 0 1.4em 0; }
h2.block-heading { font-size: 1.15em; margin: 1.4em 0 0.8em 0; }
.volume-page { text-align: center; padding-top: 30%; }
.volume-page h1 { font-size: 1.8em; margin: 0; }
.sep { text-align: center; margin: 1.4em 0; text-indent: 0; letter-spacing: 0.6em; }
.note { margin: 0.2em 0 1.1em 0; padding: 0.15em 0 0.15em 0.9em; border-left: 3px solid #b8860b; font-size: 0.9em; text-align: left; }
.note p { margin: 0 0 0.3em 0; font-style: italic; }
.note p.note-label { font-style: normal; font-weight: bold; font-size: 0.85em; color: #8a6d1d; }
figure.illus { margin: 1.2em 0; padding: 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
figure.illus img { max-width: 100%; height: auto; }
.cover-page { margin: 0; padding: 0; text-align: center; }
.cover-page div { margin: 0; padding: 0; height: 100%; }
.cover-page svg { margin: 0; padding: 0; }
.title-page { text-align: center; padding-top: 18%; }
.title-page h1 { font-size: 1.9em; margin: 0 0 0.8em 0; }
.title-page p { text-align: center; margin: 0 0 0.35em 0; }
.title-page .meta { font-size: 0.95em; }
.title-page .synopsis { text-align: justify; margin-top: 2.2em; font-size: 0.92em; }
.title-page .credit { margin-top: 2.5em; font-size: 0.8em; color: #666666; }
`;

const MANGA_CSS = `@charset "UTF-8";
html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
body { background: #ffffff; }
img.page { display: block; width: 100%; height: 100%; margin: 0; padding: 0; }
.title-page { font-family: serif; text-align: center; padding: 30% 8% 0 8%; }
.title-page h1 { font-size: 64px; line-height: 1.25; margin: 0 0 40px 0; }
.title-page p { font-size: 34px; line-height: 1.4; margin: 0 0 14px 0; }
`;

function navList(points: NavPoint[]): string {
  return `<ol>\n${points
    .map((p) => `<li><a href="${esc(p.href)}">${esc(p.title)}</a>${p.children && p.children.length ? '\n' + navList(p.children) : ''}</li>`)
    .join('\n')}\n</ol>`;
}

function ncxPoints(points: NavPoint[], counter: { n: number }): string {
  return points
    .map((p) => {
      const n = ++counter.n;
      return `<navPoint id="np-${n}" playOrder="${n}"><navLabel><text>${esc(p.title)}</text></navLabel><content src="${esc(p.href)}"/>${
        p.children ? ncxPoints(p.children, counter) : ''
      }</navPoint>`;
    })
    .join('\n');
}

/** Table of contents grouped by volume when the selection spans volumes. */
function buildToc(chapters: ExportChapter[], hrefOf: (c: ExportChapter) => string, volumeHref: Map<string, string>): NavPoint[] {
  const points: NavPoint[] = [];
  let current: NavPoint | null = null;
  let currentKey: string | null = null;
  for (const c of chapters) {
    const entry = { title: c.title, href: hrefOf(c) };
    if (c.volumeKey && volumeHref.has(c.volumeKey)) {
      if (currentKey !== c.volumeKey) {
        current = { title: c.volumeTitle || 'Tập', href: volumeHref.get(c.volumeKey)!, children: [] };
        currentKey = c.volumeKey;
        points.push(current);
      }
      current!.children!.push(entry);
    } else {
      current = null;
      currentKey = null;
      points.push(entry);
    }
  }
  return points;
}

export interface EpubOptions {
  identifier: string; // UUID
  subtitle?: string; // e.g. the chapter title when each chapter is its own file
  onChapterDone?: (index: number) => Promise<void> | void;
}

export async function writeEpub(book: ExportBook, outPath: string, opts: EpubOptions): Promise<void> {
  const { story, chapters } = book;
  const isManga = story.type === 'manga';
  const bookTitle = opts.subtitle ? `${story.title} – ${opts.subtitle}` : story.title;
  const zip = new ZipWriter(outPath);
  const manifest: ManifestItem[] = [];
  const spine: string[] = [];
  const landmarks: { type: string; title: string; href: string }[] = [];

  try {
    await zip.add('mimetype', 'application/epub+zip', false);
    await zip.add(
      'META-INF/container.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`
    );

    await zip.add('OEBPS/styles/book.css', isManga ? MANGA_CSS : NOVEL_CSS);
    manifest.push({ id: 'css', href: 'styles/book.css', type: 'text/css' });
    if (!isManga) {
      for (const [key, file] of Object.entries(FONT_FILES)) {
        await zip.add(`OEBPS/fonts/${file}`, await fs.promises.readFile(path.join(FONT_DIR, file)), true);
        manifest.push({ id: `font-${key}`, href: `fonts/${file}`, type: 'font/ttf' });
      }
    }

    // ---- cover
    const coverRaw = await fetchImage(story.coverUrl);
    let cover: { width: number; height: number } | null = null;
    if (coverRaw) {
      try {
        const [img] = await prepareImage(coverRaw, { maxWidth: 1600, sliceTall: false });
        await zip.add('OEBPS/images/cover.jpg', img.data, false);
        manifest.push({ id: 'cover-image', href: 'images/cover.jpg', type: 'image/jpeg', props: 'cover-image' });
        cover = { width: img.width, height: img.height };
      } catch {
        cover = null;
      }
    }
    if (cover) {
      const body = isManga
        ? `<img class="page" src="../images/cover.jpg" alt="${esc(story.title)}"/>`
        : `<div><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100%" height="100%" viewBox="0 0 ${cover.width} ${cover.height}" preserveAspectRatio="xMidYMid meet"><image width="${cover.width}" height="${cover.height}" xlink:href="../images/cover.jpg"/></svg></div>`;
      await zip.add(
        'OEBPS/text/cover.xhtml',
        xhtml('Bìa', body, { viewport: isManga ? [cover.width, cover.height] : undefined, bodyClass: 'cover-page' })
      );
      manifest.push({ id: 'cover', href: 'text/cover.xhtml', type: 'application/xhtml+xml', props: isManga ? undefined : 'svg' });
      spine.push('cover');
      landmarks.push({ type: 'cover', title: 'Bìa', href: 'text/cover.xhtml' });
    }

    // ---- title page
    const metaLines = [
      story.author ? `Tác giả: ${story.author}` : null,
      story.artist ? `Họa sĩ: ${story.artist}` : null,
      story.group ? `Nhóm dịch: ${story.group}` : null,
    ].filter(Boolean) as string[];
    const titleBody = `<div class="title-page">
<h1>${esc(story.title)}</h1>
${opts.subtitle ? `<p class="meta"><b>${esc(opts.subtitle)}</b></p>\n` : ''}${metaLines.map((l) => `<p class="meta">${esc(l)}</p>`).join('\n')}
${!isManga && story.synopsis ? story.synopsis.split(/\n+/).map((p, i) => `<p class="synopsis"${i ? ' style="margin-top:0.5em"' : ''}>${esc(p)}</p>`).join('\n') : ''}
<p class="credit">Tải từ NovelHub · ${new Date().toLocaleDateString('vi-VN')}</p>
</div>`;
    await zip.add('OEBPS/text/title.xhtml', xhtml(story.title, titleBody, { viewport: isManga ? [1200, 1800] : undefined }));
    manifest.push({ id: 'titlepage', href: 'text/title.xhtml', type: 'application/xhtml+xml' });
    spine.push('titlepage');
    landmarks.push({ type: 'titlepage', title: 'Trang tên sách', href: 'text/title.xhtml' });

    // ---- chapters
    const chapterHref = new Map<string, string>();
    const volumeHref = new Map<string, string>();
    const withVolumes = chapters.length > 1; // a merged book is grouped by volume (TOC + divider pages)
    const imageHref = new Map<string, string>(); // novel illustrations: same picture stored once
    let imageNo = 0;
    let lastVolume: string | null = null;

    for (let ci = 0; ci < chapters.length; ci++) {
      const ch = chapters[ci];

      // Volume divider page (merged books spanning volumes only)
      if (!isManga && withVolumes && ch.volumeKey && ch.volumeKey !== lastVolume && !volumeHref.has(ch.volumeKey)) {
        const href = `text/vol-${pad(volumeHref.size + 1, 3)}.xhtml`;
        volumeHref.set(ch.volumeKey, href);
        await zip.add(`OEBPS/${href}`, xhtml(ch.volumeTitle || 'Tập', `<section class="volume-page" epub:type="part" role="doc-part"><h1>${esc(ch.volumeTitle || 'Tập')}</h1></section>`));
        manifest.push({ id: `vol-${volumeHref.size}`, href, type: 'application/xhtml+xml' });
        spine.push(`vol-${volumeHref.size}`);
      }
      lastVolume = ch.volumeKey;

      if (isManga) {
        let pageNo = 0;
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
            pageNo++;
            const base = `c${pad(ci + 1)}-p${pad(pageNo)}`;
            await zip.add(`OEBPS/images/${base}.jpg`, piece.data, false);
            manifest.push({ id: `img-${base}`, href: `images/${base}.jpg`, type: 'image/jpeg' });
            const href = `text/${base}.xhtml`;
            await zip.add(
              `OEBPS/${href}`,
              xhtml(`${ch.title} – ${pageNo}`, `<img class="page" src="../images/${base}.jpg" alt="Trang ${pageNo}"/>`, { viewport: [piece.width, piece.height] })
            );
            manifest.push({ id: `pg-${base}`, href, type: 'application/xhtml+xml' });
            spine.push(`pg-${base}`);
            if (pageNo === 1) chapterHref.set(ch.id, href);
          }
        }
        if (!chapterHref.has(ch.id)) {
          // every page failed to load: keep the chapter in the TOC with an explanation page
          const href = `text/c${pad(ci + 1)}-missing.xhtml`;
          await zip.add(`OEBPS/${href}`, xhtml(ch.title, `<div class="title-page"><h1>${esc(ch.title)}</h1><p>Không tải được ảnh của chương này.</p></div>`, { viewport: [1200, 1800] }));
          manifest.push({ id: `pg-c${pad(ci + 1)}-missing`, href, type: 'application/xhtml+xml' });
          spine.push(`pg-c${pad(ci + 1)}-missing`);
          chapterHref.set(ch.id, href);
        }
        // manga has no divider pages: a volume's TOC entry opens its first chapter
        if (withVolumes && ch.volumeKey && !volumeHref.has(ch.volumeKey)) volumeHref.set(ch.volumeKey, chapterHref.get(ch.id)!);
      } else {
        const parts: string[] = [`<h1 class="chapter-title">${esc(ch.title)}</h1>`];
        const noteHtml = (note: string) =>
          `<div class="note"><p class="note-label">Ghi chú của dịch giả</p>${note.split(/\n+/).map((n) => `<p>${esc(n)}</p>`).join('')}</div>`;
        for (const b of ch.blocks) {
          if (b.kind === 'paragraph') {
            if (b.text) parts.push(`<p>${esc(b.text)}</p>`);
            if (b.note) parts.push(noteHtml(b.note));
          } else if (b.kind === 'heading') {
            parts.push(`<h2 class="block-heading">${esc(b.text)}</h2>`);
          } else if (b.kind === 'separator') {
            parts.push('<p class="sep">* * *</p>');
          } else if (b.kind === 'image') {
            let href = imageHref.get(b.url);
            if (!href) {
              const raw = await fetchImage(b.url);
              if (raw) {
                try {
                  const [img] = await prepareImage(raw, { maxWidth: 1600, sliceTall: false });
                  href = `images/illus-${pad(++imageNo)}.jpg`;
                  await zip.add(`OEBPS/${href}`, img.data, false);
                  manifest.push({ id: `illus-${pad(imageNo)}`, href, type: 'image/jpeg' });
                  imageHref.set(b.url, href);
                } catch {
                  href = undefined;
                }
              }
            }
            if (href) parts.push(`<figure class="illus"><img src="../${href}" alt="Minh họa"/></figure>`);
            if (b.note) parts.push(noteHtml(b.note));
          }
        }
        if (parts.length === 1) parts.push('<p class="sep">(Chương này chưa có nội dung.)</p>');
        const href = `text/ch-${pad(ci + 1)}.xhtml`;
        await zip.add(`OEBPS/${href}`, xhtml(ch.title, `<section epub:type="chapter" role="doc-chapter">\n${parts.join('\n')}\n</section>`));
        manifest.push({ id: `ch-${pad(ci + 1)}`, href, type: 'application/xhtml+xml' });
        spine.push(`ch-${pad(ci + 1)}`);
        chapterHref.set(ch.id, href);
      }
      if (ci === 0) landmarks.push({ type: 'bodymatter', title: 'Bắt đầu đọc', href: chapterHref.get(ch.id)! });
      await opts.onChapterDone?.(ci);
    }

    // ---- navigation
    const toc = buildToc(chapters, (c) => chapterHref.get(c.id)!, volumeHref);
    const nav = xhtml(
      'Mục lục',
      `<nav epub:type="toc" id="toc" role="doc-toc">
<h1>Mục lục</h1>
${navList(toc)}
</nav>
<nav epub:type="landmarks" id="landmarks" hidden="hidden">
<h2>Mốc</h2>
<ol>
${landmarks.map((l) => `<li><a epub:type="${l.type}" href="${esc(l.href)}">${esc(l.title)}</a></li>`).join('\n')}
</ol>
</nav>`,
      // nav.xhtml sits next to content.opf, so its links (text/...) are already relative to OEBPS/
      { cssHref: 'styles/book.css', viewport: isManga ? [1200, 1800] : undefined }
    );
    await zip.add('OEBPS/nav.xhtml', nav);
    manifest.push({ id: 'nav', href: 'nav.xhtml', type: 'application/xhtml+xml', props: 'nav' });

    const uid = `urn:uuid:${opts.identifier}`;
    await zip.add(
      'OEBPS/toc.ncx',
      `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="vi">
<head>
<meta name="dtb:uid" content="${uid}"/>
<meta name="dtb:depth" content="${toc.some((p) => p.children) ? 2 : 1}"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${esc(bookTitle)}</text></docTitle>
<navMap>
${ncxPoints(toc, { n: 0 })}
</navMap>
</ncx>
`
    );
    manifest.push({ id: 'ncx', href: 'toc.ncx', type: 'application/x-dtbncx+xml' });

    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="vi">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uid}</dc:identifier>
<dc:title>${esc(bookTitle)}</dc:title>
<dc:language>vi</dc:language>
${story.author ? `<dc:creator id="author">${esc(story.author)}</dc:creator>\n<meta refines="#author" property="role" scheme="marc:relators">aut</meta>\n` : ''}${story.artist ? `<dc:creator id="artist">${esc(story.artist)}</dc:creator>\n<meta refines="#artist" property="role" scheme="marc:relators">ill</meta>\n` : ''}${story.group ? `<dc:contributor id="translator">${esc(story.group)}</dc:contributor>\n<meta refines="#translator" property="role" scheme="marc:relators">trl</meta>\n` : ''}<dc:publisher>NovelHub</dc:publisher>
${story.synopsis ? `<dc:description>${esc(story.synopsis)}</dc:description>\n` : ''}<meta property="dcterms:modified">${modified}</meta>
${cover ? '<meta name="cover" content="cover-image"/>\n' : ''}${isManga ? '<meta property="rendition:layout">pre-paginated</meta>\n<meta property="rendition:orientation">auto</meta>\n<meta property="rendition:spread">none</meta>\n' : ''}</metadata>
<manifest>
${manifest.map((m) => `<item id="${m.id}" href="${esc(m.href)}" media-type="${m.type}"${m.props ? ` properties="${m.props}"` : ''}/>`).join('\n')}
</manifest>
<spine toc="ncx">
${spine.map((id) => `<itemref idref="${id}"/>`).join('\n')}
</spine>
</package>
`;
    await zip.add('OEBPS/content.opf', opf);
    await zip.finish();
  } catch (err) {
    zip.destroy();
    throw err;
  }
}
