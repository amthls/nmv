'use client';

import React, { useEffect, useState } from 'react';
import BookLoader from './BookLoader';

interface PageLoaderProps {
  label?: string;
  /** Full-height block (route loading) or compact block inside a page */
  fullHeight?: boolean;
}

/**
 * Centered loader for whole pages. Appears after a short delay (no flash on fast loads)
 * and changes its message when loading is taking unusually long.
 */
export default function PageLoader({ label = 'Đang tải...', fullHeight = true }: PageLoaderProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`flex items-center justify-center px-4 ${fullHeight ? 'min-h-[60vh]' : 'py-16'}`}>
      <BookLoader
        delayMs={250}
        label={slow ? 'Đang mất nhiều thời gian hơn bình thường, vui lòng đợi thêm chút...' : label}
        className="text-center max-w-xs"
      />
    </div>
  );
}
