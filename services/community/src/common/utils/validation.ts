/**
 * Small input checks shared by controllers. Each returns a clear 400 message instead of
 * letting bad input reach PostgreSQL (where it would surface as a masked 500).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

/** A client mistake: controllers answer it with `status` (400 unless it's a permission problem). */
export class InputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Optional text field: undefined stays undefined (field not sent), null/'' become null,
 * anything that is not a string or is longer than `max` throws InputError.
 */
export function optionalText(value: unknown, max: number, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new InputError(`${label} không hợp lệ.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new InputError(`${label} tối đa ${max} ký tự.`);
  return trimmed || null;
}

/** Required text field: must be a non-empty string of at most `max` characters. */
export function requiredText(value: unknown, max: number, label: string): string {
  const text = optionalText(value, max, label);
  if (!text) throw new InputError(`${label} không được để trống.`);
  return text;
}

/**
 * Image/link URL: an uploaded file on this site (/uploads/...) or an absolute http(s) URL.
 * Rejects javascript:, data: and other schemes. Same undefined/null rules as optionalText.
 */
export function optionalUrl(value: unknown, label: string): string | null | undefined {
  const url = optionalText(value, 2000, label);
  if (!url) return url;
  if (/^\/uploads\/(?!.*\.\.)[\w./%-]+$/.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
  } catch {
    // fall through
  }
  throw new InputError(`${label} phải là ảnh đã tải lên hoặc đường dẫn http(s).`);
}

/** Optional one-of value: undefined stays undefined, otherwise must be in `allowed`. */
export function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new InputError(`${label} không hợp lệ (cho phép: ${allowed.join(', ')}).`);
  }
  return value as T;
}
