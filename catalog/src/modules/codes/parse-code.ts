/**
 * Smart codes (sql/migrations/017_smart_codes.sql). Only the fixed number is used to find the row:
 * the other parts (role, group, category...) can change after the code was printed.
 */
export type ParsedCode =
  | { kind: 'user' | 'group' | 'story' | 'post' | 'album' | 'report'; no: number }
  | { kind: 'chapter'; no: number; chapter: string };

const PATTERNS: [RegExp, ParsedCode['kind']][] = [
  [/^U-[A-Z]{2}-\d{2}-(\d+)$/, 'user'],
  [/^G(\d+)$/, 'group'],
  [/^(?:LN|MG)-[A-Z]{2}-G\d+-(\d+)$/, 'story'],
  [/^P-[A-Z]{2}-\d{2}-(\d+)$/, 'post'],
  [/^AL-\d+-\d{2}-(\d+)$/, 'album'],
  [/^RP-[A-Z]{2}-\d{2}-(\d+)$/, 'report'],
];

export function parseCode(raw: string): ParsedCode | null {
  const code = raw.trim().toUpperCase();
  const ch = code.match(/^(?:LN|MG)-[A-Z]{2}-G\d+-(\d+)-C(\d+(?:\.\d{1,2})?)$/);
  if (ch) return { kind: 'chapter', no: Number(ch[1]), chapter: ch[2] };
  for (const [re, kind] of PATTERNS) {
    const m = code.match(re);
    if (m) return { kind, no: Number(m[1]) } as ParsedCode;
  }
  return null;
}
