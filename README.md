# Legal Office

A bilingual (Hebrew / Arabic), fully RTL legal-practice management system for small and mid-size law offices. Manage clients, cases, hearings, tasks, finances, and documents from one responsive workspace — and give clients a self-service portal with an AI assistant.

Built with **Next.js 16**, **React 18**, **TypeScript**, **Tailwind CSS**, and a **Cloudflare Workers + D1 + R2** backend, installable as a PWA on desktop, tablet, and mobile.

---

## Features

| Module | What it does |
| --- | --- |
| **Dashboard** | At-a-glance home with greeting, upcoming agenda, and quick navigation. |
| **Clients** | Full client directory with detail, edit, and create flows, plus avatars. |
| **Cases** | Case records with status tracking, last-hearing card, and status warnings. |
| **Calendar** | Day / week / month / list views, events, appointments, and an upcoming-agenda modal. |
| **Tasks** | Task board with quick filters and per-case task panels. |
| **Finance** | Per-case payments, balances, payment history, and finance editing. |
| **Documents** | Document management with per-case document modals and Dropbox sync. |
| **Client Portal** | Client search, WhatsApp communication panel, AI chat bot, and history. |
| **Global Search** | Search across clients, cases, and records from anywhere. |
| **Settings** | Office name & address, language, theme, font family & size, alerts, and backup export/import. |

### Highlights

- 🌐 **Bilingual & RTL-first** — Hebrew (default) and Arabic, with a full-screen language picker on launch.
- 🤖 **AI portal assistant** — client-facing chat bot powered by the Anthropic API.
- ☁️ **Live sync** — Cloudflare D1 backend with an auto-sync hook and conflict handling.
- 📱 **PWA** — installable standalone app with iOS/Android manifest and meta tags.
- 🎨 **Theming** — light/dark theme plus configurable font family and size.
- 💾 **Backup** — one-click export/import of office data.

---

## Tech Stack

- **Framework:** Next.js 16 (App Router) · React 18 · TypeScript
- **Styling:** Tailwind CSS · PostCSS · Autoprefixer
- **Backend:** Cloudflare Workers · D1 (SQL) · R2 (storage) — see [worker/](worker/) (migrated off Supabase; v3 kept as rollback)
- **AI:** Anthropic SDK (`@anthropic-ai/sdk`)
- **Icons:** Lucide React
- **Deploy:** Vercel (frontend, `vercel --prod`) · Cloudflare Wrangler (worker, `wrangler deploy --config wrangler.v4.toml`)

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Cloudflare account (Workers, D1, R2) — the Worker lives in [worker/](worker/)
- An Anthropic API key (for the portal bot and the AI routes)

### Installation

```bash
npm install
```

### Environment variables

Copy [.env.example](.env.example) to `.env.local` and fill it in. `.env.local` is
gitignored — never commit real tokens.

```bash
NEXT_PUBLIC_WORKER_URL=https://legal-office-api-v4.<your-subdomain>.workers.dev
NEXT_PUBLIC_APP_TOKEN=<must match the Worker's APP_TOKEN>
ANTHROPIC_API_KEY=<server-side only>
```

WhatsApp integration (operator office only) additionally needs
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, and
`WHATSAPP_VERIFY_TOKEN`. These are read server-side only and the routes fail
closed when they are unset.

### Database

The live schema is Cloudflare D1, applied via Wrangler from [worker/](worker/):

```bash
cd worker
npx wrangler d1 execute legal-office-v4 --remote --file=office-schema.sql
```

Incremental D1 migrations live in [db/](db/) as the `*_d1.sql` files. The
Postgres files in that folder (`schema.sql`, `fk_resolve.sql`) are the retired
Supabase schema, kept for historical reference — do not apply them to D1.
See [RUNBOOK.md](RUNBOOK.md) for the full backend setup walkthrough.

### Run

```bash
npm run dev
# open http://localhost:3000
```

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Production build. |
| `npm run start` | Run the production server. |
| `npm run lint` | Lint the codebase. |
| `npm run extract-css` | Regenerate `app/globals.css` from source style blocks. |
| `npm run extract-assets` | Extract bundled assets. |

---

## Project Structure

```
app/            Next.js App Router — pages, layout, API routes (portal bot, AI,
                WhatsApp webhook/send/media), admin console, manifest
components/     UI: screens, modals, sidebar/topbar/mobile-nav, portal
hooks/          App state, auto-sync, theme/font, modal stack, i18n (useT)
lib/            Domain logic — clients, cases, calendar, tasks, finance, documents,
                portal, dropbox, cloudflare, storage, translations, dates, utils
worker/         Cloudflare Worker — D1/R2 data API, Better Auth control plane,
                multi-tenant resolver, AI endpoints
db/             D1 migrations (*_d1.sql) + retired Supabase schema
public/         Static assets and PWA icons
scripts/        Build-time extraction scripts
```

---

## Deployment

Two pieces deploy separately:

| Piece | Command |
| --- | --- |
| Frontend (Next.js) → **Vercel** | `vercel --prod` |
| Backend (Worker) → **Cloudflare** | `cd worker && npx wrangler deploy -c wrangler.v4.toml` |

Set the environment variables above in the Vercel dashboard, and the Worker's
secrets with `wrangler secret put` (`ANTHROPIC_API_KEY`, `BETTER_AUTH_SECRET`,
`ADMIN_TOKEN`, `CF_D1_TOKEN`, `DROPBOX_REFRESH_TOKEN`).

> The app is **not** a static export — it uses SSR and Route Handlers, so any
> host must run Next.js natively. The legacy `netlify.toml` still declares
> `publish = "out"`, which this build no longer produces; it is stale and unused.

---

## License

Private — all rights reserved.
