// Label colors offered by the API (backend LABEL_COLORS). Full class strings so Tailwind keeps them.
export const LABEL_STYLES: Record<string, { dot: string; chip: string; chipActive: string }> = {
  sky: { dot: 'bg-sky-400', chip: 'bg-sky-500/10 text-sky-300 border-sky-500/25', chipActive: 'bg-sky-500 text-snow border-sky-400' },
  emerald: { dot: 'bg-emerald-400', chip: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25', chipActive: 'bg-emerald-500 text-snow border-emerald-400' },
  amber: { dot: 'bg-amber-400', chip: 'bg-amber-500/10 text-amber-300 border-amber-500/25', chipActive: 'bg-amber-500 text-snow border-amber-400' },
  rose: { dot: 'bg-rose-400', chip: 'bg-rose-500/10 text-rose-300 border-rose-500/25', chipActive: 'bg-rose-500 text-snow border-rose-400' },
  fuchsia: { dot: 'bg-fuchsia-400', chip: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/25', chipActive: 'bg-fuchsia-500 text-snow border-fuchsia-400' },
  teal: { dot: 'bg-teal-400', chip: 'bg-teal-500/10 text-teal-300 border-teal-500/25', chipActive: 'bg-teal-500 text-snow border-teal-400' },
  orange: { dot: 'bg-orange-400', chip: 'bg-orange-500/10 text-orange-300 border-orange-500/25', chipActive: 'bg-orange-500 text-snow border-orange-400' },
  lime: { dot: 'bg-lime-400', chip: 'bg-lime-500/10 text-lime-300 border-lime-500/25', chipActive: 'bg-lime-500 text-ink border-lime-400' },
};

export const labelStyle = (color: string) => LABEL_STYLES[color] || LABEL_STYLES.sky;

export type DmLabel = { id: string; name: string; color: string; conversation_count: number };
