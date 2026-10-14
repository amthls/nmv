import { internalAuthHeader } from '../../middlewares/auth.middleware';
import { currentRequestId } from '../../utils/logger';
import { InputError } from '../../utils/validation';
import type { ContentBlock } from '../../modules/chapters/dto/chapter-content';

/** Client of the workspace service's internal API (chapter versions and drafts live there). */

const WORKSPACE_URL = (process.env.WORKSPACE_INTERNAL_URL || 'http://workspace:8080').replace(/\/+$/, '');

export interface Revision {
  chapter_id: string;
  story_id: string;
  version: number;
  deleted: boolean;
  source: 'import' | 'create' | 'edit' | 'rewind' | 'delete' | 'restore';
  meta: { title: string; chapter_number: number; volume_id: string | null; intro_note: string | null; outro_note: string | null };
  blocks: ContentBlock[];
  author_id: string | null;
  created_at: string;
}

/** Call the workspace's internal API. Returns the HTTP status and the parsed body (never throws on 4xx). */
export async function callWorkspace(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${WORKSPACE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': internalAuthHeader('workspace'),
      ...(currentRequestId() ? { 'X-Request-Id': currentRequestId()! } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}


/** A workspace refusal (409 number taken / edited meanwhile / deleted, 404) is the user's to read; anything else is ours. */
export function workspaceFailure(r: { status: number; json: any }): never {
  if (r.status === 409 || r.status === 404) throw new InputError(r.json?.message || 'Không lưu được chương.', r.status);
  throw new Error(`workspace ${r.status}: ${r.json?.message || ''}`);
}
