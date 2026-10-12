import { useEffect, useRef, useState } from 'react';

/** Narrowest a story card may get, and the gap between cards (Tailwind gap-4). */
export const CARD_MIN_PX = 150;
export const CARD_GAP_PX = 16;

/**
 * How many story-card columns fit the measured box: as many as keep each card at least `min` wide, at least 2.
 * A wider screen gets more columns instead of bigger cards (Plan/load-and-layout.md C1). Put `ref` on an element that
 * is always rendered (not one that swaps between skeleton and results).
 */
export function useAutoColumns<T extends HTMLElement = HTMLDivElement>(min = CARD_MIN_PX, gap = CARD_GAP_PX) {
  const ref = useRef<T>(null);
  const [columns, setColumns] = useState(5);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (width: number) => setColumns(Math.max(2, Math.floor((width + gap) / (min + gap))));
    fit(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => fit(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min, gap]);
  return [ref, columns] as const;
}

/** The grid style for `columns` equal columns. */
export const columnsStyle = (columns: number) => ({ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` });
