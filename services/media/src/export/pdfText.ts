import fs from 'fs';
import path from 'path';
import { FONT_DIR, FONT_FILES } from './epub';

// fontkit ships with pdfkit (same version) and has no type definitions
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fontkit = require('fontkit');

/**
 * Text with font fallback for pdfkit. Literata covers Latin + Vietnamese only; light novels also
 * use 【】『』「」《》, CJK names and symbols (♪ ≥ ✦ ╯┻). PDF has no automatic fallback, so a
 * missing glyph would print as an empty box: text is split into runs and each run is drawn with
 * the first font that has its characters. The fallback fonts come from the Docker image
 * (fonts-noto-cjk, fonts-dejavu-core); when they are missing the text still prints with Literata.
 */

export type Face = 'Body' | 'Bold' | 'Italic' | 'BoldItalic';

interface Fallback {
  name: string;
  file: string;
  postscript?: string; // font inside a .ttc collection
  bold?: { file: string; postscript?: string };
}

const FALLBACKS: Fallback[] = [
  {
    name: 'CJK',
    file: process.env.EXPORT_CJK_FONT || '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
    postscript: 'NotoSerifCJKsc-Regular',
    bold: { file: '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc', postscript: 'NotoSerifCJKsc-Bold' },
  },
  {
    name: 'Sym',
    file: process.env.EXPORT_SYMBOL_FONT || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    bold: { file: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
  },
];

// Glyph coverage is loaded once per process (the CJK collection is ~26 MB)
let primary: any = null;
const loaded = new Map<string, any | null>();

function openFont(file: string, postscript?: string): any | null {
  try {
    if (!fs.existsSync(file)) return null;
    const f = fontkit.openSync(file, postscript);
    return f && typeof f.hasGlyphForCodePoint === 'function' ? f : null;
  } catch {
    return null;
  }
}

function coverage(fb: Fallback): any | null {
  if (!loaded.has(fb.name)) loaded.set(fb.name, openFont(fb.file, fb.postscript));
  return loaded.get(fb.name) || null;
}

function primaryFont() {
  if (!primary) primary = openFont(path.join(FONT_DIR, FONT_FILES.regular));
  return primary;
}

const isSpace = (cp: number) => cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x3000 || cp === 0xa0;

interface Run { font: string | null; text: string } // font null = the requested Literata face

export function splitRuns(text: string): Run[] {
  const main = primaryFont();
  const runs: Run[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    let font: string | null = null;
    if (main && !main.hasGlyphForCodePoint(cp) && !isSpace(cp)) {
      for (const fb of FALLBACKS) {
        const f = coverage(fb);
        if (f && f.hasGlyphForCodePoint(cp)) {
          font = fb.name;
          break;
        }
      }
    }
    const last = runs[runs.length - 1];
    if (last && (last.font === font || isSpace(cp))) last.text += ch;
    else runs.push({ font, text: ch });
  }
  return runs;
}

/** Returns write(face, text, x?, y?, options): doc.text() with per-run font fallback. */
export function textWriter(doc: PDFKit.PDFDocument) {
  const registered = new Set<string>();
  const use = (face: Face, font: string | null) => {
    if (!font) return face;
    const fb = FALLBACKS.find((f) => f.name === font)!;
    const bold = face === 'Bold' || face === 'BoldItalic';
    const variant = bold && fb.bold && fs.existsSync(fb.bold.file) ? fb.bold : { file: fb.file, postscript: fb.postscript };
    const name = `${fb.name}${variant === fb.bold ? '-Bold' : ''}`;
    if (!registered.has(name)) {
      doc.registerFont(name, variant.file, variant.postscript as any);
      registered.add(name);
    }
    return name;
  };

  return function write(face: Face, text: string, x?: number | PDFKit.Mixins.TextOptions, y?: number, options: PDFKit.Mixins.TextOptions = {}) {
    if (typeof x === 'object') {
      options = x;
      x = undefined;
    }
    const runs = splitRuns(text);
    if (runs.length <= 1 && !runs[0]?.font) {
      doc.font(face);
      return x === undefined ? doc.text(text, options) : doc.text(text, x, y, options);
    }
    runs.forEach((run, i) => {
      doc.font(use(face, run.font));
      const opts = { ...options, continued: i < runs.length - 1 };
      if (i === 0 && x !== undefined) doc.text(run.text, x as number, y, opts);
      else doc.text(run.text, opts);
    });
    doc.font(face);
    return doc;
  };
}
