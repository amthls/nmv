'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** A "back" link: goes to the previous page when there is one (so Back never loops), else to its href. */
export default function BackLink({ href, onClick, ...props }: React.ComponentProps<typeof Link>) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      {...props}
    />
  );
}
