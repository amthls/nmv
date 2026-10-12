import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import SortedStoriesPage from '@/components/explore/SortedStoriesPage';
import PageLoader from '@/components/common/PageLoader';

export const metadata: Metadata = { title: 'Mới cập nhật - NovelHub' };

export default function RecentlyUpdatedPage() {
  return (
    <Suspense fallback={<PageLoader label="Đang tải..." />}>
      <SortedStoriesPage title="Mới cập nhật" subtitle="Truyện vừa có chương mới, mới nhất trước." sort="updated" meta="updated" />
    </Suspense>
  );
}
