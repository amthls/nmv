import { Response } from 'express';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { callCommunity } from '../services/communityClient';

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

/** GET /codes/:code → { type, path } of the page to open. Hidden things answer 404 like unknown codes. */
export const resolveCode = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = parseCode(String(req.params.code).slice(0, 60));
    const roles = req.user?.roles || [];
    const isStaff = roles.includes('admin') || roles.includes('mod');
    const me = req.user?.id || null;
    let path: string | null = null;

    if (parsed && Number.isSafeInteger(parsed.no)) {
      const one = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0]?.path ?? null;
      switch (parsed.kind) {
        case 'user':
          path = await one(`SELECT '/nguoi-dung/' || username AS path FROM users
                            WHERE code_no = $1 AND ($2 OR (deleted_at IS NULL AND NOT COALESCE(is_banned, false)))`,
                           [parsed.no, isStaff]);
          break;
        case 'group':
          path = await one(`SELECT '/nhom-dich/' || slug AS path FROM translation_groups WHERE code_no = $1`, [parsed.no]);
          break;
        case 'story':
          path = await one(`SELECT '/truyen/' || slug AS path FROM stories WHERE code_no = $1 AND approval_status = 'approved'`, [parsed.no]);
          break;
        case 'chapter':
          path = await one(`SELECT '/truyen/' || s.slug || '/' || c.slug AS path FROM stories s
                            JOIN chapters c ON c.story_id = s.id AND c.chapter_number = $2::numeric AND c.is_published = true
                            WHERE s.code_no = $1 AND s.approval_status = 'approved' LIMIT 1`, [parsed.no, parsed.chapter]);
          break;
        case 'post':
        case 'report': { // community's (Plan/community.md)
          const r = await callCommunity('GET', `/internal/codes/${parsed.kind}/${parsed.no}?staff=${isStaff ? 1 : 0}${me ? `&me=${me}` : ''}`);
          path = r.status === 200 ? r.json.data.path : null;
          break;
        }
        case 'album':
          // Private albums only for their owner: the share link carries a key, a code does not
          path = await one(`SELECT '/album/' || id AS path FROM albums WHERE code_no = $1 AND (is_public OR user_id = $2)`, [parsed.no, me]);
          break;
      }
    }

    if (!path) return res.status(404).json({ success: false, message: 'Không tìm thấy mã này.' });
    return res.json({ success: true, data: { type: parsed!.kind, path } });
  } catch (error: any) {
    console.error('resolveCode:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
