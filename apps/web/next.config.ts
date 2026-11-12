import type { NextConfig } from 'next';

/** Baseline security headers (M0 security review L1). */
const securityHeaders = [
  // No framing: protects one-click actions (accept invitation, team management) from clickjacking.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Ignored by browsers over plain http (local dev); enforced once served over https.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: securityHeaders },
      {
        // These URLs carry one-time tokens: never leak them in a Referer header.
        source: '/:page(verify-email|reset-password|accept-invite)',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ]);
  },
};

export default nextConfig;
