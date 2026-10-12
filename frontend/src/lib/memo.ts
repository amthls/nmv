/**
 * Answers kept in memory for this page session (Plan/load.md A3), so going back to something already seen (a tab, the
 * previous story on the workspace shelf) shows it at once without asking the server again. Only for data that may be a
 * little old: after a change, call `forget` (or pass `fresh`) so the next read asks the server.
 */

const store = new Map<string, { at: number; value: Promise<unknown> }>();

export function remembered<T>(key: string, ttlMs: number, load: () => Promise<T>, fresh = false): Promise<T> {
  const hit = store.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { at: Date.now(), value });
  value.catch(() => store.delete(key)); // a failed answer is never kept
  return value;
}

export function forget(key: string) {
  store.delete(key);
}
