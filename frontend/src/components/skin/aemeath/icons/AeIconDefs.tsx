/** Gắn một lần trong layout: gradient hồng→cyan cho stroke icon (id cố định `ae-icon-grad`). */
export function AeIconDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', pointerEvents: 'none' }}>
      <defs>
        <linearGradient id="ae-icon-grad" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">
          <stop offset="0" stopColor="#f472b6" />
          <stop offset="1" stopColor="#67e8f9" />
        </linearGradient>
      </defs>
    </svg>
  );
}
