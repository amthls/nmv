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
          { key: 'Strict-Transport-Security', value: 'max-age=15552000' }, // ignored over plain http
        ],
      },
    ];
  },
  async rewrites() {
    // BACKEND_ORIGIN lets a local `next dev` reach the API outside docker (e.g. http://localhost:5000)
    const backend = process.env.BACKEND_ORIGIN || 'http://backend:5000';
    return [
      { source: '/api/v1/:path*', destination: `${backend}/api/v1/:path*` },
      { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
