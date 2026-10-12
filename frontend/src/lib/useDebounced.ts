import { useEffect, useState } from 'react';
import { SEARCH_DELAY_MS } from '@/components/SearchBox';

/**
 * The value `delay` ms after it last changed (search fields: one request when typing stops, Plan/load-and-layout.md),
 * and whether a newer value is still waiting.
 */
export function useDebounced<T>(value: T, delay = SEARCH_DELAY_MS): [T, boolean] {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return [settled, settled !== value];
}
