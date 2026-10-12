'use client';

import { useEffect } from 'react';
import { startNavTracking } from '@/lib/nav';

/** Mounted once in the root layout: keeps the in-site history of this tab (lib/nav.ts). */
export default function NavTracker() {
  useEffect(() => startNavTracking(), []);
  return null;
}
