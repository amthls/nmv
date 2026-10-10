import type { Metadata } from 'next';

// The page's URL carries a one-time account token: never send it on as a Referer
export const metadata: Metadata = { referrer: 'no-referrer' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
