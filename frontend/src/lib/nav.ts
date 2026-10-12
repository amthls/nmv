/**
 * The only place that knows "where the user came from" (Plan/navigation.md). It keeps the stack of in-site URLs of
 * this tab in sessionStorage, in step with the browser history, so "back" never guesses:
 *  - BackLink (components/common/BackLink.tsx): always goes to the page its label names;
 *  - BackButton / goBack: the previous page of this site in this tab, else a fallback; never out of the site.
 * Never call router.back(), history.back() or read history.length elsewhere (scripts/check-nav.sh).
 */

const KEY = 'nh:navstack';
const MAX = 50;

const here = () => window.location.pathname + window.location.search;
const pathOf = (url: string) => url.split(/[?#]/)[0];

function read(): string[] {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    return Array.isArray(s) ? s : [];
  } catch {
    return [];
  }
}

function write(s: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s.slice(-MAX)));
  } catch { /* storage off: back falls back to the fallback */ }
}

function sameSite(url: string | URL | null | undefined): string | null {
  if (url == null) return here();
  const u = new URL(String(url), window.location.href);
  return u.origin === window.location.origin ? u.pathname + u.search : null;
}

function pushed(p: string) {
  const s = read();
  if (s[s.length - 1] !== p) write([...s, p]);
}

// a history step (back or forward): back if it lands on the entry below the top
function stepped() {
  const s = read();
  const p = here();
  if (s[s.length - 2] === p) write(s.slice(0, -1));
  else pushed(p);
}

/** Called once by NavTracker in the root layout. */
export function startNavTracking() {
  const w = window as any;
  if (w.__nhNav) return;
  w.__nhNav = true;

  // a tab opened from a link copies sessionStorage but not window.name: start a fresh stack there
  if (!window.name.startsWith('nh:')) {
    window.name = `nh:${Math.random().toString(36).slice(2)}`;
    write([]);
  }
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type === 'back_forward') stepped();
  else pushed(here()); // a reload keeps the top as it is

  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function (data, unused, url) {
    push.call(this, data, unused, url);
    const p = sameSite(url);
    if (p) pushed(p);
  };
  history.replaceState = function (data, unused, url) {
    replace.call(this, data, unused, url);
    const p = sameSite(url);
    if (!p) return;
    const s = read();
    write(s.length ? [...s.slice(0, -1), p] : [p]);
  };
  window.addEventListener('popstate', stepped);
}

/** The page of this site the user was on before this one, in this tab; null on a fresh tab or a direct link. */
export function previousRoute(): string | null {
  const s = read();
  return s.length >= 2 ? s[s.length - 2] : null;
}

/** True when the previous page is `href` (path only): going back there restores its scroll and state. */
export function cameFrom(href: string): boolean {
  const prev = previousRoute();
  return !!prev && pathOf(prev) === pathOf(href);
}

type Router = { back: () => void; push: (href: string) => void };

/** Back to the previous page of this site, else to `fallback` (after a delete, a discarded draft...). */
export function goBack(router: Router, fallback: string) {
  if (previousRoute()) router.back();
  else router.push(fallback);
}
