'use client';

import React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * The site's Link (Plan/load.md A1): next/link prefetches every link that scrolls into view, so one story page made the
 * server render ~15 other pages nobody opened. Here a page is prefetched only when the pointer is on its link (hover or
 * touch), which is still before the click. `prefetch` passed explicitly keeps the next/link behaviour.
 */
export default function Link({ href, prefetch, onMouseEnter, onTouchStart, ...props }: React.ComponentProps<typeof NextLink>) {
  const router = useRouter();
  const warm = () => {
    if (typeof href === 'string' && href.startsWith('/')) router.prefetch(href);
  };
  return (
    <NextLink
      href={href}
      prefetch={prefetch ?? false}
      onMouseEnter={(e) => { onMouseEnter?.(e); if (prefetch === undefined) warm(); }}
      onTouchStart={(e) => { onTouchStart?.(e); if (prefetch === undefined) warm(); }}
      {...props}
    />
  );
}
