/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deploying on Vercel, which serves Next.js natively (SSR + Route
  // Handlers). The previous `output: 'export'` produced a static-only
  // build and dropped API routes — incompatible with /api/bot. Leaving
  // images unoptimized for now so behavior matches the prior static
  // deploys; flip to default if you want Vercel's image optimization.
  images: { unoptimized: true },

  // Trailing slash mirrors the previous static-site routing convention.
  trailingSlash: true,

  reactStrictMode: true,
};

module.exports = nextConfig;
