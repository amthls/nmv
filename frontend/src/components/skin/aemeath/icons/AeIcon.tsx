import type { ReactNode, SVGProps } from 'react';

export interface AeIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number | string;
  strokeWidth?: number | string;
}

/** Điểm sao 4 cánh lấp lánh (tô đặc) tại (x,y), bán kính r. */
function Sp({ x, y, r = 1.6 }: { x: number; y: number; r?: number }) {
  const k = r * 0.32;
  const d = `M${x} ${y - r}L${x + k} ${y - k}L${x + r} ${y}L${x + k} ${y + k}L${x} ${y + r}L${x - k} ${y + k}L${x - r} ${y}L${x - k} ${y - k}Z`;
  return <path d={d} fill="currentColor" stroke="none" className="ae-spark" />;
}

/** Nét mảnh, góc tinh thể; mọi icon trên lưới 24x24. */
export const AE_PATHS: Record<string, ReactNode> = {
  home: <><path d="M3 11.5 12 3l9 8.5" /><path d="M5.5 10v10h13V10" /><path d="M10 20v-5.5l2-1.5 2 1.5V20" /><Sp x={19} y={4.5} r={1.5} /></>,
  search: <><path d="M10.5 3.5 16 6.5v6l-5.5 3-5.5-3v-6Z" /><path d="m14.5 14.5 6 6" /><Sp x={19.5} y={4.5} r={1.5} /></>,
  bookmark: <><path d="M6 3h12v18l-6-4.5L6 21Z" /><Sp x={12} y={8.5} r={2.2} /></>,
  bell: <><path d="M12 3 6.5 9v5L4 17.5h16L17.5 14V9Z" /><path d="M10 20h4" /><Sp x={19.5} y={4} r={1.5} /></>,
  heart: <><path d="M12 20.5 3.5 12 3 8l3-3.5 3.2.4L12 7.5l2.8-2.6 3.2-.4L21 8l-.5 4Z" /><Sp x={12} y={11.5} r={1.7} /></>,
  star: <><path d="M12 2.5 14.2 9.8 21.5 12 14.2 14.2 12 21.5 9.8 14.2 2.5 12 9.8 9.8Z" /><Sp x={12} y={12} r={1.3} /></>,
  user: <><path d="M12 3.5 16 6v4.5L12 13l-4-2.5V6Z" /><path d="M4.5 21v-2.5L8.5 15h7l4 3.5V21Z" /><Sp x={19.5} y={4} r={1.4} /></>,
  menu: <><path d="M4 6.5h16M4 12h11M4 17.5h16" /><Sp x={19} y={12} r={1.6} /></>,
  x: <><path d="m5 5 14 14M19 5 5 19" /><Sp x={12} y={12} r={1.8} /></>,
  chevronLeft: <><path d="m15 4-8 8 8 8" /><Sp x={18.5} y={12} r={1.3} /></>,
  chevronRight: <><path d="m9 4 8 8-8 8" /><Sp x={5.5} y={12} r={1.3} /></>,
  chevronDown: <><path d="m4 9 8 8 8-8" /><Sp x={12} y={5} r={1.3} /></>,
  chevronUp: <><path d="m4 15 8-8 8 8" /><Sp x={12} y={19} r={1.3} /></>,
  check: <><path d="m4 12.5 5 5L20 6.5" /><Sp x={19} y={16.5} r={1.4} /></>,
  plus: <><path d="M12 4v16M4 12h16" /><Sp x={12} y={12} r={2} /></>,
  settings: <><path d="M12 2.5 19.5 7v10L12 21.5 4.5 17V7Z" /><path d="M12 8.5 15 10.3v3.4L12 15.5 9 13.7v-3.4Z" /></>,
  message: <><path d="M4 4.5h16v12h-8l-5 4v-4H4Z" /><path d="M8 9h8M8 12.5h5" /><Sp x={19} y={4} r={1.4} /></>,
  bookOpen: <><path d="M12 6.5C10 5 7 4.5 3 4.5v14c4 0 7 .5 9 2 2-1.5 5-2 9-2v-14c-4 0-7 .5-9 2Z" /><path d="M12 6.5v14" /><Sp x={7.5} y={10} r={1.4} /></>,
  eye: <><path d="M2 12 7 7h10l5 5-5 5H7Z" /><path d="M12 9.5 14.5 12 12 14.5 9.5 12Z" /></>,
  eyeOff: <><path d="M2 12 7 7h10l5 5-5 5H7Z" /><path d="m4 4 16 16" /><Sp x={12} y={12} r={1.4} /></>,
  clock: <><path d="M12 2.5 19.5 6l2 6-2 6-7.5 3.5L4.5 18l-2-6 2-6Z" /><path d="M12 7v5l3.5 2" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v5h16v-5" /><Sp x={19} y={9} r={1.4} /></>,
  edit: <><path d="m4 20 1-5L16.5 3.5l4 4L9 19Z" /><path d="m14 6 4 4" /><Sp x={19.5} y={18.5} r={1.4} /></>,
  trash: <><path d="M4 6.5h16M9 6.5V3.5h6v3" /><path d="m6 6.5 1 14h10l1-14" /><path d="M10 10.5v6M14 10.5v6" /></>,
  share: <><path d="M12 3 20 12l-8 3-8-3Z" /><path d="M12 15v6" /><Sp x={19.5} y={19} r={1.4} /></>,
  filter: <><path d="M3.5 4.5h17L14 12v7.5l-4 1.5v-9Z" /><Sp x={19} y={19} r={1.3} /></>,
  sun: <><path d="M12 7.5 16.5 12 12 16.5 7.5 12Z" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" /></>,
  moon: <><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" /><Sp x={17.5} y={5.5} r={1.8} /></>,
  logOut: <><path d="M10 3.5H4.5v17H10" /><path d="M9 12h11M16 7.5l4.5 4.5-4.5 4.5" /></>,
  logIn: <><path d="M14 3.5h5.5v17H14" /><path d="M3.5 12h11M10 7.5l4.5 4.5-4.5 4.5" /></>,
  flame: <><path d="M12 2.5c1 4 6 6 6 11.5a6 6 0 0 1-12 0c0-2.5 1.5-4 2.5-5 .3 1.5 1 2.2 2 2.5C10 8.5 10.5 5 12 2.5Z" /><Sp x={12} y={15} r={1.5} /></>,
  lock: <><path d="M5.5 10.5h13v10h-13Z" /><path d="M8 10.5V7l4-4 4 4v3.5" /><Sp x={12} y={15.5} r={1.6} /></>,
  key: <><path d="M8 5 11.5 8v4L8 15l-3.5-3V8Z" /><path d="M11 11.5 20.5 20M16 16l2.5-2.5" /></>,
  library: <><path d="M4 4h4v16H4ZM10 4h4v16h-4Z" /><path d="m16 5.5 3.8-1 3 14.5-3.8 1Z" /></>,
  sparkles: <><path d="M10 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" /><Sp x={19} y={5} r={2} /><Sp x={18.5} y={18.5} r={1.5} /></>,
  send: <><path d="M21 3 3 10.5l7 3 3 7Z" /><path d="m10 13.5 11-10.5" /></>,
  globe: <><path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7Z" /><path d="M3.5 12h17M12 2.5c-3 3-3 16 0 19M12 2.5c3 3 3 16 0 19" /></>,
  reply: <><path d="M10 5 3.5 11.5 10 18" /><path d="M3.5 11.5H14a6.5 6.5 0 0 1 6.5 6.5V20" /><Sp x={19} y={5} r={1.4} /></>,
  users: <><path d="M9 4 11.5 5.5v3L9 10 6.5 8.5v-3Z" /><path d="M3 19v-2l3.5-2.5h5L15 17v2Z" /><path d="M16 5l2 1.2v2.6L16 10" /><path d="M17 14.5l4 2.5v2" /></>,
};

export type AeIconName = keyof typeof AE_PATHS | (string & {});

export function AeIcon({
  name, size = 24, strokeWidth = 1.5, className, ...rest
}: AeIconProps & { name: AeIconName }) {
  const body = AE_PATHS[name];
  if (!body) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide ae-icon ae-icon-${name}${className ? ` ${className}` : ''}`}
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
    >
      {body}
    </svg>
  );
}
