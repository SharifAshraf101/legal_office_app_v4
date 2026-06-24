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

  // ...but DON'T 308-redirect the non-canonical form. Meta's WhatsApp
  // webhook POSTs to `/api/whatsapp/webhook` (no slash) and does NOT follow
  // redirects — a 308 there is a silent delivery failure (no function log,
  // nothing saved). With this flag both `/api/whatsapp/webhook` and
  // `/api/whatsapp/webhook/` are served by the handler directly, 200 either
  // way, so the webhook is robust to however the URL is registered in Meta.
  skipTrailingSlashRedirect: true,

  reactStrictMode: true,
};

module.exports = nextConfig;
