// Novel chapters are stored as blocks (one per paragraph / heading / quote / list / scene break /
// illustration) so the reader can bookmark and annotate each one. The chapter editor works on HTML:
// these helpers convert between the two. The API sanitizes every block's html before saving it.

export interface ChapterBlock {
  id?: string;
  type?: string;
  text?: string;
  html?: string;
  note?: string;
  image_url?: string;
  width?: number;
  height?: number;
}

export interface EditorBlock {
  html: string;
  text: string;
  image_url?: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Editor HTML -> one block per top-level element (empty paragraphs are dropped). Browser only. */
export function htmlToBlocks(html: string): EditorBlock[] {
  if (!html || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: EditorBlock[] = [];
  doc.body.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').trim();
      if (text) blocks.push({ html: `<p>${escapeHtml(text)}</p>`, text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const image = tag === 'figure' ? el.querySelector('img')?.getAttribute('src') || undefined : undefined;
    const text = tag === 'figure' ? '' : (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text && !image && tag !== 'hr') return;
    blocks.push({ html: el.outerHTML, text, image_url: image });
  });
  return blocks;
}

/** Plain text (blank line between paragraphs) -> editor HTML. */
export function plainTextToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Stored blocks -> editor HTML. Older chapters (plain text, an illustration hung on a paragraph) included. */
export function blocksToHtml(blocks: ChapterBlock[]): string {
  return blocks
    .map((b) => {
      let html = b.html || '';
      if (!html) {
        if (b.type === 'separator') html = '<hr>';
        else if (b.type === 'heading' && b.text) html = `<h3>${escapeHtml(b.text)}</h3>`;
        else if (b.text) html = plainTextToHtml(b.text);
        if (b.image_url) html += `<figure class="image"><img src="${escapeHtml(b.image_url)}"></figure>`;
      }
      return html;
    })
    .join('');
}

export const countWords = (blocks: { text?: string }[]) =>
  blocks.reduce((n, b) => n + (b.text ? b.text.split(/\s+/).filter(Boolean).length : 0), 0);
