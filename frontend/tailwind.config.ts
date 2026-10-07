import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

/*
 * Theme system
 * ------------
 * The UI was written dark-first (text-white, bg-white/5, text-gray-400, bg-black/40 ...).
 * Instead of rewriting ~1500 class names, white / black / gray and the light shades (50-400)
 * of every accent hue are CSS variables. Dark mode keeps the stock Tailwind values; light
 * mode inverts the neutrals (white <-> ink, black <-> white) and darkens the light accent
 * shades so they stay readable on a white page.
 *
 *   html.dark  -> dark palette      (default: light palette on :root)
 *   .dark / .light on any element   -> forces that palette for its subtree
 *   snow / ink                      -> real white / near-black that never flip (text on photos,
 *                                      text on solid accent buttons)
 */

// Accent: ocean blue. Secondary accent classes (indigo / purple / violet) render in the same hue.
const brand: Record<string, string> = {
  50: '#eff7ff', 100: '#dbedfe', 200: '#bfe0fe', 300: '#93ccfd', 400: '#5aaff8',
  500: '#2b8ff0', 600: '#1672d6', 700: '#145cb0', 800: '#164d8f', 900: '#174276', 950: '#102a4d',
};

const HUES: Record<string, Record<string, string>> = {
  brand,
  rose: colors.rose, amber: colors.amber, indigo: brand, emerald: colors.emerald,
  cyan: colors.cyan, red: colors.red, blue: colors.blue, purple: brand,
  green: colors.green, teal: colors.teal, sky: colors.sky, violet: brand,
  pink: colors.pink, fuchsia: colors.fuchsia, orange: colors.orange, yellow: colors.yellow,
  lime: colors.lime,
};
const FLIPPED_SHADES = ['50', '100', '200', '300', '400'];
// On a light page a "light" accent shade is rendered as its darker counterpart
const LIGHT_SHADE_OF: Record<string, string> = { '50': '950', '100': '900', '200': '800', '300': '700', '400': '600' };

// Neutral greys (no colour cast), inverted for the light page
const LIGHT_GRAY: Record<string, string> = {
  50: '#18181b', 100: '#27272a', 200: '#3f3f46', 300: '#52525b', 400: '#71717a',
  500: '#8e8e96', 600: '#a1a1aa', 700: '#d4d4d8', 800: '#e4e4e7', 900: '#f4f4f5', 950: '#fafafa',
};
const DARK_GRAY = colors.neutral as unknown as Record<string, string>;

const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const SURFACES = {
  light: { surface: '#ffffff', 'surface-2': '#ffffff', 'surface-3': '#f4f4f5' },
  dark: { surface: '#141414', 'surface-2': '#1c1c1c', 'surface-3': '#191919' },
};

function paletteVars(mode: 'light' | 'dark') {
  const out: Record<string, string> = {
    '--c-white': mode === 'light' ? '24 24 27' : '245 245 245',
    '--c-black': mode === 'light' ? '255 255 255' : '0 0 0',
  };
  for (const [k, hex] of Object.entries(DARK_GRAY)) {
    out[`--c-gray-${k}`] = rgb(mode === 'light' ? LIGHT_GRAY[k] : hex);
  }
  for (const [name, scale] of Object.entries(HUES)) {
    for (const s of FLIPPED_SHADES) {
      out[`--c-${name}-${s}`] = rgb(mode === 'light' ? scale[LIGHT_SHADE_OF[s]] : scale[s]);
    }
  }
  for (const [k, hex] of Object.entries(SURFACES[mode])) out[`--c-${k}`] = rgb(hex);
  return out;
}

function themedScale(name: string, scale: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [s, hex] of Object.entries(scale)) {
    out[s] = FLIPPED_SHADES.includes(s) ? v(`${name}-${s}`) : hex;
  }
  return out;
}

const themedHues = Object.fromEntries(
  Object.entries(HUES).map(([name, scale]) => [name, themedScale(name, scale)]),
);

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ...themedHues,
        brand: { ...themedHues.brand, accent: '#1672d6' },
        white: v('white'),
        black: v('black'),
        gray: Object.fromEntries(Object.keys(colors.gray).map((k) => [k, v(`gray-${k}`)])),
        zinc: Object.fromEntries(Object.keys(colors.gray).map((k) => [k, v(`gray-${k}`)])),
        snow: '#ffffff',
        ink: '#18181b',
        surface: { DEFAULT: v('surface'), 2: v('surface-2'), 3: v('surface-3') },
        dark: {
          bg: v('surface'),
          card: v('surface-2'),
          cardHover: v('surface-3'),
          border: 'rgb(var(--c-white) / 0.1)',
          text: v('white'),
          subtext: v('gray-400'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      // Tighter corners everywhere: images read as images, not as rounded bubbles
      borderRadius: {
        lg: '0.375rem',
        xl: '0.5rem',
        '2xl': '0.625rem',
        '3xl': '0.75rem',
      },
      transitionTimingFunction: {
        silk: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ':root, .light': { ...paletteVars('light'), colorScheme: 'light' },
        '.dark': { ...paletteVars('dark'), colorScheme: 'dark' },
      });
    }),
  ],
};

export default config;
