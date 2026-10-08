import sanitizeHtml from 'sanitize-html';

/**
 * Rich text (CKEditor output) is stored as sanitized HTML in text columns.
 * Only the tags the editor toolbar can produce are allowed; everything else is dropped.
 * Plain text (legacy rows, API clients) is stored untouched.
 */
const HAS_TAG = /<\/?[a-z][^>]*>/i;

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr',
  'figure', 'figcaption', 'img',
];

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

const decodeEntities = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);

/** Sanitize user HTML. Returns null for empty/undefined input so callers can keep COALESCE semantics. */
export function sanitizeRichText(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value) return '';
  if (!HAS_TAG.test(value)) return value;
  return sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      figure: ['class', 'style'],
      img: ['src', 'alt', 'width', 'height'],
    },
    // Editor image classes only (image, resized, alignment styles); size is a percentage on <figure>
    allowedClasses: { figure: ['image', 'image_resized', 'image-style-*'] },
    allowedStyles: { figure: { width: [/^\d{1,3}(\.\d+)?%$/] } },
    // Only images uploaded to this site: no hotlinked or tracking images
    exclusiveFilter: (frame) => frame.tag === 'img' && !/^\/uploads\/(?!.*\.\.)[\w./%-]+$/.test(frame.attribs.src || ''),
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
    },
  }).trim();
}

/**
 * One block of a novel chapter (a paragraph, heading, quote, list, scene break or illustration)
 * from the chapter editor. Formatting is expressed with classes only (no inline colours or fonts),
 * so the reader can restyle it for every theme and font setting.
 */
const CHAPTER_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'mark', 'span',
  'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr',
  'figure', 'figcaption', 'img',
];
const ALIGN_CLASSES = ['nh-align-left', 'nh-align-center', 'nh-align-right', 'nh-align-justify'];

export function sanitizeChapterHtml(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) return '';
  return sanitizeHtml(input.trim(), {
    allowedTags: CHAPTER_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      figure: ['class', 'style'],
      img: ['src', 'alt', 'width', 'height'],
      ol: ['start', 'reversed'],
      '*': ['class'],
    },
    allowedClasses: {
      p: ALIGN_CLASSES, h2: ALIGN_CLASSES, h3: ALIGN_CLASSES, h4: ALIGN_CLASSES, blockquote: ALIGN_CLASSES, li: ALIGN_CLASSES,
      span: ['text-tiny', 'text-small', 'text-big', 'text-huge'],
      mark: ['marker-yellow', 'marker-green', 'marker-pink', 'marker-blue', 'pen-red', 'pen-green'],
      figure: ['image', 'image_resized', 'image-style-*'],
    },
    allowedStyles: { figure: { width: [/^\d{1,3}(\.\d+)?%$/] } },
    exclusiveFilter: (frame) =>
      (frame.tag === 'img' && !/^\/uploads\/(?!.*\.\.)[\w./%-]+$/.test(frame.attribs.src || ''))
      // a <span>/<mark> left without its class carries no formatting
      || ((frame.tag === 'span' || frame.tag === 'mark') && !frame.attribs.class && !frame.text.trim()),
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
    },
  }).trim();
}

/** Visible text of stored content (HTML or plain), for validation and search indexing. */
export function richTextToPlain(input: unknown): string {
  if (typeof input !== 'string') return '';
  if (!HAS_TAG.test(input)) return input.trim();
  const withBreaks = input.replace(/<\/(p|h[1-6]|li|blockquote)>|<br\s*\/?>|<hr\s*\/?>/gi, ' ');
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
}

/** True when content has visible text or at least one image (a post may be image-only). */
export function hasRichContent(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  return richTextToPlain(input).length > 0 || /<img\s/i.test(input);
}
