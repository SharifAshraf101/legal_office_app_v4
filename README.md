# Legal Office

A bilingual (Hebrew / Arabic), fully RTL legal-practice management system for small and mid-size law offices. Manage clients, cases, hearings, tasks, finances, and documents from one responsive workspace — and give clients a self-service portal with an AI assistant.

Built with **Next.js 16**, **React 18**, **TypeScript**, **Tailwind CSS**, and **Supabase**, installable as a PWA on desktop, tablet, and mobile.

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
- ☁️ **Live sync** — Supabase backend with an auto-sync hook and conflict handling.
- 📱 **PWA** — installable standalone app with iOS/Android manifest and meta tags.
- 🎨 **Theming** — light/dark theme plus configurable font family and size.
- 💾 **Backup** — one-click export/import of office data.

---

## Tech Stack

- **Framework:** Next.js 16 (App Router) · React 18 · TypeScript
- **Styling:** Tailwind CSS · PostCSS · Autoprefixer
- **Backend:** Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- **AI:** Anthropic SDK (`@anthropic-ai/sdk`)
- **Icons:** Lucide React
- **Deploy:** Netlify (config in [netlify.toml](netlify.toml))

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project
- An Anthropic API key (for the portal bot)

### Installation

```bash
npm install
```

### Environment variables

Create a `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
ANTHROPIC_API_KEY=your-anthropic-key
```

### Database

Apply the schema and migrations from [db/](db/) to your Supabase project:

```bash
db/schema.sql                      # base schema
db/documents_add_description.sql   # migration
db/fk_resolve.sql                  # migration
```

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
app/            Next.js App Router — pages, layout, API routes (portal bot), manifest
components/     UI: screens, modals, sidebar/topbar/mobile-nav, portal
hooks/          App state, auto-sync, theme/font, modal stack, i18n (useT)
lib/            Domain logic — clients, cases, calendar, tasks, finance, documents,
                portal, dropbox, supabase, storage, translations, dates, utils
db/             SQL schema and migrations
public/         Static assets and PWA icons
scripts/        Build-time extraction scripts
```

---

## Deployment

The app deploys to **Netlify** out of the box ([netlify.toml](netlify.toml)). Set the same environment variables in your hosting provider's dashboard before deploying.

---

## License

Private — all rights reserved.
