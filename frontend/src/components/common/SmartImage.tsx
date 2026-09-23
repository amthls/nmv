'use client';

import React, { useState } from 'react';
import { imageUrlForQuality, useImageQuality } from '@/lib/imageQuality';

interface SmartImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallbackSrc?: string;
  /** Request the resolution the reader picked in reader settings (uploaded images only) */
  adaptive?: boolean;
}

export default function SmartImage({
  src,
  alt = '',
  className = '',
  fallbackSrc = 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80',
  adaptive = false,
  ...props
}: SmartImageProps) {
  const [quality] = useImageQuality();
  const wanted = adaptive ? imageUrlForQuality(src, quality) || src : src;
  const [imgSrc, setImgSrc] = useState(wanted || fallbackSrc);
  const [hasError, setHasError] = useState(false);

  // Sync state if src prop or chosen quality changes
  React.useEffect(() => {
    setImgSrc(wanted || fallbackSrc);
    setHasError(false);
  }, [wanted, fallbackSrc]);

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={className}
      onError={() => {
        // A failed resized copy falls back to the original file first, then to the placeholder
        if (wanted !== src && imgSrc === wanted && src) {
          setImgSrc(src);
        } else if (!hasError) {
          setHasError(true);
          setImgSrc(fallbackSrc);
        }
      }}
      loading="lazy"
      {...props}
    />
  );
}
