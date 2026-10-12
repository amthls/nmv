import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import SortedStoriesPage from '@/components/explore/SortedStoriesPage';
import PageLoader from '@/components/common/PageLoader';

export const metadata: Metadata = { title: 'Nhiều người xem - NovelHub' };

export default function MostViewedPage() {
  return (
    <Suspense fallback={<PageLoader label="Đang tải..." />}>
      <SortedStoriesPage title="Nhiều người xem" subtitle="Xếp hạng theo tổng lượt xem từ trước tới nay." sort="views" meta="views" ranked />
    </Suspense>
  );
}
