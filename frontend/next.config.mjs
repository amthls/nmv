// Content-Security-Policy: limits where scripts, styles, frames and connections may come from, so an
// injected tag cannot load a remote script or post data elsewhere. Next inlines its bootstrap scripts
// and CKEditor sets inline styles, hence 'unsafe-inline' (a nonce setup would need dynamic rendering).
// Images may come from any https host (covers of imported stories are hot-linked).
// Turnstile (optional bot check) needs Cloudflare's script and iframe; allowed only when it is switched on.
const turnstile = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? ' https://challenges.cloudflare.com' : '';
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${turnstile}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  turnstile ? `frame-src${turnstile}` : "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // do not advertise the framework
  // next/image is not used (SmartImage is a plain <img>), so the /_next/image optimizer stays off:
  // with open remotePatterns it was a public image proxy and has had critical CVEs.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: CSP },
          // HSTS is sent by the nginx gateway, only to visitors who arrived over HTTPS
        ],
      },
    ];
  },
  async rewrites() {
    // CATALOG_ORIGIN lets a local `next dev` reach the API outside docker (e.g. http://localhost:5000)
    const backend = process.env.CATALOG_ORIGIN || 'http://catalog:5000';
    return [
      { source: '/api/v1/:path*', destination: `${backend}/api/v1/:path*` },
      { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
