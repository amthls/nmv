'use client';

import React from 'react';
import Link from '@/components/common/Link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cameFrom, goBack } from '@/lib/nav';

/**
 * A link to the page its label names (href). When the user came from exactly that page it steps back instead,
 * so the page comes back with its scroll position; it never goes anywhere else.
 */
export default function BackLink({ href, onClick, ...props }: React.ComponentProps<typeof Link>) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (cameFrom(String(href))) {
          e.preventDefault();
          router.back();
        }
      }}
      {...props}
    />
  );
}

/** "← Quay lại" for pages reached from many places: the previous page of this site, else `fallback`. */
export function BackButton({ fallback, className }: { fallback: string; className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => goBack(router, fallback)}
      className={className ?? 'inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition'}
    >
      <ArrowLeft className="w-4 h-4" /> Quay lại
    </button>
  );
}
