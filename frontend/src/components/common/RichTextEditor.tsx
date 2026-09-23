'use client';

import dynamic from 'next/dynamic';
import type { RichTextEditorProps } from './RichTextEditorImpl';
import BookLoader from './BookLoader';

// CKEditor touches `window`/`document`, and is heavy: load it in the browser only, on demand.
const RichTextEditor = dynamic<RichTextEditorProps>(() => import('./RichTextEditorImpl'), {
  ssr: false,
  loading: () => (
    <div className="h-40 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
      <BookLoader size="sm" label="Đang tải trình soạn thảo..." delayMs={200} />
    </div>
  ),
});

export default RichTextEditor;
