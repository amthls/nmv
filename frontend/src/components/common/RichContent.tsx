'use client';

import React from 'react';
import { isHtmlContent } from '@/lib/richText';
import { rewriteHtmlImages, useImageQuality } from '@/lib/imageQuality';

interface RichContentProps {
  content?: string | null;
  className?: string;
}

/**
 * Renders stored content. HTML comes from the rich-text editor and is sanitized by the API
 * before it is saved; anything without tags (older rows) is shown as plain text.
 * Embedded uploaded images follow the resolution the reader picked in reader settings.
 */
export default function RichContent({ content, className = '' }: RichContentProps) {
  const [quality] = useImageQuality();
  if (!content) return null;
  if (isHtmlContent(content)) {
    return <div className={`rich-content ${className}`} dangerouslySetInnerHTML={{ __html: rewriteHtmlImages(content, quality) }} />;
  }
  return <div className={`whitespace-pre-line break-words ${className}`}>{content}</div>;
}
