'use client';

import React from 'react';
import { BackButton } from '@/components/common/BackLink';
import UploadModeSwitch from './UploadModeSwitch';
import { UploadMode } from '@/lib/chapterUpload';

/**
 * The top of both chapter uploaders (/dang-chuong, /dang-truyen-tranh), identical in both so switching between
 * them only swaps the editor below: Back (to the page before the uploader: the switch replaces history), the
 * novel / manga switch, the title.
 */
export default function UploadHeader({
  mode, groupId, showSwitch = true, title, description, aside,
}: {
  mode: UploadMode;
  groupId?: string | null;
  showSwitch?: boolean;
  title: string;
  description: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <BackButton fallback="/ws" />
      {showSwitch && <UploadModeSwitch mode={mode} groupId={groupId} />}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{title}</h1>
          <p className="text-xs sm:text-sm text-gray-400 max-w-2xl">{description}</p>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
    </div>
  );
}
