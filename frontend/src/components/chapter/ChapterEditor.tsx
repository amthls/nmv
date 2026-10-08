'use client';

import dynamic from 'next/dynamic';
import type { ChapterEditorProps } from './ChapterEditorImpl';
import BookLoader from '@/components/common/BookLoader';

// CKEditor needs the browser and is heavy: load it on demand.
const ChapterEditor = dynamic<ChapterEditorProps>(() => import('./ChapterEditorImpl'), {
  ssr: false,
  loading: () => (
    <div className="h-80 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
      <BookLoader size="sm" label="Đang tải trình soạn thảo..." delayMs={200} />
    </div>
  ),
});

export default ChapterEditor;
