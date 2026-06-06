# Supabase → Cloudflare migration runbook

Run these in order. Steps that need a browser login or your Cloudflare account are
yours to run; everything is already coded. Commands are PowerShell-friendly
(Windows). Keep Supabase **readable** until the final verification passes — that is
your rollback.

> What moved where: relational data → **D1** (behind a Worker), client photos → **R2**,
> the old auto REST API → the **Worker** in `worker/`. Document files stay in Dropbox
> (unchanged).

---

## 0. Install + log in to Wrangler

```powershell
cd worker
npm install
npx wrangler login        # opens a browser to authorize your Cloudflare account
npx wrangler whoami       # confirm you're logged in
```

## 1. Create the D1 database and R2 bucket

The D1 database already exists — its `database_id`
(`22d82799-9240-43ee-bd6c-1258ec9d987d`) is already in `worker/wrangler.toml`, so
skip `d1 create`. You only need the R2 bucket:

```powershell
# still in worker/
npx wrangler r2 bucket create legal-office-photos-v3
```

> If you ever recreate the D1 database: `npx wrangler d1 create legal-office-v3`,
> then paste the new `database_id` into `worker/wrangler.toml`.

## 2. Apply the schema to D1

```powershell
npx wrangler d1 execute legal-office-v3 --remote --file=schema.sql
```

## 3. Set the access token (shared secret)

Pick a long random string (this becomes both the Worker secret and the app's
`NEXT_PUBLIC_APP_TOKEN`). For example: `[guid]::NewGuid().ToString('N')` in PowerShell.

```powershell
npx wrangler secret put APP_TOKEN
# paste the same string when prompted
```

## 4. Set the allowed origin(s)

Edit `worker/wrangler.toml` → `[vars] ALLOWED_ORIGIN`. Set it to where the app runs.
For local dev + a production domain, comma-separate, e.g.:

```toml
ALLOWED_ORIGIN = "http://localhost:3000,https://your-app-domain.com"
```

## 5. Deploy the Worker

```powershell
npx wrangler deploy
```

Note the printed URL, e.g. `https://legal-office-api.<you>.workers.dev`. Verify it:

```powershell
curl https://legal-office-api.<you>.workers.dev/api/health
# -> {"ok":true}
```

## 6. Migrate the data

From the **repo root** (one level up from `worker/`):

```powershell
cd ..
# WORKER_URL is used to rewrite client photo URLs into the new R2/Worker path.
$env:WORKER_URL = "https://legal-office-api.<you>.workers.dev"
node scripts/migrate-supabase-to-cloudflare.mjs
```

This writes everything to `migration-out/` (gitignored): per-table JSON snapshots,
downloaded photos, `seed.sql`, and `put-photos.ps1`.

Load the rows into D1, then the photos into R2:

```powershell
cd worker
npx wrangler d1 execute legal-office-v3 --remote --file=../migration-out/seed.sql
cd ../migration-out
powershell -ExecutionPolicy Bypass -File put-photos.ps1   # uploads each photo to R2
cd ..
```

> If `migration-out/photos` is empty, there were no client photos in the Supabase
> bucket (document files live in Dropbox) — that's expected; skip the photo step.

## 7. Point the app at Cloudflare

```powershell
# repo root
Copy-Item .env.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_WORKER_URL=https://legal-office-api.<you>.workers.dev
NEXT_PUBLIC_APP_TOKEN=<the same string from step 3>
```

Restart the dev server (env vars are read at build/start):

```powershell
npm run dev
```

## 8. Verify end-to-end

1. **Counts match**: compare row counts in `migration-out/*.json` against a fresh load.
   ```powershell
   curl -H "Authorization: Bearer <APP_TOKEN>" https://legal-office-api.<you>.workers.dev/api/load
   ```
2. **App loads** existing clients/cases/etc.
3. **Edit a client** → wait ~2s (autosave) → reload the page → the edit persists.
4. **Upload a client photo** → it shows, and the image URL is `…/api/photo/…`.
5. **Switch tabs and back** → the visibility-refresh pull still works (no errors in console).
6. **Photos render** for clients that already had one (URL rewrite worked).

## 9. Soak, then decommission Supabase

Run on Cloudflare for a few days with Supabase left intact (readable). Once you're
confident, stop using Supabase. Only after that, optionally delete the Supabase
project. Keep `migration-out/*.json` as a backup.

---

## Rollback

If anything is wrong, revert the two import lines and restart:

- `hooks/useAppState.tsx`: `@/lib/cloudflare` → `@/lib/supabase`
- `components/ClientAvatar.tsx`: `@/lib/cloudflare` → `@/lib/supabase`

Supabase is untouched and still authoritative during the soak, so no data is lost.

## Notes / limits

- **Auth**: `APP_TOKEN` lives in the client bundle (like the old anon key) and the
  Worker locks CORS to `ALLOWED_ORIGIN`. This gates casual access; it is **not** real
  per-user auth. The photo endpoint (`/api/photo`) is intentionally public so `<img>`
  tags work, matching the old public bucket. Upgrade path: Cloudflare Access / JWTs.
- **Re-running** the migration is safe — every insert is an upsert on
  `(user_id, source_id)` and photo uploads overwrite the same key.
- `lib/supabase.ts`, `db/`, and the Supabase deps stay in the tree until you finish the
  soak; remove them in a later cleanup commit.
