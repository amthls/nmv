'use client';

import type { ComponentType } from 'react';
import { useSkin } from '@/lib/theme';
import { AeIcon, AE_PATHS, type AeIconName, type AeIconProps } from './AeIcon';

/**
 * Skin mặc định: render đúng icon lucide như cũ. Skin Aemeath: icon pha lê vẽ tay (nếu có `ae`).
 * Kích thước: `size` hoặc className w-xx/h-xx (CSS ghi đè width/height thuộc tính).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SkinIcon({ lucide: Lucide, ae, ...props }: AeIconProps & { lucide: ComponentType<any>; ae: AeIconName }) {
  const { skin } = useSkin();
  if (skin === 'aemeath' && AE_PATHS[ae]) return <AeIcon name={ae} {...props} />;
  return <Lucide {...props} />;
}

/** Tạo sẵn component: `const HomeIcon = skinIcon(Home, 'home')`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function skinIcon(Lucide: ComponentType<any>, ae: AeIconName) {
  const Comp = (props: AeIconProps) => <SkinIcon lucide={Lucide} ae={ae} {...props} />;
  Comp.displayName = `SkinIcon(${ae})`;
  return Comp;
}
