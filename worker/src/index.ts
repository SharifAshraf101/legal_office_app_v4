// Cloudflare Worker API for the legal-office app. Replaces the Supabase
// PostgREST + Storage endpoints the browser used to call directly.
//
//   GET  /api/health        -> { ok: true }                (no auth)
//   GET  /api/photo/<key>   -> streams the R2 object        (no auth: parity
//                              with the old public Storage bucket; <img> tags
//                              cannot send an Authorization header)
//   GET  /api/load          -> all rows for the configured user (auth)
//   POST /api/save          -> upsert all tables            (auth)
//   POST /api/draft         -> read a PDF, draft a reply with Claude, save it (auth)
//   POST /api/upload-photo  -> store a client photo in R2   (auth)
//   POST /api/document      -> upload a filing doc into the office's Dropbox (auth)
//   GET  /api/legal-actions -> legal actions by court type  (auth)
//   POST /api/suggested-actions -> save AI suggested action (auth)
//   GET  /api/suggested-actions/:case_id -> get suggestions (auth)
//
// Auth is a shared bearer token (APP_TOKEN). CORS is locked to ALLOWED_ORIGIN.

import { corsHeaders, json, preflight } from './cors';
import { buildUpsert, LOAD_TABLES, safeParse, type Env } from './db';
import { resolveTenant, type Ctx } from './tenant';
import { createAuth, runAuthMigrations } from './auth';
import { provisionOfficeDb } from './provision';
import {
  billingPayload,
  computeBilling,
  isoPlusDays,
  nextPeriodEnd,
  operatorBilling,
  STANDARD_MONTHLY_PRICE,
  TRIAL_DAYS,
  type TenantBillingRow,
} from './billing';
import { AR_GLOSSARY } from './arabicGlossary';
import {
  configForTenant,
  deleteConfig,
  publicConfig,
  saveConfig,
  sendFromOffice,
  serveMedia,
  signedMediaUrl,
  webhookReceive,
  webhookVerify,
} from './whatsapp';
import { portalContext, portalLink, verifyPortalToken } from './portal';
import { handleAnalytics } from './analytics';
import { handleBriefing, handleBriefingArgument } from './briefing';
import { officeClearTurns, officeListTurns, officeSaveTurn, portalListTurns, portalSaveTurn } from './botHistory';
import { handleDocQueue, idsFromFileName, type DocJob, type PipelineCtx } from './docpipeline';
import { citedKnownDecisions, looksSharia, relevantRulings } from './rulings';
import {
  callAnthropicWithRetry,
  oversizedPdfBody,
  oversizedPdfField,
} from './pdfLimits';

// The office's own registered lawyer. Used to decide whether an incoming
// document was authored by US (no draft needed) vs. the other side / court.
// Overridable per-request via the `lawyer_name` body field.
const DEFAULT_LAWYER_NAME = 'أشرف شريف / אשרף שריף / Ashraf Sharif';

/** The operator's own login, allowed into the admin console without the token. */
const DEFAULT_ADMIN_EMAILS = 'sharifashraf@gmail.com';

/**
 * True when the request carries the operator's own signed-in session: the
 * account's email is an admin email AND that account is a member of the
 * operator office (tenant #1 = env.USER_ID). The email alone is not enough —
 * sign-up doesn't verify email ownership — while membership of tenant #1 can
 * only be granted from the control DB, never by signing up.
 */
async function adminSessionOk(request: Request, env: Env): Promise<boolean> {
  const session = await createAuth(env)
    .api.getSession({ headers: request.headers })
    .catch(() => null);
  const userId = session?.user?.id;
  const email = String(session?.user?.email || '').trim().toLowerCase();
  const admins = String(env.ADMIN_EMAILS || DEFAULT_ADMIN_EMAILS)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!userId || !email || !admins.includes(email)) return false;
  const row = await env.CONTROL_DB.prepare(
    'SELECT 1 AS ok FROM membership WHERE user_id = ?1 AND tenant_id = ?2 LIMIT 1',
  )
    .bind(userId, env.USER_ID)
    .first<{ ok: number }>();
  return !!row;
}

/** Gate for /api/admin/* — the separate operator token (NOT the app token), or
 *  the operator's own signed-in session (see adminSessionOk). */
async function adminOk(request: Request, env: Env): Promise<boolean> {
  const hdr = request.headers.get('Authorization') || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) return true;
  return adminSessionOk(request, env);
}

export default {
  /** Document pipeline consumer (see docpipeline.ts). */
  async queue(batch: MessageBatch<DocJob>, env: Env): Promise<void> {
    await handleDocQueue(batch, env, (pctx: PipelineCtx, body: Record<string, unknown>) =>
      handleDraft(
        new Request('https://internal/api/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env,
        { tenantId: pctx.tenantId, db: pctx.db, mode: 'tenant', billing: operatorBilling() },
      ),
    );
  },

  async fetch(request: Request, env: Env, execCtx?: ExecutionContext): Promise<Response> {
    try {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return preflight(request, env);

    // ----- public endpoints (no bearer token) -----
    // ----- per-office WhatsApp: public by necessity (Meta and <img>/<audio>
    //       can't send our bearer). The webhook checks Meta's signature with the
    //       receiving office's app secret; media URLs are HMAC-signed + expiring.
    if (path === '/api/whatsapp-webhook') {
      if (method === 'GET') return webhookVerify(env, url);
      if (method === 'POST') {
        return webhookReceive(env, request, (p) => {
          if (execCtx) execCtx.waitUntil(p);
        });
      }
    }
    if (method === 'GET' && path.startsWith('/api/whatsapp-media/')) {
      return serveMedia(env, url);
    }
    // ----- client bot portal: public, authorized by the SIGNED link token
    //       (one office + one client phone + expiry) — see portal.ts.
    if (method === 'GET' && path === '/api/portal-context') {
      const r = await portalContext(env, url.searchParams.get('t') || '');
      return json(r.body, request, env, r.status);
    }
    // A client's bot conversation (signed link in `t`). Without `t` these fall
    // through to the office (session) routes below.
    if (path === '/api/bot-history' && method === 'GET' && url.searchParams.get('t')) {
      const r = await portalListTurns(env, url.searchParams.get('t') || '');
      return json(r.body, request, env, r.status);
    }
    if (path === '/api/bot-history' && method === 'POST') {
      const b = (await request.clone().json().catch(() => ({}))) as { t?: string };
      if (b.t) {
        const r = await portalSaveTurn(env, b as Parameters<typeof portalSaveTurn>[1]);
        return json(r.body, request, env, r.status);
      }
    }
    if (method === 'GET' && path === '/api/portal-verify') {
      const who = await verifyPortalToken(env, url.searchParams.get('t') || '');
      return json({ ok: !!who }, request, env, who ? 200 : 401);
    }

    if (path === '/api/health') {
      return json({ ok: true }, request, env);
    }
    if (method === 'GET' && path.startsWith('/api/photo/')) {
      return servePhoto(env, path.slice('/api/photo/'.length));
    }

    // ----- multi-tenant control plane (additive; the single-office data path
    //       below is UNTOUCHED). Better Auth owns /api/auth/*; office-registry
    //       admin ops live under /api/admin/*, gated by ADMIN_TOKEN. -----
    if (path === '/api/auth' || path.startsWith('/api/auth/')) {
      const res = await createAuth(env).handler(request);
      // Re-attach CORS so the browser (Vercel) can read auth responses.
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders(request, env))) {
        headers.set(k, v);
      }
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    }
    if (path.startsWith('/api/admin/')) {
      if (!(await adminOk(request, env))) {
        return json({ error: 'unauthorized' }, request, env, 401);
      }
      if (method === 'POST' && path === '/api/admin/migrate') {
        await runAuthMigrations(env);
        return json({ ok: true, migrated: true }, request, env);
      }
      if (method === 'GET' && path === '/api/admin/offices') {
        const rs = await env.CONTROL_DB.prepare(
          `SELECT t.*,
                  (SELECT u.email FROM membership m JOIN user u ON u.id = m.user_id
                    WHERE m.tenant_id = t.id ORDER BY m.created_at ASC LIMIT 1) AS owner_email,
                  (SELECT u.name FROM membership m JOIN user u ON u.id = m.user_id
                    WHERE m.tenant_id = t.id ORDER BY m.created_at ASC LIMIT 1) AS owner_name,
                  -- The latest payment = the subscription period paid for now.
                  (SELECT p.period_start FROM payment p WHERE p.tenant_id = t.id
                    ORDER BY p.created_at DESC LIMIT 1) AS last_period_start,
                  (SELECT p.period_end FROM payment p WHERE p.tenant_id = t.id
                    ORDER BY p.created_at DESC LIMIT 1) AS last_period_end,
                  (SELECT p.created_at FROM payment p WHERE p.tenant_id = t.id
                    ORDER BY p.created_at DESC LIMIT 1) AS last_paid_at
             FROM tenant t
            ORDER BY t.created_at DESC`,
        ).all<TenantBillingRow & { id: string }>();
        // Attach the DERIVED billing state (past_due / expired and days left are
        // computed, never stored) so the console shows the same standing the
        // office itself is subject to, without re-implementing the rules.
        const offices = (rs.results ?? []).map((row) => ({
          ...row,
          billing: billingPayload(
            row.id === env.USER_ID ? operatorBilling() : computeBilling(row),
          ),
        }));
        return json({ offices }, request, env);
      }
      if (method === 'GET' && path === '/api/admin/payments') {
        const tenantId = (url.searchParams.get('tenantId') || '').trim();
        if (!tenantId) return json({ error: 'tenantId required' }, request, env, 400);
        const rs = await env.CONTROL_DB.prepare(
          `SELECT * FROM payment WHERE tenant_id = ?1
            ORDER BY created_at DESC LIMIT 50`,
        )
          .bind(tenantId)
          .all();
        return json({ payments: rs.results ?? [] }, request, env);
      }
      // Record a payment received (manual collection) and/or change the plan.
      // Recording a payment is what MOVES the subscription forward: it writes a
      // ledger row and extends paid_until, flipping the office out of trial.
      if (method === 'POST' && path === '/api/admin/billing') {
        const body = (await request.json().catch(() => ({}))) as {
          tenantId?: string;
          months?: number;
          amount?: number;
          currency?: string;
          reference?: string;
          note?: string;
          plan?: string;
          priceAmount?: number;
          billingNote?: string;
          trialDays?: number;
          cancel?: boolean;
          reactivate?: boolean;
          /** Switch access on by hand, without a payment (true) or end that (false). */
          manual?: boolean;
        };
        const tenantId = String(body.tenantId || '');
        if (!tenantId) return json({ error: 'tenantId required' }, request, env, 400);
        const office = await env.CONTROL_DB.prepare(
          `SELECT id, billing_status, trial_ends_at, paid_until, price_amount,
                  price_currency, plan
             FROM tenant WHERE id = ?1`,
        )
          .bind(tenantId)
          .first<{
            id: string;
            billing_status: string | null;
            trial_ends_at: string | null;
            paid_until: string | null;
            price_amount: number | null;
            price_currency: string | null;
            plan: string | null;
          }>();
        if (!office) return json({ error: 'office not found' }, request, env, 404);

        const nowIso = new Date().toISOString();
        const stmts: D1PreparedStatement[] = [];

        // 1. Plan / price / note edits.
        if (body.plan !== undefined) {
          stmts.push(
            env.CONTROL_DB.prepare('UPDATE tenant SET plan = ?2 WHERE id = ?1').bind(
              tenantId,
              String(body.plan || 'standard'),
            ),
          );
        }
        if (body.priceAmount !== undefined) {
          const minor = Math.round(Number(body.priceAmount) || 0);
          if (minor < 0) {
            return json({ error: 'priceAmount must be >= 0' }, request, env, 400);
          }
          stmts.push(
            env.CONTROL_DB.prepare(
              'UPDATE tenant SET price_amount = ?2, price_currency = ?3 WHERE id = ?1',
            ).bind(tenantId, minor, String(body.currency || office.price_currency || 'ILS')),
          );
        }
        if (body.billingNote !== undefined) {
          stmts.push(
            env.CONTROL_DB.prepare(
              'UPDATE tenant SET billing_note = ?2 WHERE id = ?1',
            ).bind(tenantId, String(body.billingNote || '')),
          );
        }

        // 2. Extend the trial (e.g. an office that needs a few more days).
        if (body.trialDays !== undefined) {
          const days = Math.round(Number(body.trialDays) || 0);
          if (days <= 0 || days > 365) {
            return json({ error: 'trialDays must be 1..365' }, request, env, 400);
          }
          stmts.push(
            env.CONTROL_DB.prepare(
              `UPDATE tenant SET billing_status = 'trialing', trial_ends_at = ?2
                WHERE id = ?1`,
            ).bind(tenantId, isoPlusDays(days)),
          );
        }

        // 3. Record a payment → ledger row + paid_until extension.
        let periodEnd: string | null = null;
        if (body.months !== undefined) {
          const months = Math.round(Number(body.months) || 0);
          if (months <= 0 || months > 60) {
            return json({ error: 'months must be 1..60' }, request, env, 400);
          }
          const periodStart =
            office.paid_until && Date.parse(office.paid_until) > Date.now()
              ? office.paid_until
              : nowIso;
          periodEnd = nextPeriodEnd(office.paid_until, months);
          // Default: the office's monthly price (699 ₪ unless set otherwise)
          // times the months paid — 12 months is the annual price.
          const amount = Math.round(
            Number(
              body.amount ?? (Number(office.price_amount) || STANDARD_MONTHLY_PRICE) * months,
            ) || 0,
          );
          stmts.push(
            env.CONTROL_DB.prepare(
              `INSERT INTO payment (id, tenant_id, amount, currency, method,
                                    reference, period_start, period_end, note, created_at)
               VALUES (?1, ?2, ?3, ?4, 'manual', ?5, ?6, ?7, ?8, ?9)`,
            ).bind(
              crypto.randomUUID(),
              tenantId,
              amount,
              String(body.currency || office.price_currency || 'ILS'),
              String(body.reference || ''),
              periodStart,
              periodEnd,
              String(body.note || ''),
              nowIso,
            ),
            env.CONTROL_DB.prepare(
              `UPDATE tenant SET billing_status = 'active', paid_until = ?2, plan = ?3
                WHERE id = ?1`,
            ).bind(tenantId, periodEnd, months >= 12 ? 'annual' : 'monthly'),
          );
        }

        // 4. Cancel / reactivate. Cancelling does NOT delete or suspend — the
        //    office drops to read-only and keeps every file it owns. With manual
        //    activation these are the three modes of the admin console; any
        //    one can follow any other.
        if (body.manual === true) {
          stmts.push(
            env.CONTROL_DB.prepare(
              `UPDATE tenant SET billing_status = 'manual' WHERE id = ?1`,
            ).bind(tenantId),
          );
        } else if (body.manual === false) {
          // Back to whatever the dates say: paid time left -> active, else the
          // trial track (which reads as expired when its date has passed).
          stmts.push(
            env.CONTROL_DB.prepare(
              `UPDATE tenant
                  SET billing_status = CASE WHEN paid_until IS NOT NULL THEN 'active'
                                            ELSE 'trialing' END
                WHERE id = ?1`,
            ).bind(tenantId),
          );
        } else if (body.cancel) {
          stmts.push(
            env.CONTROL_DB.prepare(
              `UPDATE tenant SET billing_status = 'canceled' WHERE id = ?1`,
            ).bind(tenantId),
          );
        } else if (body.reactivate) {
          // Back to whichever track still has time on it.
          stmts.push(
            env.CONTROL_DB.prepare(
              `UPDATE tenant
                  SET billing_status = CASE WHEN paid_until IS NOT NULL THEN 'active'
                                            ELSE 'trialing' END
                WHERE id = ?1`,
            ).bind(tenantId),
          );
        }

        if (!stmts.length) {
          return json({ error: 'nothing to do' }, request, env, 400);
        }
        await env.CONTROL_DB.batch(stmts);

        const updated = await env.CONTROL_DB.prepare(
          `SELECT plan, billing_status, trial_ends_at, paid_until, price_amount,
                  price_currency, billing_note
             FROM tenant WHERE id = ?1`,
        )
          .bind(tenantId)
          .first<TenantBillingRow>();
        return json(
          {
            ok: true,
            tenantId,
            periodEnd,
            billing: updated ? billingPayload(computeBilling(updated)) : null,
          },
          request,
          env,
        );
      }
      if (method === 'POST' && path === '/api/admin/approve') {
        const body = (await request.json().catch(() => ({}))) as { tenantId?: string };
        const tenantId = String(body.tenantId || '');
        if (!tenantId) return json({ error: 'tenantId required' }, request, env, 400);
        const office = await env.CONTROL_DB.prepare(
          `SELECT id, name, status, data_db_name, trial_ends_at, paid_until
             FROM tenant WHERE id = ?1`,
        )
          .bind(tenantId)
          .first<{
            id: string;
            name: string;
            status: string;
            data_db_name: string | null;
            trial_ends_at: string | null;
            paid_until: string | null;
          }>();
        if (!office) return json({ error: 'office not found' }, request, env, 404);
        // Provision the office's OWN database on first approval, then activate.
        // Idempotent: re-approving reuses the existing database.
        let dataDbId = office.data_db_name;
        if (!dataDbId) {
          dataDbId = await provisionOfficeDb(env, office.name);
        }
        // The free trial starts on FIRST approval only. This endpoint doubles as
        // "reactivate a suspended office", so granting a trial unconditionally
        // would hand out a fresh 14 days on every suspend/reactivate cycle.
        const startsTrial = !office.trial_ends_at && !office.paid_until;
        const trialEnds = startsTrial ? isoPlusDays(TRIAL_DAYS) : null;
        await env.CONTROL_DB.prepare(
          `UPDATE tenant
              SET status = 'active',
                  data_db_name = ?2,
                  approved_at = ?3,
                  billing_status = CASE WHEN ?4 IS NULL THEN billing_status ELSE 'trialing' END,
                  trial_ends_at  = COALESCE(?4, trial_ends_at)
            WHERE id = ?1`,
        )
          .bind(tenantId, dataDbId, new Date().toISOString(), trialEnds)
          .run();
        return json(
          { ok: true, tenantId, dataDbId, trialEndsAt: trialEnds },
          request,
          env,
        );
      }
      if (method === 'POST' && path === '/api/admin/reject') {
        const body = (await request.json().catch(() => ({}))) as { tenantId?: string };
        const tenantId = String(body.tenantId || '');
        if (!tenantId) return json({ error: 'tenantId required' }, request, env, 400);
        const office = await env.CONTROL_DB.prepare(
          'SELECT id, status FROM tenant WHERE id = ?1',
        )
          .bind(tenantId)
          .first<{ id: string; status: string }>();
        if (!office) return json({ error: 'office not found' }, request, env, 404);
        // Only PENDING offices can be rejected — an active office has a
        // provisioned database and real data, so it is never deleted from here.
        if (office.status !== 'pending') {
          return json(
            { error: 'only pending offices can be rejected' },
            request,
            env,
            400,
          );
        }
        const members = await env.CONTROL_DB.prepare(
          'SELECT user_id FROM membership WHERE tenant_id = ?1',
        )
          .bind(tenantId)
          .all<{ user_id: string }>();
        const userIds = (members.results ?? []).map((m) => m.user_id);
        const stmts = [
          env.CONTROL_DB.prepare('DELETE FROM membership WHERE tenant_id = ?1').bind(tenantId),
          env.CONTROL_DB.prepare('DELETE FROM tenant WHERE id = ?1').bind(tenantId),
        ];
        for (const uid of userIds) {
          stmts.push(env.CONTROL_DB.prepare('DELETE FROM session WHERE userId = ?1').bind(uid));
          stmts.push(env.CONTROL_DB.prepare('DELETE FROM account WHERE userId = ?1').bind(uid));
          stmts.push(env.CONTROL_DB.prepare('DELETE FROM user WHERE id = ?1').bind(uid));
        }
        await env.CONTROL_DB.batch(stmts);
        return json({ ok: true, tenantId, rejected: true }, request, env);
      }
      // Reset a forgotten password. The stored password is a one-way hash, so the
      // old one can never be shown; instead a random temporary password is set
      // for the office's owner account and returned ONCE, for the operator to
      // hand over. Only its hash is stored, and it is never logged.
      if (method === 'POST' && path === '/api/admin/reset-password') {
        const body = (await request.json().catch(() => ({}))) as { tenantId?: string };
        const tenantId = String(body.tenantId || '');
        if (!tenantId) return json({ error: 'tenantId required' }, request, env, 400);
        const owner = await env.CONTROL_DB.prepare(
          `SELECT u.id AS id, u.email AS email FROM membership m JOIN user u ON u.id = m.user_id
            WHERE m.tenant_id = ?1 ORDER BY m.created_at ASC LIMIT 1`,
        )
          .bind(tenantId)
          .first<{ id: string; email: string }>();
        if (!owner) return json({ error: 'office has no user' }, request, env, 404);
        // 12 characters from an alphabet without look-alikes (0/O, 1/l/I), easy
        // to read out over the phone.
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        const bytes = crypto.getRandomValues(new Uint8Array(12));
        const password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
        const authCtx = await createAuth(env).$context;
        const hash = await authCtx.password.hash(password);
        const accounts = await authCtx.internalAdapter.findAccounts(owner.id);
        if (accounts.some((a) => a.providerId === 'credential')) {
          await authCtx.internalAdapter.updatePassword(owner.id, hash);
        } else {
          await authCtx.internalAdapter.createAccount({
            userId: owner.id,
            providerId: 'credential',
            accountId: owner.id,
            password: hash,
          });
        }
        return json({ ok: true, tenantId, email: owner.email, password }, request, env);
      }
      if (method === 'POST' && path === '/api/admin/deactivate') {
        const body = (await request.json().catch(() => ({}))) as { tenantId?: string };
        const tenantId = String(body.tenantId || '');
        if (!tenantId) return json({ error: 'tenantId required' }, request, env, 400);
        const office = await env.CONTROL_DB.prepare(
          'SELECT id, status FROM tenant WHERE id = ?1',
        )
          .bind(tenantId)
          .first<{ id: string; status: string }>();
        if (!office) return json({ error: 'office not found' }, request, env, 404);
        if (office.status !== 'active') {
          return json(
            { error: 'only active offices can be deactivated' },
            request,
            env,
            400,
          );
        }
        // Suspend access WITHOUT deleting anything — the office's database and
        // data are kept intact. resolveTenant only serves data to an 'active'
        // office, so a suspended office is locked out until re-approved. Reuse
        // /api/admin/approve to reactivate (it keeps the existing database).
        await env.CONTROL_DB.prepare(
          `UPDATE tenant SET status = 'suspended' WHERE id = ?1`,
        )
          .bind(tenantId)
          .run();
        return json({ ok: true, tenantId, status: 'suspended' }, request, env);
      }
      return json({ error: 'not found' }, request, env, 404);
    }

    // ----- everything below requires EITHER a logged-in office (Better Auth
    //       session -> its own DB) or the legacy app-token (your office -> the
    //       native binding). resolveTenant checks both and returns which tenant
    //       + database this request may touch, or null if unauthorized. -----
    const ctx = await resolveTenant(request, env);
    if (!ctx) {
      return json({ error: 'unauthorized' }, request, env, 401);
    }

    // ----- subscription gate (Phase 4). A lapsed office keeps FULL READ access
    //       — its own case files are never held hostage — but loses every write
    //       and every AI endpoint (which are all non-GET, so this single rule
    //       covers both "don't mutate" and "don't spend on our model budget").
    //       GET /api/load still succeeds, which is what lets the app boot and
    //       render the paywall instead of showing a broken screen. -----
    if (ctx.billing.blocked && method !== 'GET') {
      return json(
        {
          error: 'subscription_required',
          billing: billingPayload(ctx.billing),
        },
        request,
        env,
        402,
      );
    }

    if (method === 'GET' && path === '/api/load') return handleLoad(request, env, ctx);
    if (method === 'GET' && path === '/api/file-summary') {
      return handleFileSummary(request, env, ctx);
    }
    if (method === 'POST' && path === '/api/file-summary') {
      return handleStoreFileSummary(request, env, ctx);
    }
    if (method === 'GET' && path === '/api/decision') {
      return handleDecisionInfo(request, env, ctx);
    }
    if (method === 'POST' && path === '/api/save') return handleSave(request, env, ctx);
    if (method === 'POST' && path === '/api/draft') return handleDraft(request, env, ctx);
    if (method === 'POST' && path === '/api/draft-decision') {
      return handleDraftDecision(request, env, ctx);
    }
    if (method === 'GET' && path === '/api/case-notes') {
      return handleCaseNotes(request, env, ctx);
    }
    if (method === 'GET' && path === '/api/drafts') {
      return handleDrafts(request, env, ctx);
    }
    if (method === 'GET' && path === '/api/skills') {
      return handleSkills(request, env, ctx);
    }
    if (method === 'POST' && path === '/api/upload-photo') {
      return handleUploadPhoto(request, env, ctx);
    }
    if (method === 'GET' && path === '/api/legal-actions') {
      return handleLegalActions(request, env, ctx);
    }
    if (method === 'POST' && path === '/api/suggested-actions') {
      return handleSaveSuggestedAction(request, env, ctx);
    }
    if (method === 'POST' && path === '/api/suggest-action') {
      return handleSuggestAction(request, env, ctx);
    }
    if (method === 'POST' && path === '/api/split-decision') {
      return handleSplitDecision(request, env);
    }
    if (method === 'POST' && path === '/api/translate') {
      return handleTranslate(request, env);
    }
    if (method === 'GET' && path.startsWith('/api/suggested-actions/')) {
      return handleGetSuggestedActions(request, env, ctx);
    }
if (method === 'POST' && path === '/api/whatsapp-messages') {
    return handleSaveWhatsAppMessage(request, env, ctx);
  }
  // The office's own WhatsApp connection (settings screen) and sending from it.
  if (path === '/api/whatsapp-config') {
    const webhookUrl = url.origin + '/api/whatsapp-webhook';
    if (method === 'GET') return json(await publicConfig(env, ctx.tenantId, webhookUrl), request, env);
    if (method === 'DELETE') {
      await deleteConfig(env, ctx.tenantId);
      return json({ ok: true }, request, env);
    }
    if (method === 'POST') {
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const res = await saveConfig(env, ctx.tenantId, {
        phone_number_id: String(b.phone_number_id || ''),
        access_token: String(b.access_token || ''),
        app_secret: String(b.app_secret || ''),
      });
      if (!res.ok) return json({ error: res.error }, request, env, 400);
      return json({ ...(await publicConfig(env, ctx.tenantId, webhookUrl)), ...res }, request, env);
    }
  }
  // A signed bot link for one of THIS office's clients (the webhook's invite).
  if (path === '/api/briefing' && method === 'GET') {
    return json(await handleBriefing(env, ctx, new URL(request.url)), request, env);
  }
  if (path === '/api/briefing-argument' && method === 'POST') {
    const b = (await request.json().catch(() => ({}))) as Parameters<typeof handleBriefingArgument>[2];
    const r = await handleBriefingArgument(env, ctx, b);
    return json(r.body, request, env, r.status);
  }
  if (path === '/api/analytics' && method === 'GET') {
    return json(await handleAnalytics(ctx), request, env);
  }
  if (path === '/api/bot-history' && method === 'GET') {
    const r = await officeListTurns(ctx.db);
    return json(r.body, request, env, r.status);
  }
  if (path === '/api/bot-history' && method === 'POST') {
    const b = (await request.json().catch(() => ({}))) as { turn?: Record<string, string> };
    const r = await officeSaveTurn(ctx.db, b.turn || {});
    return json(r.body, request, env, r.status);
  }
  if (path === '/api/bot-history-clear' && method === 'POST') {
    const b = (await request.json().catch(() => ({}))) as { clientId?: string };
    const r = await officeClearTurns(ctx.db, String(b.clientId || ''));
    return json(r.body, request, env, r.status);
  }
  if (method === 'POST' && path === '/api/portal-link') {
    const b = (await request.json().catch(() => ({}))) as { phone?: string };
    if (!String(b.phone || '').replace(/\D/g, '')) {
      return json({ error: 'phone required' }, request, env, 400);
    }
    return json({ url: await portalLink(env, ctx.tenantId, String(b.phone)) }, request, env);
  }
  if (method === 'POST' && path === '/api/whatsapp-send') {
    const cfg = await configForTenant(env, ctx.tenantId);
    if (!cfg) {
      // The operator office still sends with its original credentials (Vercel).
      if (ctx.tenantId === env.USER_ID) return json({ legacy: true }, request, env, 409);
      return json({ error: 'WhatsApp is not connected for this office' }, request, env, 403);
    }
    const b = (await request.json().catch(() => ({}))) as {
      to?: string;
      message?: string;
      document?: { url?: string; name?: string };
    };
    const out = await sendFromOffice(env, ctx.db, cfg, { to: String(b.to || ''), message: b.message, document: b.document });
    return json(out.body, request, env, out.status);
  }
  if (method === 'POST' && path === '/api/whatsapp-transcribe') {
    return handleWhatsAppTranscribe(request, env, ctx);
  }
  if (method === 'GET' && path === '/api/whatsapp-summary') {
    return handleWhatsAppSummary(request, env, ctx);
  }
  if (method === 'GET' && path.startsWith('/api/whatsapp-messages/')) {
    return handleGetWhatsAppMessages(request, env, ctx);
  }
    if (method === 'GET' && path === '/api/document') {
      return handleDocument(request, env, ctx);
    }
    if (method === 'POST' && path === '/api/document') {
      return handleUploadDocument(request, env, ctx);
    }
    if (method === 'GET' && path === '/api/document-link') {
      return handleDocumentLink(request, env, ctx);
    }
    return json({ error: 'not found' }, request, env, 404);
    } catch (e) {
      // An unhandled throw (e.g. a D1 write error) would otherwise reach the
      // client as a non-JSON Cloudflare "Error 1101" / 502 page with no body —
      // which is exactly what breaks the make.com pipeline (it sees a bare 502
      // "ConnectionError" and can't tell why). The app and Make both parse
      // JSON, so surface the real error instead of an opaque 502.
      return json(
        {
          error: 'worker_exception',
          detail:
            e instanceof Error
              ? (e.stack || e.message).slice(0, 800)
              : String(e).slice(0, 800),
        },
        request,
        env,
        500,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// GET /api/load
// ---------------------------------------------------------------------------
async function handleLoad(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const out: Record<string, unknown> = {};
  for (const table of LOAD_TABLES) {
    const extra = table === 'documents' ? " AND source_id NOT LIKE '%/%'" : '';
    const rs = await ctx.db.prepare(
      `SELECT * FROM ${table} WHERE user_id = ?${extra}`,
    )
      .bind(ctx.tenantId)
      .all();
    out[table] = rs.results ?? [];
  }
  const asRow = await ctx.db.prepare(
    `SELECT state, payload, data FROM app_state WHERE user_id = ?`,
  )
    .bind(ctx.tenantId)
    .first<{ state?: string; payload?: string; data?: string }>();
  out.app_state = asRow
    ? safeParse(asRow.state) ?? safeParse(asRow.payload) ?? safeParse(asRow.data)
    : null;

  // Who this office is, for features that are OPERATOR-ONLY because they run on
  // shared, single-office infrastructure the tenant doesn't have: the WhatsApp
  // business number + its inbound webhook, and the Dropbox/make.com pipeline.
  // The client hides those features unless is_operator — otherwise a tenant's
  // messages would go out from the operator's number and be stored against the
  // operator's data. See usesDropbox(), which draws the same line for storage.
  const isOperator = ctx.tenantId === env.USER_ID;
  out.office = {
    is_operator: isOperator,
    // Shows the admin-dashboard button. Only the operator's own login can be an
    // admin, so other offices never pay for the check. /api/admin/* re-checks.
    is_admin: isOperator && ctx.mode === 'tenant' ? await adminSessionOk(request, env) : false,
    // WhatsApp features: the operator (original setup) or any office that
    // connected its own number. Others don't see WhatsApp at all.
    whatsapp_enabled: isOperator || !!(await configForTenant(env, ctx.tenantId)),
    tenant_id: ctx.tenantId,
    // Subscription standing, so the app can warn during the trial / grace
    // window and switch to read-only once entitlement runs out (Phase 4).
    billing: billingPayload(ctx.billing),
  };

  return json(out, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/file-summary
// ---------------------------------------------------------------------------
async function handleFileSummary(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const file = (url.searchParams.get('file') || '').trim();
  const orig = (url.searchParams.get('orig') || '').trim();
  const caseId = (url.searchParams.get('caseId') || '').trim();
  if (!file && !orig && !caseId) {
    return json({ he: '', ar: '', orig: '', language: '' }, request, env);
  }
  const docMatch = /(DOC-\d+)/i.exec(file) || /(DOC-\d+)/i.exec(orig);
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  const row = await ctx.db.prepare(
    'SELECT summary_he, summary_ar, summary_orig, language FROM file_summary ' +
      'WHERE file_name = ?1 OR file_name = ?2 ' +
      "OR (?4 <> '' AND (upper(file_name) LIKE '%' || ?4 || '.%' OR upper(file_name) LIKE '%' || ?4)) " +
      "OR (?3 <> '' AND lower(case_id) LIKE lower(?3) || '%') " +
      'ORDER BY (file_name = ?1) DESC, (file_name = ?2) DESC, ' +
      "(?4 <> '' AND upper(file_name) LIKE '%' || ?4 || '.%') DESC, id DESC LIMIT 1",
  )
    .bind(file, orig, caseId, docId)
    .first<{
      summary_he?: string;
      summary_ar?: string;
      summary_orig?: string;
      language?: string;
    }>();
  return json(
    {
      he: row?.summary_he || '',
      ar: row?.summary_ar || '',
      // The summary in the document's OWN language (any language). Falls back
      // to '' for rows written before this column existed.
      orig: row?.summary_orig || '',
      language: String(row?.language || '').toLowerCase(),
    },
    request,
    env,
  );
}

// ---------------------------------------------------------------------------
// GET /api/decision — the task + hearing a ruling document imposes.
//
// Runs against ctx.db, so every office reads its OWN decisions. Two shapes
// exist, and this handler serves both:
//
//   • Operator DB (tenant #1): the make.com pipeline writes `decisions` +
//     `hearings` and links them to `tasks.decision_id`. That join is the
//     richest answer, so it is tried first.
//   • Every other office: those pipeline tables don't exist in the office
//     schema (see officeSchema.ts). The same facts live in `file_summary`
//     (deadline_description / deadline_date / hearing_date), written by the
//     Worker's own document analysis — so we fall back to that.
//
// A missing `decisions` table throws in D1; that throw IS the signal to use
// the fallback, so it's caught rather than surfaced.
// ---------------------------------------------------------------------------
async function handleDecisionInfo(
  request: Request,
  env: Env,
  ctx: Ctx,
): Promise<Response> {
  const url = new URL(request.url);
  const file = (url.searchParams.get('file') || '').trim();
  const clientId = (url.searchParams.get('clientId') || '').trim();
  // The CASE the caller is asking about. A client usually has several open
  // cases, so answering from `client_id` alone handed one case's hearing to
  // another case of the same client — a real mis-filing, since the caller files
  // whatever comes back onto the case it asked for. With a case id the answer is
  // restricted to that case (or to the exact document named in `file`).
  const caseId = (url.searchParams.get('caseId') || '').trim();
  const empty = { taskDescription: '', taskDueDate: '', hearingDate: '' };
  if (!file && !clientId && !caseId) return json(empty, request, env);

  type Row = {
    taskDescription?: string | null;
    taskDueDate?: string | null;
    hearingDate?: string | null;
  };
  const clean = (row: Row | null) => ({
    taskDescription: (row?.taskDescription || '').trim(),
    taskDueDate: (row?.taskDueDate || '').trim(),
    hearingDate: (row?.hearingDate || '').trim(),
  });

  // 1. Pipeline tables. Only a THROW (the tables don't exist here) falls
  //    through. The client-wide match is now allowed ONLY when the caller named
  //    no case; with a case id the row must be the case's own.
  try {
    const row = await ctx.db.prepare(
      'SELECT t.task_description AS taskDescription, t.due_date AS taskDueDate, ' +
        'h.hearing_date AS hearingDate ' +
        'FROM decisions d ' +
        'LEFT JOIN tasks t ON t.decision_id = d.id ' +
        'LEFT JOIN hearings h ON h.decision_id = d.id ' +
        'WHERE d.document_name = ?1 ' +
        "OR (?3 <> '' AND lower(d.case_id) = lower(?3)) " +
        "OR (?3 = '' AND ?2 <> '' AND d.client_id = ?2) " +
        'ORDER BY (d.document_name = ?1) DESC, d.created_at DESC LIMIT 1',
    )
      .bind(file, clientId, caseId)
      .first<Row>();
    return json(clean(row), request, env);
  } catch {
    // No decisions/hearings table in this office DB — use the fallback below.
  }

  // 2. file_summary — present in every office schema, and the column split
  //    already distinguishes a HEARING (hearing_date) from a filing DEADLINE
  //    (deadline_date/deadline_description), which is the same distinction the
  //    caller relies on when it files a hearing vs a task.
  const docMatch = /(DOC-\d+)/i.exec(file);
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  try {
    const row = await ctx.db.prepare(
      'SELECT deadline_description AS taskDescription, deadline_date AS taskDueDate, ' +
        'hearing_date AS hearingDate FROM file_summary ' +
        'WHERE file_name = ?1 ' +
        "OR (?2 <> '' AND (upper(file_name) LIKE '%' || ?2 || '.%' OR upper(file_name) LIKE '%' || ?2)) " +
        // case_id is the precise scope: the row belongs to THIS case.
        "OR (?4 <> '' AND lower(case_id) = lower(?4)) " +
        // Client-wide is the last resort and ONLY when no case was named —
        // otherwise a sibling case's decision would be answered as this one's.
        // client_id is stored either bare ("CLT-101") or labelled
        // ("clt-101 - name"); match both WITHOUT a bare prefix LIKE, which
        // would also match CLT-1011.
        "OR (?4 = '' AND ?3 <> '' AND (lower(client_id) = lower(?3) OR lower(client_id) LIKE lower(?3) || ' %')) " +
        'ORDER BY (file_name = ?1) DESC, ' +
        "(?2 <> '' AND upper(file_name) LIKE '%' || ?2 || '.%') DESC, " +
        "(?4 <> '' AND lower(case_id) = lower(?4)) DESC, id DESC LIMIT 1",
    )
      .bind(file, docId, clientId, caseId)
      .first<Row>();
    return json(clean(row), request, env);
  } catch {
    return json(empty, request, env);
  }
}

// ---------------------------------------------------------------------------
// POST /api/file-summary
// ---------------------------------------------------------------------------
async function handleStoreFileSummary(
  request: Request,
  env: Env,
  ctx: Ctx,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const fileName = String(body.file_name || '').trim();
  if (!fileName) {
    return json({ error: 'file_name required' }, request, env, 400);
  }
  const str = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s || null;
  };
  const docMatch = /(DOC-\d+)/i.exec(fileName);
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  if (docId) {
    await ctx.db.prepare(
      'DELETE FROM file_summary WHERE file_name = ?1 ' +
        "OR upper(file_name) LIKE '%' || ?2 || '.%' " +
        "OR upper(file_name) LIKE '%' || ?2",
    )
      .bind(fileName, docId)
      .run();
  } else {
    await ctx.db.prepare('DELETE FROM file_summary WHERE file_name = ?')
      .bind(fileName)
      .run();
  }
  await ctx.db.prepare(
    'INSERT INTO file_summary (client_id, case_id, file_name, summary_he, summary_ar, summary_orig, language, ai_model) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
  )
    .bind(
      str(String(body.client_id ?? '').toLowerCase()),
      str(String(body.case_id ?? '').toLowerCase()),
      fileName,
      str(body.summary_he),
      str(body.summary_ar),
      str(body.summary_orig),
      str(String(body.language ?? '').toLowerCase()),
      str(body.ai_model),
    )
    .run();
  if (docId) {
    await ctx.db.prepare(
      'UPDATE documents SET summary_he = COALESCE(?1, summary_he), ' +
        'summary_ar = COALESCE(?2, summary_ar), updated_at = ?3 ' +
        "WHERE user_id = ?4 AND (upper(source_id) = ?5 " +
        "OR upper(file_name) LIKE '%' || ?5 || '.%' OR upper(file_name) LIKE '%' || ?5)",
    )
      .bind(
        str(body.summary_he),
        str(body.summary_ar),
        new Date().toISOString(),
        ctx.tenantId,
        docId,
      )
      .run();
  }
  return json({ ok: true }, request, env);
}

// ---------------------------------------------------------------------------
// POST /api/save
// ---------------------------------------------------------------------------
async function handleSave(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }

  const statements: D1PreparedStatement[] = [];
  for (const table of LOAD_TABLES) {
    const rows = Array.isArray(body[table]) ? (body[table] as unknown[]) : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const built = buildUpsert(table, row as Record<string, unknown>, ctx.tenantId);
      if (built) statements.push(ctx.db.prepare(built.sql).bind(...built.binds));
    }
  }

  if (statements.length) await ctx.db.batch(statements);

  // Explicit deletions: rows the user removed locally. The upsert above only
  // adds/updates, so a deleted record would otherwise linger in D1 and come
  // back on the next load. We delete ONLY the exact (user_id, source_id) rows
  // the client listed — never a diff/replace — so a row make.com just added
  // (and this client hasn't loaded yet) is never removed. Table names come from
  // a fixed whitelist, so interpolating them into the SQL is safe.
  let deleted = 0;
  const deletions =
    body.deletions && typeof body.deletions === 'object'
      ? (body.deletions as Record<string, unknown>)
      : null;
  if (deletions) {
    const DELETABLE_TABLES = [
      'clients', 'cases', 'tasks', 'calendar_events',
      'documents', 'payments', 'timeline_items',
    ];
    const delStatements: D1PreparedStatement[] = [];
    for (const table of DELETABLE_TABLES) {
      const raw = Array.isArray(deletions[table]) ? (deletions[table] as unknown[]) : [];
      const ids = raw.map((x) => String(x ?? '').trim()).filter((x) => x.length > 0);
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const ph = chunk.map((_, j) => '?' + (j + 2)).join(', ');
        delStatements.push(
          ctx.db.prepare(
            `DELETE FROM ${table} WHERE user_id = ?1 AND source_id IN (${ph})`,
          ).bind(ctx.tenantId, ...chunk),
        );
        deleted += chunk.length;
      }
    }
    if (delStatements.length) await ctx.db.batch(delStatements);

    // A deleted document takes its derived rows with it: the summary (which
    // would otherwise keep feeding the case's reply drafts and the hearing
    // sweep), the reply draft and the suggested action. Document numbers are
    // reused (max + 1), so leftovers would also attach to the NEXT DOC-NNN.
    // Matched only on an exact DOC-NNN token, so DOC-22 never hits DOC-226.
    const docIds = (Array.isArray(deletions.documents) ? (deletions.documents as unknown[]) : [])
      .map((x) => String(x ?? '').trim().toUpperCase())
      .filter((x) => /^DOC-\d+$/.test(x));
    for (const id of docIds) {
      const cleanup = [
        ctx.db.prepare(
          'DELETE FROM drafts WHERE user_id = ?1 AND (upper(document_source_id) = ?2 OR upper(source_id) = ?3)',
        ).bind(ctx.tenantId, id, 'DRAFT-' + id),
        ctx.db.prepare(
          "DELETE FROM file_summary WHERE upper(file_name) LIKE '%' || ?1 || '.%' OR upper(file_name) LIKE '%' || ?1",
        ).bind(id),
        ctx.db.prepare(
          "DELETE FROM case_suggested_actions WHERE upper(document_name) LIKE '%' || ?1 || '.%' OR upper(document_name) LIKE '%' || ?1",
        ).bind(id),
      ];
      // One statement at a time: an office DB without one of these tables must
      // not stop the others (a D1 batch is all-or-nothing).
      for (const stmt of cleanup) {
        try {
          await stmt.run();
        } catch {
          // table missing in this office schema — nothing to clean there
        }
      }
    }
  }

  if (Array.isArray(body.timeline_items) || Array.isArray(body.cases)) {
    try {
      await syncCaseNotes(env, ctx);
    } catch {
      // never fail the save because the mirror rebuild hiccuped
    }
  }
  // When calendar events were saved, collapse any duplicate hearings a document
  // pipeline may have created for the same case + day.
  if (Array.isArray(body.calendar_events)) {
    try {
      await consolidateHearings(env, ctx);
    } catch {
      // never fail the save because the consolidation hiccuped
    }
  }
  const submitted = LOAD_TABLES.reduce(
    (n, t) => n + (Array.isArray(body[t]) ? (body[t] as unknown[]).length : 0),
    0,
  );
  return json(
    {
      ok: true,
      count: statements.length,
      submitted,
      skipped: submitted - statements.length,
      deleted,
    },
    request,
    env,
  );
}

// Source type of a hearing event, inferred from its source document name /
// title / existing note: an invitation to a hearing, a judicial decision, or
// unknown.
function hearingSourceType(
  r: { source_id?: string; title?: string; description?: string },
): 'invitation' | 'decision' | 'other' {
  const hay = (
    String(r.source_id ?? '') +
    ' ' +
    String(r.title ?? '') +
    ' ' +
    String(r.description ?? '')
  ).toLowerCase();
  if (/הזמנ|זימון|تبليغ|دعوة|إحضار|احضار/.test(hay)) return 'invitation';
  if (/החלט|פסק|פרוטוקול|قرار|حكم|محضر/.test(hay)) return 'decision';
  return 'other';
}

// Consolidate AI-imported HEARING events so that each (case, calendar day) has a
// SINGLE calendar event, and annotate WHERE it came from:
//   • same day, one source (e.g. only a decision, or a document duplicated by
//     the pipeline) → keep one, note the source ("מהחלטה שיפוטית" / "מהזמנה
//     לדיון"); for a decision the note is the source ONLY, never its summary.
//   • same day, MULTIPLE sources (e.g. an invitation to a hearing AND a decision
//     that both point to the same hearing) → MERGE into one event with a clear
//     note that it was merged from those sources.
// Only hearing-type events are touched; meetings, reminders, etc. are left alone.
async function consolidateHearings(env: Env, ctx: Ctx): Promise<void> {
  const rs = await ctx.db.prepare(
    `SELECT id, source_id, title, description, case_source_id, date_time
     FROM calendar_events
     WHERE user_id = ?1 AND lower(type) IN ('hearing', 'hearingmeeting')
     ORDER BY created_at ASC, id ASC`,
  )
    .bind(ctx.tenantId)
    .all();
  const rows = (rs.results ?? []) as Array<{
    id: string;
    source_id?: string;
    title?: string;
    description?: string;
    case_source_id?: string;
    date_time?: string;
  }>;
  // Group by (case, calendar day). Insertion order = created_at ASC, so the
  // first in each group is the earliest — the one we keep.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const day = String(r.date_time ?? '').slice(0, 10);
    if (!day) continue;
    const key = String(r.case_source_id ?? '').toLowerCase() + '|' + day;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const now = new Date().toISOString();
  const toDelete: string[] = [];
  for (const group of groups.values()) {
    // Determine the source(s) of this same-day hearing FIRST — a hearing that
    // came from a judicial decision/protocol must NEVER carry the decision's
    // content/summary in the calendar; it shows ONLY the date + a clean note.
    const sources = new Set(group.map(hearingSourceType));
    sources.delete('other');
    const hasInv = sources.has('invitation');
    const hasDec = sources.has('decision');
    const isImported = hasInv || hasDec;
    // Manual-only groups are left COMPLETELY alone — never delete or relabel a
    // hearing the lawyer entered by hand. Two same-day manual hearings (or two
    // case-less manual hearings sharing the '|day' key) are legitimate and must
    // both survive. (This guard must run BEFORE any delete is queued.)
    if (!isImported) continue;
    // Collapse only DUPLICATE IMPORTED hearings (the same session that arrived
    // from both an invitation and a decision). Keep the earliest imported event
    // as canonical; never touch a manual ('other') member of a mixed group.
    const importedMembers = group.filter((r) => hearingSourceType(r) !== 'other');
    const keep = importedMembers[0];
    for (const r of importedMembers) if (r.id !== keep.id) toDelete.push(r.id);
    let he = '';
    let ar = '';
    if (sources.size >= 2) {
      const he_parts: string[] = [];
      const ar_parts: string[] = [];
      if (hasInv) { he_parts.push('הזמנה לדיון'); ar_parts.push('دعوة لجلسة'); }
      if (hasDec) { he_parts.push('החלטה שיפוטית'); ar_parts.push('قرار قضائي'); }
      he =
        'מועד זה אוחד על ידי הבינה המלאכותית (AI) ממספר מסמכים לאותו דיון: ' +
        he_parts.join(' + ') +
        '.';
      ar =
        'دُمج هذا الموعد بواسطة الذكاء الاصطناعي (AI) من عدة مستندات لنفس الجلسة: ' +
        ar_parts.join(' + ') +
        '.';
    } else if (hasInv) {
      he = 'מועד זה יובא מהזמנה לדיון על ידי הבינה המלאכותית (AI).';
      ar = 'أُدرج هذا الموعد من دعوة/تبليغ لجلسة بواسطة الذكاء الاصطناعي (AI).';
    } else if (hasDec) {
      he = 'מועד הדיון יובא מהחלטה שיפוטית על ידי הבינה המלאכותית (AI).';
      ar = 'أُدرج موعد الجلسة من قرار قضائي بواسطة الذكاء الاصطناعي (AI).';
    }
    // ALWAYS overwrite the description for an imported hearing — even if it
    // currently holds the decision summary — so the calendar shows only the
    // clean note, never the decision content or its abridgement.
    if (he && String(keep.description ?? '') !== he) {
      await ctx.db.prepare(
        'UPDATE calendar_events SET description = ?2, description_ar = ?3, title = ?6, title_ar = ?7, updated_at = ?4 WHERE user_id = ?1 AND id = ?5',
      )
        .bind(ctx.tenantId, he, ar, now, keep.id, 'דיון', 'جلسة')
        .run();
    }
  }
  for (let i = 0; i < toDelete.length; i += 50) {
    const chunk = toDelete.slice(i, i + 50);
    const ph = chunk.map((_, j) => '?' + (j + 2)).join(', ');
    await ctx.db.prepare(
      `DELETE FROM calendar_events WHERE user_id = ?1 AND id IN (${ph})`,
    )
      .bind(ctx.tenantId, ...chunk)
      .run();
  }
}

async function syncCaseNotes(env: Env, ctx: Ctx): Promise<void> {
  await ctx.db.prepare('DELETE FROM case_notes WHERE user_id = ?')
    .bind(ctx.tenantId)
    .run();
  await ctx.db.prepare(
    'INSERT INTO case_notes ' +
      '(id, user_id, source_id, client_id, case_id, note, note_ar, date, created_at, updated_at) ' +
      'SELECT ti.id, ti.user_id, ti.source_id, c.client_source_id, ti.case_source_id, ' +
      'ti.description, ti.description_ar, ti.date, ti.created_at, ti.updated_at ' +
      'FROM timeline_items ti ' +
      'LEFT JOIN cases c ON c.user_id = ti.user_id AND c.source_id = ti.case_source_id ' +
      "WHERE ti.user_id = ?1 AND lower(coalesce(ti.type, 'note')) = 'note' " +
      "AND coalesce(trim(ti.description), '') <> ''",
  )
    .bind(ctx.tenantId)
    .run();
}

// ---------------------------------------------------------------------------
// POST /api/draft
// ---------------------------------------------------------------------------
async function handleDraft(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  // Refuse an oversized body from its Content-Length, BEFORE reading it. A
  // Worker isolate has a hard 128 MB ceiling and this endpoint holds several
  // copies of the base64 PDF; parsing first is what killed the isolate.
  const tooBig = oversizedPdfBody(request);
  if (tooBig) {
    return json({ error: 'file_too_large', detail: tooBig }, request, env, 413);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  // NO .trim() here: on a ~37 MB base64 string that is a pointless full copy at
  // exactly the moment the isolate can least afford one. Base64 from our own
  // routes never has surrounding whitespace.
  const pdfB64 = typeof body.pdf_base64 === 'string' ? body.pdf_base64 : '';
  if (!pdfB64) return json({ error: 'pdf_base64 required' }, request, env, 400);
  const fieldTooBig = oversizedPdfField(pdfB64.length);
  if (fieldTooBig) {
    return json({ error: 'file_too_large', detail: fieldTooBig }, request, env, 413);
  }

  const clientSrc = String(body.client_source_id || '').trim();
  const caseSrc = String(body.case_source_id || '').trim();
  const fileName = String(body.file_name || '').trim();
  const skillKey = String(body.skill_key || 'sharia-lawsuit').trim();
  // The registered lawyer / our office (Settings name appended to the built-in
  // one). Authorship is read off the SIGNATURE at the END of the document: our
  // own signature → no reply draft; opposing counsel's signature → draft. A
  // judge's decision always gets a draft, whatever it orders.
  // Another office's "our side" is ITS lawyer, never the operator's name.
  const lawyerName =
    ctx.tenantId !== env.USER_ID
      ? String(body.lawyer_name || '').trim() || 'עורך הדין של המשרד'
      : DEFAULT_LAWYER_NAME +
        (String(body.lawyer_name || '').trim() ? ' / ' + String(body.lawyer_name).trim() : '');
  // The party we represent — a document signed by them or submitted ON THEIR
  // BEHALF is also "ours" (no reply drafted against our own side).
  const clientName = await resolveClientName(ctx, clientSrc, body.client_name);

  const docMatch =
    /(DOC-\d+)/i.exec(fileName) ||
    /(DOC-\d+)/i.exec(String(body.source_id || '')) ||
    /(DOC-\d+)/i.exec(String(body.document_source_id || ''));
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  let sourceId = docId ? `DRAFT-${docId}` : '';
  if (!sourceId && fileName) {
    const base = fileName
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    if (base) sourceId = `DRAFT-${base}`;
  }
  if (!sourceId) {
    return json(
      { error: 'cannot derive source_id (need file_name or DOC id)' },
      request,
      env,
      400,
    );
  }
  const documentSourceId = docId || sourceId;

  const skillRow = await ctx.db.prepare(
    'SELECT content FROM skills WHERE user_id = ? AND skill_key = ? ' +
      "AND lower(coalesce(status, 'active')) = 'active' ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(ctx.tenantId, skillKey)
    .first<{ content?: string }>();
  const skill = skillRow?.content || '';

  const notes = await fetchDraftNotes(env, ctx, clientSrc, caseSrc, docId);
  // The app also sends the notes it aggregated (it may hold notes not yet synced
  // to D1). Keep only the paragraphs the D1 read didn't already include; the app
  // prefixes each with "label: ", so compare the start of the body after it.
  const notesContext = String(body.notes_context ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => {
      const colon = p.indexOf(': ');
      const head = (colon >= 0 ? p.slice(colon + 2) : p).slice(0, 200);
      return p && !notes.text.includes(p.slice(0, 200)) && !notes.text.includes(head);
    })
    .join('\n\n')
    .slice(0, DRAFT_NOTES_MAX_CHARS);

  // "פסיקת בית הדין השרעי": the rulings that match this case's topics, for the
  // draft's legal arguments (worker/src/rulings.ts).
  const caseRow = caseSrc
    ? await ctx.db
        .prepare('SELECT title, title_ar, court, court_ar FROM cases WHERE user_id = ?1 AND upper(source_id) = upper(?2) LIMIT 1')
        .bind(ctx.tenantId, caseSrc)
        .first<{ title?: string; title_ar?: string; court?: string; court_ar?: string }>()
        .catch(() => null)
    : null;
  const caseText = [caseRow?.title, caseRow?.title_ar, caseRow?.court, caseRow?.court_ar, fileName, notes.text, notesContext]
    .map((x) => String(x || ''))
    .join('\n');
  const shariaCase = looksSharia([caseRow?.court, caseRow?.court_ar, caseRow?.title, fileName].join(' '));
  // Rulings are given whenever the case may be a Sharia one (by its court, or
  // when the court is unknown); a draft for an Arabic Sharia document must
  // cite them (enforced after the call below).
  const rulings = await relevantRulings(env, caseText, shariaCase || !caseRow?.court);

  const systemPrompt =
    'أنت محامٍ خبير في الأحوال الشخصية للمسلمين في إسرائيل، تترافع أمام المحاكم الشرعية ومحاكم شؤون العائلة. مهمتك: قراءة المستند المرفق بالكامل (وهو مستند وارد مثل قرار محكمة أو لائحة دعوى أو طلب من الطرف الآخر) وصياغة مسودة رد قانوني عليه. القالب الحاكم للصياغة والتنسيق وتفاصيل المحامي وبنية الفقرات المرقّمة هو الوثيقة المرجعية التالية، والتزم بها حرفياً كمرجع للأسلوب والشكل:\n\n<skill>\n' +
    skill +
    '\n</skill>\n\nقاعدة اللغة الإلزامية: اكتشف لغة المستند المرفق أياً كانت (عربية، عبرية، إنجليزية، فرنسية، روسية، أو أي لغة أخرى) بالاعتماد على متن المستند القانوني نفسه لا على صفحة الغلاف. كثير من الملفات تبدأ بصفحة أولى آلية بالعبرية هي مجرد "אישור הגשה" (إشعار استلام من نظام المحكمة الإلكتروني) — تجاهل هذه الصفحة عند تحديد اللغة واعتمد على المتن الذي يليها. وبوجه خاص: إذا كان المستند مرتبطاً بالمحكمة الشرعية (בית הדין השרעי / المحكمة الشرعية) بأي شكل — مقدَّماً إليها أو موجَّهاً إليها أو صادراً عنها (قرار أو حكم أو محضر أو أمر منها، مثل "החלטה"/"قرار"/"حكم"/"محضر") — أو كان متنه مكتوباً بالعربية، فاللغة هي ar واكتب المسودة بالعربية حتى لو كانت الصفحة الأولى (إشعار الاستلام) بالعبرية. اكتب المسودة بلغة المستند نفسها فقط، ولا تخلط لغتين في مسودة واحدة. ضع رمز اللغة في الحقل detected_language (مثل ar أو he أو en أو fr أو ru) وضع نص المسودة الكامل في الحقل draft بلغة المستند. لا تختلق وقائع أو تواريخ أو أسماء غير موجودة في المستند أو في ملاحظات القضية. أعِد كائن JSON واحداً فقط، دون أي نص خارج JSON، ودون Markdown، وأول حرف في ردك يجب أن يكون القوس {.' +
    '\n\n' +
    AR_GLOSSARY;

  const userText =
    'اقرأ المستند المرفق بالكامل كلمةً كلمةً. مكتبنا/المحامي صاحب الملف هو: ' +
    lawyerName +
    '.\n\nأولاً صنِّف المستند. طريقة تحديد مَن قدّم المستند إلزامية وواحدة لا غير: انظر في نهاية المستند (الصفحة الأخيرة، أسفل آخر فقرة) وحدِّد اسم الموقّع عليه — سطر التوقيع أو الخاتم أو عبارة «بكل احترام»/«בכבוד רב» يليها اسم محامٍ. الموقّع في نهاية المستند هو مَن حرّره وقدّمه. لا تعتمد إطلاقاً على الأسماء الواردة داخل متن المستند (أسماء الأطراف، أو المحامين المذكورين في الترويسة أو في سرد الوقائع)، بل على التوقيع في نهايته وحده.\n' +
    '- author_side:\n' +
    '  · "ours" إذا كان الموقّع في نهاية المستند هو مكتبنا/المحامي المسجَّل (' +
    lawyerName +
    ')' +
    (clientName
      ? ' أو كان موقَّعاً من موكّلنا الذي نمثّله (' + clientName + ') أو مقدَّماً باسمه/نيابةً عنه'
      : '') +
    ' — أي أن المستند من إعداد وكيل موكّلنا في القضية.\n' +
    '  · "opposing" إذا كان الموقّع في نهاية المستند محامياً آخر — وكيل الطرف المقابل/الخصم — أو الطرف المقابل نفسه.\n' +
    '  · "court" إذا كان المستند صادراً عن المحكمة/القاضي (قرار، حكم، أمر، محضر/بروتوكول) وموقّعاً من القاضي أو من سكرتارية المحكمة.\n' +
    '  وإذا لم يظهر في نهاية المستند توقيعُ مكتبنا ولا توقيعُ محامٍ يوقّع نيابةً عن موكّلنا، ولم يكن المستند صادراً عن المحكمة، فاعتبره "opposing".\n' +
    '- signatory = اسم الموقّع كما ورد في نهاية المستند حرفياً (أو null إذا لم يوجد توقيع).\n' +
    '- is_court_decision = true إذا كان المستند قراراً أو حكماً أو أمراً صادراً عن القاضي/المحكمة (החלטה / פסק דין / צו / قرار / حكم / أمر)، وإلا false.\n' +
    CONTAINS_DECISION_RULE +
    '- court_requires_response = true إذا كان المستند يأمر أو يطلب تقديم رد/جواب/تعقيب، وإلا false.\n\n' +
    'قاعدة إعداد المسودة (إلزامية، طبّقها حرفياً):\n' +
    '1. author_side = "opposing" (الموقّع في نهاية المستند هو وكيل الطرف المقابل) ← يجب إلزامياً ملء الحقل draft بنص مسودة رد قانونية كاملة على هذا المستند وفق القالب الحاكم، ولا تتركه null أبداً.\n' +
    '2. is_court_decision = true (قرار/حكم صادر عن القاضي) ← يجب إلزامياً ملء الحقل draft في كل الأحوال، سواء طلب القرار رداً صراحةً أم لم يطلب، وتُصاغ المسودة وفق مضمون القرار نفسه وما يقتضيه من امتثال أو تعقيب أو إجراء تالٍ.\n' +
    '3. contains_court_decision = true (يتضمن المستند قراراً قضائياً في داخله، حتى لو كان موقّعاً من جانبنا) ← يجب إلزامياً ملء الحقل draft، وتُصاغ المسودة وفق مضمون ذلك القرار.\n' +
    '4. author_side = "court" و court_requires_response = true ← يجب ملء الحقل draft كذلك.\n' +
    '5. author_side = "ours" (المستند موقّع من مكتبنا/المحامي المسجَّل أو من موكّلنا أو مقدَّم نيابةً عنه) ولا يتضمن أي قرار قضائي ← لا حاجة لمسودة: اترك draft = null.\n\n' +
    'قبل صياغة المسودة اقرأ كل ملاحظات الموكل والقضية التالية (ملاحظات القضية، ملاحظة الموكل، ملاحظات المحامي في شاشة الملف، ملاحظات عند رفع المستندات، وملخصات باقي مستندات الملف). لا تؤثر هذه الملاحظات على التصنيف أعلاه، لكن عند إعداد المسودة يجب أن تُكيِّف الرد على المستند وفقها: اعتمد الوقائع والمواقف والتعليمات والخلفية الواردة فيها، وابنِ الرد على موقف موكّلنا كما يظهر منها، ولا تخالفها. إذا ادّعى المستند خلاف ما في الملاحظات فاعرض موقف موكّلنا كما في الملاحظات ورُدّ على ادعاء المستند صراحةً. لا تختلق ما لم يرد في المستند أو في الملاحظات:\n<case_notes>\n' +
    (notes.text || '(لا توجد ملاحظات محفوظة)') +
    '\n</case_notes>\n' +
    (notesContext
      ? 'ملاحظات إضافية من شاشة الملف في التطبيق — التزم بها أيضاً:\n<case_notes_app>\n' +
        notesContext +
        '\n</case_notes_app>\n'
      : '') +
    (rulings.text
      ? '\n\nمراجع من قرارات محكمة الاستئناف الشرعية العليا (פסיקת בית הדין השרעי) في المواضيع التي تخص هذا الملف. عند إعداد المسودة ابنِ الحجج القانونية عليها حيث تنطبق على المسألة المطروحة في المستند وعلى وقائع الملف.\n' +
        'قاعدة إلزامية: إذا كان المستند مكتوباً بالعربية ومرتبطاً بالمحكمة الشرعية (مقدَّماً إليها أو صادراً عنها) ويحتاج مسودة، فيجب أن تتضمن المسودة استشهاداً بقرارين على الأقل من هذه المراجع، كل استشهاد في موضعه من الحجج: اذكر رقم القرار كما ورد هنا ("القرار 244/2025") والمبدأ الذي يقرره. انسب كل مبدأ فقط إلى رقم القرار الوارد بجانبه في الجملة أو البند نفسه من المرجع، لا إلى قرار آخر مذكور في الفقرة. لا تذكر رقم قرار غير وارد هنا، ولا تنسب إلى قرار ما لم يرد فيه. في غير ذلك استعمل المراجع حيث تنطبق فقط:\n<sharia_rulings>\n' +
        rulings.text +
        '\n</sharia_rulings>'
      : '') +
    '\n\nصُغ (عند الحاجة فقط) مسودة رد قانوني كامل على هذا المستند وفق القالب الحاكم، بلغة المستند نفسها. أعِد كائن JSON واحداً فقط بهذا الهيكل بالضبط: {"detected_language": "رمز لغة المستند مثل ar أو he أو en أو fr أو ru", "author_side": "ours or opposing or court", "signatory": "اسم الموقّع في نهاية المستند أو null", "is_court_decision": true or false, "contains_court_decision": true or false, "court_requires_response": true or false, "is_sharia_court": "true إذا كان المستند مرتبطاً بالمحكمة الشرعية (مقدَّماً إليها أو صادراً عنها)، وإلا false", "doc_type": "نوع المستند الوارد", "title": "عنوان المسودة بلغة المستند أو null", "draft": "نص المسودة الكامل بلغة المستند أو null"}. لا تكتب أي شيء خارج JSON.';

  const anthropicBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 12000,
    system: systemPrompt,
    // Structured output: the reply is always valid JSON in this shape. A draft
    // that quotes a ruling ("القرار 244/2025") or the document can't break the
    // parse any more (it did, as an unescaped quote inside the JSON string).
    // Empty string = "none" (the prompt's null).
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            detected_language: { type: 'string' },
            author_side: { type: 'string', enum: ['ours', 'opposing', 'court'] },
            signatory: { type: 'string' },
            is_court_decision: { type: 'boolean' },
            contains_court_decision: { type: 'boolean' },
            court_requires_response: { type: 'boolean' },
            is_sharia_court: { type: 'boolean' },
            doc_type: { type: 'string' },
            title: { type: 'string' },
            draft: { type: 'string' },
          },
          required: [
            'detected_language',
            'author_side',
            'signatory',
            'is_court_decision',
            'contains_court_decision',
            'court_requires_response',
            'is_sharia_court',
            'doc_type',
            'title',
            'draft',
          ],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 },
          },
          { type: 'text', text: userText },
        ],
      },
    ],
  };

  // Retries with backoff on 429/529/5xx. A bare fetch (no retry) meant one
  // transient overload surfaced as a hard failure and stopped the make.com
  // module driving this endpoint.
  const call = await callAnthropicWithRetry(
    env.ANTHROPIC_API_KEY || '',
    JSON.stringify(anthropicBody),
  );
  if (!call.response) {
    return json(
      {
        error: 'anthropic_fetch_failed',
        detail: (call.networkError || '').slice(0, 300),
        attempts: call.attempts,
      },
      request,
      env,
      502,
    );
  }
  const resp = call.response;
  if (!resp.ok) {
    const errText = await resp.text();
    return json(
      {
        error: 'anthropic_error',
        status: resp.status,
        detail: errText.slice(0, 500),
        attempts: call.attempts,
      },
      request,
      env,
      502,
    );
  }
  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textOut = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('');
  const cleaned = textOut
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
  let draft: Record<string, unknown>;
  try {
    draft = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return json(
      { error: 'draft_parse_failed', raw: cleaned.slice(0, 600) },
      request,
      env,
      502,
    );
  }

  // Mandatory citations: a draft for an ARABIC document of the SHARIA court
  // must cite the office's Sharia Court of Appeals rulings. If it cites none
  // of the table's decisions, ask once more — the same conversation, with the
  // first answer and an explicit correction — and keep the corrected draft.
  let citationRetry = false;
  {
    const ar = String(draft.detected_language ?? '').toLowerCase().startsWith('ar');
    const sharia = draft.is_sharia_court === true || shariaCase;
    const text = typeof draft.draft === 'string' ? draft.draft : '';
    if (rulings.text && ar && sharia && text.trim().length > 40 && citedKnownDecisions(text).length === 0) {
      citationRetry = true;
      const retryBody = {
        ...anthropicBody,
        messages: [
          ...anthropicBody.messages,
          { role: 'assistant', content: [{ type: 'text', text: cleaned }] },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'المسودة لا تتضمن أي استشهاد بقرارات محكمة الاستئناف الشرعية العليا الواردة في <sharia_rulings>، وهذا إلزامي لمستند عربي مرتبط بالمحكمة الشرعية. أعد الكائن نفسه كاملاً، مع المسودة كاملة، وأضف في مواضعها من الحجج استشهاداً بقرارين على الأقل من تلك المراجع: رقم القرار كما ورد ("القرار 244/2025") والمبدأ الوارد بجانبه في المرجع. لا تذكر رقم قرار غير وارد فيها، ولا تغيّر باقي الحقول.',
              },
            ],
          },
        ],
      };
      const again = await callAnthropicWithRetry(env.ANTHROPIC_API_KEY || '', JSON.stringify(retryBody));
      if (again.response?.ok) {
        const d2 = (await again.response.json()) as { content?: Array<{ type: string; text?: string }> };
        const t2 = (d2.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
        try {
          const parsed = JSON.parse(t2) as Record<string, unknown>;
          if (typeof parsed.draft === 'string' && citedKnownDecisions(parsed.draft).length > 0) draft = parsed;
        } catch {
          /* keep the first draft */
        }
      }
    }
  }

  // Gate: see replyDraftNeeded. Authorship is decided by the SIGNATURE at the END
  // of the document.
  const authorSide = String(draft.author_side ?? '').toLowerCase().trim();
  const signatory = String(draft.signatory ?? '').trim();
  const isCourtDecision =
    draft.is_court_decision === true ||
    String(draft.is_court_decision ?? '').toLowerCase() === 'true';
  const containsCourtDecision =
    draft.contains_court_decision === true ||
    String(draft.contains_court_decision ?? '').toLowerCase() === 'true';
  const courtRequiresResponse =
    draft.court_requires_response === true ||
    String(draft.court_requires_response ?? '').toLowerCase() === 'true';
  const draftNeeded = replyDraftNeeded(
    authorSide,
    isCourtDecision,
    containsCourtDecision,
    courtRequiresResponse,
  );
  // The model now returns ONE `draft` field written in the document's own
  // language (any language). `draft_orig` always holds it; `draft_he`/`draft_ar`
  // mirror it ONLY for Hebrew/Arabic documents so the existing bilingual screens
  // and the he/ar fallback keep working. `draft_he`/`draft_ar` older keys are
  // still honored when a caller (e.g. the Make pipeline) sends them instead.
  const langCode = String(draft.detected_language ?? '').toLowerCase().trim();
  // The schema has no null: an empty string (or the word "null") means none.
  for (const k of ['signatory', 'title', 'draft']) {
    const v = draft[k];
    if (typeof v === 'string' && (!v.trim() || v.trim().toLowerCase() === 'null')) draft[k] = null;
  }
  const draftNative =
    draft.draft ??
    (langCode.startsWith('he')
      ? draft.draft_he
      : langCode.startsWith('ar')
        ? draft.draft_ar
        : null) ??
    null;
  const draftText = draftNeeded ? draftNative : null;
  const draftHe = draftText != null && langCode.startsWith('he') ? draftText : null;
  const draftAr = draftText != null && langCode.startsWith('ar') ? draftText : null;

  const row: Record<string, unknown> = {
    source_id: sourceId,
    document_source_id: documentSourceId,
    client_source_id: clientSrc || null,
    case_source_id: caseSrc || null,
    file_name: fileName || null,
    title: draft.title ?? null,
    title_ar: draft.title_ar ?? null,
    draft_he: draftHe,
    draft_ar: draftAr,
    draft_orig: draftText,
    language: draft.detected_language ?? null,
    doc_type: draft.doc_type ?? null,
    // 'approved' = classified, draft needed; 'not_needed' = classified, no
    // draft (Make writes 'draft' for unclassified rows — the app re-checks
    // those via /api/draft-decision).
    status: draftNeeded ? 'approved' : 'not_needed',
    date: new Date().toISOString().slice(0, 10),
  };
  let count = 0;
  let persistError = '';
  const built = buildUpsert('drafts', row, ctx.tenantId);
  if (built) {
    // Guard the write like /api/suggest-action does: the draft has already been
    // generated (the expensive part), so a D1 write failure here must NOT throw
    // out of the request — an unhandled throw becomes an opaque 502 for the
    // make.com draft step. Report it in the response instead.
    try {
      await ctx.db.prepare(built.sql)
        .bind(...built.binds)
        .run();
      count = 1;
    } catch (e) {
      persistError = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
    }
  }

  return json(
    {
      ok: true,
      count,
      source_id: sourceId,
      document_source_id: documentSourceId,
      detected_language: draft.detected_language || '',
      doc_type: draft.doc_type || '',
      title: draft.title || draft.title_ar || '',
      draft_needed: draftNeeded,
      author_side: authorSide || 'unknown',
      signatory,
      is_court_decision: isCourtDecision,
      contains_court_decision: containsCourtDecision,
      court_requires_response: courtRequiresResponse,
      // A draft can be produced in ANY language (stored in draft_orig even when
      // it's not Hebrew/Arabic), so report presence from draftText — not only
      // the he/ar columns, which are null for e.g. an English/French document.
      has_draft: draftText != null,
      notes_scope: notes.scope,
      notes_count: notes.count,
      notes_sources: notes.sources,
      rulings_topics: rulings.topics,
      // The table's decisions the stored draft cites, and whether the server
      // had to ask again for them.
      rulings_cited: citedKnownDecisions(String(draftText ?? '')),
      citation_retry: citationRetry || undefined,
      persist_error: persistError || undefined,
    },
    request,
    env,
  );
}

// ---------------------------------------------------------------------------
// POST /api/draft-decision
// Cheap classification-only check for an EXISTING document (typically a
// Make-written draft still marked status='draft'): reads the PDF with a small
// model, decides whether a reply draft is actually needed — by the SIGNATURE at
// the END of the document (ours → no draft, opposing counsel → draft) and by
// whether it is a judge's decision (always a draft) — and updates the draft
// row's status to 'approved' (needed) or 'not_needed' — WITHOUT
// regenerating the draft text (any existing draft is preserved). On any
// failure it defaults to 'approved' so a possibly-required reply is never
// silently hidden.
// ---------------------------------------------------------------------------
async function handleDraftDecision(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  // Same early guard as handleDraft — reject before the body is read, so an
  // oversized archive file can't push the isolate past its 128 MB ceiling.
  const tooBig = oversizedPdfBody(request);
  if (tooBig) {
    return json({ error: 'file_too_large', detail: tooBig }, request, env, 413);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  // No .trim() — see handleDraft.
  const pdfB64 = typeof body.pdf_base64 === 'string' ? body.pdf_base64 : '';
  if (!pdfB64) return json({ error: 'pdf_base64 required' }, request, env, 400);
  const fieldTooBig = oversizedPdfField(pdfB64.length);
  if (fieldTooBig) {
    return json({ error: 'file_too_large', detail: fieldTooBig }, request, env, 413);
  }

  const clientSrc = String(body.client_source_id || '').trim();
  const caseSrc = String(body.case_source_id || '').trim();
  const fileName = String(body.file_name || '').trim();
  const lawyerName =
    DEFAULT_LAWYER_NAME +
    (String(body.lawyer_name || '').trim()
      ? ' / ' + String(body.lawyer_name).trim()
      : '');
  // The party we represent — a document signed by them or submitted ON THEIR
  // BEHALF is also "ours" (no reply drafted against our own side).
  const clientName = await resolveClientName(ctx, clientSrc, body.client_name);

  const docMatch =
    /(DOC-\d+)/i.exec(fileName) ||
    /(DOC-\d+)/i.exec(String(body.source_id || '')) ||
    /(DOC-\d+)/i.exec(String(body.document_source_id || ''));
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  let sourceId = docId ? `DRAFT-${docId}` : '';
  if (!sourceId && fileName) {
    const base = fileName
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    if (base) sourceId = `DRAFT-${base}`;
  }
  if (!sourceId) {
    return json(
      { error: 'cannot derive source_id (need file_name or DOC id)' },
      request,
      env,
      400,
    );
  }
  const documentSourceId = docId || sourceId;

  const systemPrompt =
    'أنت مصنِّف مستندات قانونية لمكتب المحامي: ' +
    lawyerName +
    '. اقرأ المستند المرفق وأعِد كائن JSON واحداً فقط، دون أي نص آخر، وأول حرف {.';
  const userText =
    'حدِّد مَن قدّم هذا المستند بطريقة واحدة إلزامية: انظر في نهاية المستند (الصفحة الأخيرة، أسفل آخر فقرة) واقرأ اسم الموقّع عليه — سطر التوقيع أو الخاتم أو عبارة «بكل احترام»/«בכבוד רב» يليها اسم محامٍ. الموقّع في النهاية هو مَن حرّر المستند وقدّمه؛ لا تعتمد على الأسماء الواردة في الترويسة أو في متن المستند.\n' +
    '- author_side = "ours" فقط إذا كان الموقّع في نهاية المستند هو مكتبنا/المحامي ' +
    lawyerName +
    (clientName
      ? ' أو كان موقَّعاً من موكّلنا الذي نمثّله (' + clientName + ') أو مقدَّماً نيابةً عنه'
      : '') +
    '، أو "opposing" إذا كان الموقّع في نهايته محامي الطرف الآخر/الخصم أو الطرف الآخر نفسه، أو "court" إذا صدر عن المحكمة/القاضي. إذا لم يظهر توقيع مكتبنا في نهايته ولم يكن صادراً عن المحكمة فاعتبره "opposing".\n' +
    '- signatory = اسم الموقّع في نهاية المستند حرفياً (أو null).\n' +
    '- is_court_decision = true إذا كان المستند قراراً أو حكماً أو أمراً صادراً عن القاضي/المحكمة (החלטה / פסק דין / צו / قرار / حكم / أمر)، وإلا false.\n' +
    CONTAINS_DECISION_RULE +
    '- court_requires_response = true إذا كان المستند يأمر أو يطلب تقديم رد/جواب/تعقيب، وإلا false.\n' +
    'أعِد JSON فقط: {"author_side":"ours or opposing or court","signatory":"اسم الموقّع أو null","is_court_decision":true or false,"contains_court_decision":true or false,"court_requires_response":true or false}.';

  let draftNeeded = true; // safe default on any failure
  let authorSide = 'unknown';
  let signatory = '';
  let isCourtDecision = false;
  let containsCourtDecision = false;
  let courtRequiresResponse = false;
  try {
    // Retries with backoff on 429/529/5xx — see handleDraft.
    const call = await callAnthropicWithRetry(
      env.ANTHROPIC_API_KEY || '',
      JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdfB64,
                },
              },
              { type: 'text', text: userText },
            ],
          },
        ],
      }),
    );
    const resp = call.response;
    if (resp && !resp.ok) {
      // Surface WHY instead of silently falling through to draftNeeded=true.
      // A 400 here is usually the 100-page cap on this 200K-context model.
      console.error(
        `[worker] draft-decision anthropic ${resp.status} after ${call.attempts} ` +
          `attempt(s): ${(await resp.text()).slice(0, 300)}`,
      );
    }
    if (resp && resp.ok) {
      const data = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const textOut = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');
      const cleaned = textOut
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      authorSide =
        String(parsed.author_side ?? '').toLowerCase().trim() || 'unknown';
      signatory = String(parsed.signatory ?? '').trim();
      isCourtDecision =
        parsed.is_court_decision === true ||
        String(parsed.is_court_decision ?? '').toLowerCase() === 'true';
      containsCourtDecision =
        parsed.contains_court_decision === true ||
        String(parsed.contains_court_decision ?? '').toLowerCase() === 'true';
      courtRequiresResponse =
        parsed.court_requires_response === true ||
        String(parsed.court_requires_response ?? '').toLowerCase() === 'true';
      // Same gate as /api/draft.
      draftNeeded = replyDraftNeeded(
        authorSide,
        isCourtDecision,
        containsCourtDecision,
        courtRequiresResponse,
      );
    }
  } catch {
    // keep safe defaults (draftNeeded = true)
  }

  // Update ONLY the status (+ ids when provided) so any existing draft text,
  // title and language are preserved by buildUpsert (absent columns are not
  // written on conflict).
  const row: Record<string, unknown> = {
    source_id: sourceId,
    document_source_id: documentSourceId,
    status: draftNeeded ? 'approved' : 'not_needed',
  };
  if (clientSrc) row.client_source_id = clientSrc;
  if (caseSrc) row.case_source_id = caseSrc;
  const built = buildUpsert('drafts', row, ctx.tenantId);
  if (built) {
    await ctx.db.prepare(built.sql)
      .bind(...built.binds)
      .run();
  }

  return json(
    {
      ok: true,
      source_id: sourceId,
      document_source_id: documentSourceId,
      draft_needed: draftNeeded,
      author_side: authorSide,
      signatory,
      is_court_decision: isCourtDecision,
      contains_court_decision: containsCourtDecision,
      court_requires_response: courtRequiresResponse,
    },
    request,
    env,
  );
}

// Shared classifier instruction: a judicial decision INSIDE a document, as
// opposed to a document that IS a decision.
const CONTAINS_DECISION_RULE =
  '- contains_court_decision = true إذا تضمّن المستند في أي موضع منه قراراً أو حكماً أو أمراً صادراً عن القاضي/المحكمة، حتى لو كان المستند نفسه لائحة أو طلباً موقّعاً من أي طرف (مثل قرار مدوَّن أو مختوم على الطلب، أو قرار مرفق به)، وإلا false. لا يُعدّ مجرد ذكر قرار سابق في المتن أو إشعار استلام أو دعوة لجلسة قراراً.\n';

// The reply-draft rule. A draft is prepared ONLY for a judge's decision, a
// document containing one, or a filing by the other side. Our own document
// (signed by our lawyer or the client we represent) with no decision in it never
// gets one, even if it asks for a response; nor does a court document that is
// neither a decision nor a reply order (e.g. a filing receipt — the
// suggested-action card covers those). An unknown author still gets a draft: a
// missed deadline is far worse than an extra draft.
function replyDraftNeeded(
  authorSide: string,
  isCourtDecision: boolean,
  containsCourtDecision: boolean,
  courtRequiresResponse: boolean,
): boolean {
  if (isCourtDecision || containsCourtDecision) return true;
  if (authorSide === 'ours') return false;
  if (authorSide === 'court') return courtRequiresResponse;
  return true;
}

// The client's name for the "ours" check. The app sends it; the make.com pipeline
// doesn't, so fall back to this office's client row (names in both languages).
async function resolveClientName(
  ctx: Ctx,
  clientSrc: string,
  provided: unknown,
): Promise<string> {
  const given = String(provided || '').trim();
  if (given || !clientSrc) return given;
  try {
    const row = await ctx.db.prepare(
      'SELECT full_name, full_name_ar FROM clients WHERE user_id = ? AND lower(source_id) = lower(?) LIMIT 1',
    )
      .bind(ctx.tenantId, clientSrc)
      .first<{ full_name?: string; full_name_ar?: string }>();
    return [row?.full_name, row?.full_name_ar]
      .map((n) => String(n || '').trim())
      .filter(Boolean)
      .join(' / ');
  } catch {
    return '';
  }
}

// Every note the office holds on this client and case, read from D1 so the draft
// sees them even when the caller (make.com) sends no notes_context. Mirrors the
// brain "הערות" tab (lib/caseNotes.ts): case_notes for the case AND the client,
// the client's own note, brain quick-action notes, document-upload notes, and the
// AI summary of every OTHER document in the case. Each source is read on its own
// so one missing table/column in an office DB doesn't drop the rest.
const DRAFT_NOTE_MAX_CHARS = 2000;
const DRAFT_NOTES_MAX_CHARS = 30000;

async function fetchDraftNotes(
  env: Env,
  ctx: Ctx,
  clientSrc: string,
  caseSrc: string,
  excludeDocId = '',
): Promise<{ text: string; count: number; scope: string; sources: Record<string, number> }> {
  const pick = (he?: unknown, ar?: unknown) => String(he || ar || '').trim();
  const clip = (s: string) =>
    s.length > DRAFT_NOTE_MAX_CHARS ? s.slice(0, DRAFT_NOTE_MAX_CHARS) + '…' : s;
  const sources: Record<string, number> = {};
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (source: string, label: string, body: string, date?: unknown) => {
    const text = clip(body.trim());
    if (!text || seen.has(text)) return;
    seen.add(text);
    const d = String(date || '').slice(0, 10);
    lines.push(`[${label}${d ? ' | ' + d : ''}] ${text}`);
    sources[source] = (sources[source] || 0) + 1;
  };
  const all = async <T>(sql: string, ...binds: unknown[]): Promise<T[]> => {
    try {
      const rs = await ctx.db.prepare(sql).bind(...binds).all<T>();
      return rs.results ?? [];
    } catch {
      return [];
    }
  };
  // case ids are stored bare ("CS-1024") or labelled ("cs-1024 - title").
  const sameId = (col: string, n: number) =>
    `(upper(${col}) = upper(?${n}) OR upper(${col}) LIKE upper(?${n}) || ' %')`;

  type NoteRow = { note?: string; note_ar?: string; date?: string; case_id?: string };
  if (caseSrc || clientSrc) {
    const rows = await all<NoteRow>(
      'SELECT note, note_ar, date, case_id FROM case_notes WHERE user_id = ?1 AND (' +
        `(?2 <> '' AND ${sameId('case_id', 2)}) OR ` +
        // Client-level notes only: another case's notes would steer this reply.
        `(?3 <> '' AND ${sameId('client_id', 3)} AND coalesce(case_id, '') = '')` +
        ') ORDER BY date ASC, created_at ASC',
      ctx.tenantId,
      caseSrc,
      clientSrc,
    );
    for (const r of rows) {
      add(r.case_id ? 'case_note' : 'client_case_note', r.case_id ? 'הערת תיק' : 'הערת לקוח', pick(r.note, r.note_ar), r.date);
    }
  }

  if (clientSrc) {
    const rows = await all<{ notes?: string; notes_ar?: string }>(
      'SELECT notes, notes_ar FROM clients WHERE user_id = ?1 AND lower(source_id) = lower(?2) LIMIT 1',
      ctx.tenantId,
      clientSrc,
    );
    for (const r of rows) add('client_note', 'הערת לקוח', pick(r.notes, r.notes_ar));
  }

  if (caseSrc) {
    const timeline = await all<{
      title?: string; title_ar?: string; description?: string; description_ar?: string; date?: string;
    }>(
      "SELECT title, title_ar, description, description_ar, date FROM timeline_items WHERE user_id = ?1 AND lower(coalesce(type, 'note')) = 'note' AND " +
        sameId('case_source_id', 2) +
        ' ORDER BY date ASC, created_at ASC',
      ctx.tenantId,
      caseSrc,
    );
    for (const r of timeline) {
      add(
        'brain_note',
        'הערה במסך המוח',
        [pick(r.title, r.title_ar), pick(r.description, r.description_ar)].filter(Boolean).join(' — '),
        r.date,
      );
    }

    type DocRow = {
      source_id?: string; title?: string; title_ar?: string; file_name?: string; date?: string;
      description?: string; description_ar?: string; summary_he?: string; summary_ar?: string;
    };
    const docs = await all<DocRow>(
      'SELECT source_id, title, title_ar, file_name, date, description, description_ar, summary_he, summary_ar ' +
        'FROM documents WHERE user_id = ?1 AND ' +
        sameId('case_source_id', 2) +
        ' ORDER BY date ASC, created_at ASC',
      ctx.tenantId,
      caseSrc,
    );
    const docIdOf = (s: unknown) => (/(DOC-\d+)/i.exec(String(s || ''))?.[1] || '').toUpperCase();
    const summarized = new Set<string>();
    for (const d of docs) {
      const name = pick(d.title, d.title_ar) || String(d.file_name || '').trim();
      add('document_note', 'הערה על מסמך' + (name ? ' — ' + name : ''), pick(d.description, d.description_ar), d.date);
      const id = docIdOf(d.source_id) || docIdOf(d.file_name);
      // The document being answered is attached in full; its summary adds nothing.
      if (excludeDocId && id === excludeDocId) continue;
      const summary = pick(d.summary_he, d.summary_ar);
      if (summary) {
        if (id) summarized.add(id);
        add('document_summary', 'תקציר מסמך' + (name ? ' — ' + name : ''), summary, d.date);
      }
    }
    // file_summary holds summaries the documents row may not have mirrored yet.
    const fileSummaries = await all<{ file_name?: string; summary_he?: string; summary_ar?: string; created_at?: string }>(
      'SELECT file_name, summary_he, summary_ar, created_at FROM file_summary WHERE ' +
        sameId('case_id', 1) +
        ' ORDER BY id ASC',
      caseSrc,
    );
    for (const s of fileSummaries) {
      const id = docIdOf(s.file_name);
      if ((excludeDocId && id === excludeDocId) || (id && summarized.has(id))) continue;
      if (id) summarized.add(id);
      add('document_summary', 'תקציר מסמך — ' + String(s.file_name || '').split('/').pop(), pick(s.summary_he, s.summary_ar), s.created_at);
    }
  }

  let text = '';
  for (const line of lines) {
    if (text.length + line.length > DRAFT_NOTES_MAX_CHARS) break;
    text += (text ? '\n\n' : '') + line;
  }
  const scope = caseSrc && clientSrc ? 'case+client' : caseSrc ? 'case' : clientSrc ? 'client' : 'none';
  return { text, count: lines.length, scope, sources };
}

// ---------------------------------------------------------------------------
// GET /api/case-notes
// ---------------------------------------------------------------------------
async function handleCaseNotes(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const caseId = (url.searchParams.get('caseId') || '').trim();
  const clientId = (url.searchParams.get('clientId') || '').trim();
  const binds: unknown[] = [ctx.tenantId];
  let sql =
    'SELECT source_id, client_id, case_id, note, note_ar, date, created_at ' +
    'FROM case_notes WHERE user_id = ?1';
  if (caseId) {
    binds.push(caseId);
    sql += ` AND upper(case_id) = upper(?${binds.length})`;
  }
  if (clientId) {
    binds.push(clientId);
    sql += ` AND lower(client_id) = lower(?${binds.length})`;
  }
  sql += ' ORDER BY date DESC, created_at DESC';
  const rs = await ctx.db.prepare(sql)
    .bind(...binds)
    .all();
  return json({ notes: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/drafts
// ---------------------------------------------------------------------------
async function handleDrafts(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const caseId = (url.searchParams.get('caseId') || '').trim();
  const clientId = (url.searchParams.get('clientId') || '').trim();
  const documentId = (url.searchParams.get('documentId') || '').trim();
  const binds: unknown[] = [ctx.tenantId];
  let sql =
    'SELECT source_id, case_source_id, client_source_id, document_source_id, ' +
    'file_name, title, title_ar, draft_he, draft_ar, draft_orig, language, doc_type, ' +
    'status, date, updated_at FROM drafts WHERE user_id = ?1 ' +
    "AND source_id NOT LIKE '%/%'";
  if (caseId) {
    binds.push(caseId);
    sql += ` AND upper(case_source_id) = upper(?${binds.length})`;
  }
  if (clientId) {
    binds.push(clientId);
    sql += ` AND lower(client_source_id) = lower(?${binds.length})`;
  }
  if (documentId) {
    binds.push(documentId);
    sql += ` AND upper(document_source_id) = upper(?${binds.length})`;
  }
  sql += ' ORDER BY date DESC, updated_at DESC';
  const rs = await ctx.db.prepare(sql)
    .bind(...binds)
    .all();
  return json({ drafts: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/skills
// ---------------------------------------------------------------------------
async function handleSkills(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const key = (url.searchParams.get('key') || '').trim();
  const all = (url.searchParams.get('all') || '').trim() === '1';
  const binds: unknown[] = [ctx.tenantId];
  let sql =
    'SELECT source_id, skill_key, title, title_ar, content, language, ' +
    'status, date, updated_at FROM skills WHERE user_id = ?1';
  if (!all) sql += " AND lower(coalesce(status, 'active')) = 'active'";
  if (key) {
    binds.push(key);
    sql += ` AND skill_key = ?${binds.length}`;
  }
  sql += ' ORDER BY updated_at DESC';
  const rs = await ctx.db.prepare(sql)
    .bind(...binds)
    .all();
  return json({ skills: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// POST /api/upload-photo
// ---------------------------------------------------------------------------
async function handleUploadPhoto(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'expected multipart/form-data' }, request, env, 400);
  }
  const entry = form.get('file');
  const clientId = String(form.get('clientId') || 'misc');
  if (!entry || typeof entry === 'string') {
    return json({ error: 'no file' }, request, env, 400);
  }
  const file = entry as unknown as {
    name?: string;
    type?: string;
    arrayBuffer(): Promise<ArrayBuffer>;
  };

  const fileName = typeof file.name === 'string' ? file.name : 'file';
  const key = `${ctx.tenantId}/client-photos/${clientId}/${Date.now()}-${safeName(fileName)}`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  });

  const origin = new URL(request.url).origin;
  const url = `${origin}/api/photo/${key}`;
  return json({ url }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/legal-actions?court_type=sharia
// ---------------------------------------------------------------------------
async function handleLegalActions(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const courtType = (url.searchParams.get('court_type') || '').trim();
  if (!courtType) {
    return json({ error: 'court_type parameter required' }, request, env, 400);
  }
  // legal_actions is shared reference data — it lives in the CONTROL DB, not
  // in each office's database.
  const rs = await env.CONTROL_DB.prepare(
    `SELECT id, stage, action_name, responsible, deadline, deadline_from, legal_source, practical_notes
     FROM legal_actions
     WHERE court_type = ?
     ORDER BY id ASC`,
  )
    .bind(courtType)
    .all();
  return json({ court_type: courtType, actions: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// POST /api/suggested-actions
// ---------------------------------------------------------------------------
async function handleSaveSuggestedAction(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const str = (v: unknown) => String(v ?? '').trim() || null;
  // client_id and case_id are NOT NULL — bind '' (never null) so an empty value
  // can't throw a constraint error (which would surface as HTTP 1101).
  const req = (v: unknown) => String(v ?? '').trim();
  try {
    await ctx.db.prepare(
      `INSERT INTO case_suggested_actions
       (client_id, case_id, document_name, court_type, suggested_action, deadline, legal_source, confidence, reasoning)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(
        req(body.client_id),
        req(body.case_id),
        str(body.document_name),
        str(body.court_type),
        str(body.suggested_action),
        str(body.deadline),
        str(body.legal_source),
        str(body.confidence),
        str(body.reasoning),
      )
      .run();
  } catch (e) {
    return json({ error: 'persist_failed', detail: String(e).slice(0, 200) }, request, env, 500);
  }
  return json({ ok: true }, request, env);
}

// Map a case's free-text court ("שלום ירושלים", "משפחה חיפה", "עבודה...",
// "שרעי יפו", "עליון" / "בג\"ץ") to the legal_actions court_type(s) to suggest
// from. Family also gets the civil track as a secondary option, per the
// office's rule. Falls back to civil.
function mapCourtTypes(court: string): string[] {
  const c = (court || '').toLowerCase();
  if (/שרע|شرع/.test(c)) return ['sharia'];
  if (/משפח|عائل|أسر|family/.test(c)) return ['family', 'civil'];
  if (/עבוד|ביטוח לאומי|عمل|تأمين وطني|labor/.test(c)) return ['labor'];
  if (/עליון|בג["”'׳״]?ץ|בגץ|عليا|عدل عليا|high court|hcj/.test(c)) return ['hcj'];
  if (/פליל|جزائ|جناي|criminal/.test(c)) return ['criminal'];
  return ['civil']; // שלום / מחוזי / default
}

// ---------------------------------------------------------------------------
// POST /api/suggest-action
// Generate a court-MATCHED suggested next action for a case: maps the case's
// court to the right legal_actions court_type(s) (family also includes civil),
// then asks a small model to pick the most relevant next step FROM that list
// given the latest document/context. Saves it to case_suggested_actions (so
// the existing GET still serves it) and returns it.
// ---------------------------------------------------------------------------
async function handleSuggestAction(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const caseId = String(body.case_id ?? '').trim();
  const clientId = String(body.client_id ?? '').trim();
  const court = String(body.court ?? '').trim();
  const docSummary = String(body.doc_summary ?? '').trim();
  const docName = String(body.document_name ?? '').trim();
  const lang = String(body.lang ?? 'he').trim().toLowerCase();
  // Party awareness: the client we represent + the registered lawyer, so the
  // model suggests an action for OUR side only — never the opposing party's move
  // and never a response to a document our own side authored.
  const clientName = String(body.client_name ?? '').trim();
  const lawyerName =
    DEFAULT_LAWYER_NAME +
    (String(body.lawyer_name || '').trim()
      ? ' / ' + String(body.lawyer_name).trim()
      : '');
  // Optional AUTHORITATIVE override of which side we represent (the lawyer's
  // pick in the "צד מיוצג" selector). When set, the model treats it as fact
  // instead of inferring; when empty, the model infers it from the parties.
  const representedPartyOverride = String(body.represented_party ?? '').trim();
  if (!caseId) return json({ error: 'case_id required' }, request, env, 400);

  // The full CHAIN of documents already filed in this case, read straight from
  // the Cloudflare `documents` table, oldest → newest. The model uses it to
  // infer the CURRENT procedural stage (what has already been filed vs. what is
  // missing) and propose the next logical step accordingly.
  let docsChain = '';
  try {
    const dRs = await ctx.db.prepare(
      `SELECT title, title_ar, file_name, date, created_at
       FROM documents
       WHERE user_id = ?1 AND upper(case_source_id) = upper(?2)
       ORDER BY COALESCE(NULLIF(date, ''), created_at) ASC, created_at ASC`,
    )
      .bind(ctx.tenantId, caseId)
      .all();
    const caseDocs = (dRs.results ?? []) as Array<Record<string, unknown>>;
    docsChain = caseDocs
      .map((d, i) => {
        const name = String(d.title || d.title_ar || d.file_name || '-').trim();
        const when = String(d.date || '').trim();
        return `${i + 1}. ${name}${when ? ' — ' + when : ''}`;
      })
      .join('\n');
  } catch {
    docsChain = '';
  }

  // Shown when the case is at a stage with no proactive step for the office
  // (awaiting the court's decision or the other side's move).
  const waitMsg =
    lang === 'ar'
      ? 'في هذه المرحلة لا يوجد إجراء مبادر مطلوب من المكتب وفق أصول المحاكمات — يجب انتظار قرارات وتوجيهات جديدة في الملف.'
      : 'בשלב זה אין פעולה יזומה הנדרשת מהמשרד לפי סדרי הדין — יש להמתין להחלטות ולהנחיות חדשות בתיק.';

  const courtTypes = mapCourtTypes(court);
  const placeholders = courtTypes.map((_, i) => '?' + (i + 1)).join(', ');
  // legal_actions is shared reference data — read it from the CONTROL DB.
  const rs = await env.CONTROL_DB.prepare(
    `SELECT court_type, stage, action_name, responsible, deadline, deadline_from, legal_source, practical_notes
     FROM legal_actions WHERE court_type IN (${placeholders}) ORDER BY court_type, id`,
  )
    .bind(...courtTypes)
    .all();
  const actions = (rs.results ?? []) as Array<Record<string, unknown>>;
  if (actions.length === 0) {
    return json(
      { ok: false, error: 'no_actions_for_court_type', court_types: courtTypes },
      request,
      env,
    );
  }

  const actionsText = actions
    .map(
      (a) =>
        `- [${a.court_type} | ${a.stage}] ${a.action_name} | אחראי: ${a.responsible || '-'} | מועד: ${a.deadline || '-'} (${a.deadline_from || '-'}) | מקור: ${a.legal_source || '-'}${a.practical_notes ? ' | הערה: ' + a.practical_notes : ''}`,
    )
    .join('\n');

  const systemPrompt =
    'אתה עוזר משפטי במשרד עורך הדין ' +
    lawyerName +
    '. קיבלת: (א) את תוכן/פענוח המסמך האחרון שהתקבל בתיק (מה שנקבע או נדרש בו), (ב) את שרשרת המסמכים שכבר הוגשו, ו-(ג) רשימת הפעולות האפשריות לפי סדרי הדין של הערכאה הרלוונטית.\n\n' +
    (clientName
      ? 'לקוח המשרד בתיק זה — הצד שאנו מייצגים — הוא: ' +
        clientName +
        '. זהו הצד המיוצג על ידי עורך הדין הנ"ל; הצד שכנגד אינו מיוצג על ידינו.\n\n'
      : '') +
    'לפני בחירת הפעולה בצע ניתוח צד מחייב:\n' +
    (representedPartyOverride
      ? '1. עובדה ודאית שקבע עורך הדין: לקוח המשרד' +
        (clientName ? ' (' + clientName + ')' : '') +
        ' הוא ה' +
        representedPartyOverride +
        ' בתיק. אמץ זאת כנתון ודאי ואל תסיק צד אחר.\n'
      : '1. קבע לפי שמות הצדדים בשרשרת המסמכים ובמסמך האחרון האם לקוח המשרד' +
        (clientName ? ' (' + clientName + ')' : '') +
        ' הוא התובע/המבקש/העותר או הנתבע/המשיב באותה ערכאה.\n') +
    '2. קבע מי חיבר/הגיש בפועל את המסמך האחרון לפי החתימה שבסוף המסמך (העמוד האחרון, מתחת לפסקה האחרונה — "בכבוד רב" ושם עורך הדין החתום), ולא לפי מי שמוזכר בכותרת או בגוף המסמך: אם החתום הוא עורך דיננו הרשום או מי שהגיש בשם הלקוח שאנו מייצגים — צד המשרד; אם החתום הוא בא כוח הצד שכנגד — הצד שכנגד; אם המסמך יצא מבית המשפט/בית הדין (החלטה, פסק דין, צו, פרוטוקול) — בית המשפט/בית הדין.\n' +
    '3. בחר אך ורק פעולה שעל הצד שאנו מייצגים לנקוט לפי סדר הדין. חל איסור מוחלט: אל תציע פעולה ששייכת לצד שכנגד (הצד שאיננו מייצגים), ואל תציע פעולה או תגובה לטובת הצד השני. כמו כן, אם את המסמך האחרון חיבר צד המשרד עצמו, אל תציע תגובה אליו — אלא אם קיימת חובה דיונית פתוחה שהמסמך מטיל דווקא על לקוח המשרד. אם המסמך האחרון חובר על ידי צד המשרד ואין פעולת המשך הנדרשת מאיתנו לפי סדר הדין, החזר את הודעת ההמתנה.\n\n' +
    'משימתך: תחילה קבע מהו השלב הנוכחי לפי שרשרת המסמכים, ואז בחר מתוך הרשימה שסופקה את הפעולה שעל הצד שאנו מייצגים לנקוט — התואמת גם לתוכן המסמך האחרון וגם לשלב, ומוקבלת לסדר הדין של אותה ערכאה. בחר אך ורק מתוך הרשימה שסופקה; אל תציע פעולה ששלבה כבר חלף, ואל תמציא פעולות, מועדים או מקורות שאינם ברשימה. החזר אובייקט JSON אחד בלבד, ללא טקסט נוסף, ותו ראשון {.';
  const userText =
    'הערכאה: ' +
    (court || '-') +
    ' (court_type: ' +
    courtTypes.join(' + ') +
    ').\n\nתוכן/פענוח המסמך האחרון שהתקבל בתיק (זהו הבסיס העיקרי — בחר את הפעולה נגדו ו/או לאורו):\n' +
    (docSummary ||
      '(אין תוכן למסמך האחרון — הסתמך על שרשרת המסמכים לעיל)') +
    '\n\nשרשרת המסמכים שכבר הוגשו/מצויים בתיק, לפי סדר הזמן (מהישן לחדש):\n' +
    (docsChain || '(אין עדיין מסמכים בתיק)') +
    '\n\nקבע לפי שרשרת המסמכים מה כבר בוצע ומהו השלב הנוכחי, ובחר את הפעולה הבאה ההגיונית התואמת גם לתוכן המסמך האחרון וגם לשלב זה, מוקבלת לסדר הדין של הערכאה.\n\nרשימת הפעולות האפשריות בערכאה זו (בחר אך ורק מתוכה):\n' +
    actionsText +
    '\n\nאם בשלב הנוכחי אין פעולה יזומה שעל המשרד לנקוט לפי סדרי הדין (התיק ממתין להחלטת בית הדין/בית המשפט או לצעד מצד שכנגד), החזר את suggested_action בדיוק כך: "' +
    waitMsg +
    '" והשאר deadline ו-legal_source ריקים.\n\n' +
    (lang === 'ar'
      ? 'اكتب كل النصوص في الحقول suggested_action و reasoning و deadline و legal_source باللغة العربية الفصحى القانونية المهنية فقط. قائمة الإجراءات والمواعيد والمصادر مكتوبة بالعبرية — تَرجِمها ترجمةً قانونيةً دقيقةً إلى مصطلحات عربية قانونية حقيقية. مُنِعَ منعاً باتاً نقلُ أي كلمة عبرية أو أجنبية نقحرةً (كتابةً صوتيةً بأحرف عربية)؛ كل كلمة يجب أن تكون كلمةً عربيةً صحيحةً وذات معنى قانوني سليم. أبقِ الأرقام وأرقام المواد/الأنظمة كما هي وترجِم أسماءها ووصفها إلى العربية (مثال: «כתב תביעה» ← «لائحة دعوى»، «תקנה» ← «مادة/نظام»، «בית משפט לענייני משפחה» ← «محكمة شؤون الأسرة»).\n\n' +
        AR_GLOSSARY +
        '\n\n'
      : 'כתוב את suggested_action ואת reasoning בעברית. ') +
    'שדה deadline_days: אם המועד שבחרת נקוב בימים — החזר את מספר הימים כמספר שלם (וכשיש בשורה כמה חלופות, כגון "45 / 30 / 15 ימים" או "60 ימים; רשלנות רפואית - 120 ימים", בחר את המספר הרלוונטי לתיק לפי תוכן המסמך האחרון); אם המועד אינו נקוב בימים (למשל "פותח את ההליך", "בלא דיחוי", "יחד עם כתב ההגנה", "ללא שיהוי") — החזר null.\n\n' +
    'החזר JSON: {"represented_party":"הצד שאנו מייצגים לפי הניתוח — תובע/מבקש/עותר או נתבע/משיב","author_side":"מי חיבר את המסמך האחרון — ours או opposing או court","suggested_action":"שם הפעולה והסבר קצר מה על הצד שאנו מייצגים לעשות","deadline":"המועד מתוך הרשימה","deadline_days":<מספר שלם או null>,"legal_source":"התקנה/המקור מתוך הרשימה","reasoning":"נימוק קצר","confidence":"high או medium או low"}.';

  let suggested = '';
  let deadline = '';
  let deadlineDays: number | null = null;
  let legalSource = '';
  let reasoning = '';
  let confidence = '';
  let representedParty = '';
  let authorSide = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 900,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const textOut = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');
      const cleaned = textOut
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      suggested = String(parsed.suggested_action ?? '').trim();
      deadline = String(parsed.deadline ?? '').trim();
      // deadline_days: a raw integer (or null) the model derives for the action
      // it picked. Tolerate a numeric string too. Non-numeric → null.
      const rawDays = parsed.deadline_days;
      if (typeof rawDays === 'number' && Number.isFinite(rawDays) && rawDays > 0) {
        deadlineDays = Math.round(rawDays);
      } else if (typeof rawDays === 'string' && /^\s*\d{1,3}\s*$/.test(rawDays)) {
        const n = parseInt(rawDays.trim(), 10);
        deadlineDays = n > 0 ? n : null;
      } else {
        deadlineDays = null;
      }
      legalSource = String(parsed.legal_source ?? '').trim();
      reasoning = String(parsed.reasoning ?? '').trim();
      confidence = String(parsed.confidence ?? '').trim();
      representedParty = String(parsed.represented_party ?? '').trim();
      authorSide = String(parsed.author_side ?? '').trim().toLowerCase();
    }
  } catch {
    // fall through — suggested stays empty, handled below
  }

  if (!suggested) {
    // No proactive step at this stage (or the model returned nothing) → tell
    // the office to wait for new decisions/instructions instead of failing.
    suggested = waitMsg;
    deadline = '';
    deadlineDays = null;
    legalSource = '';
    if (!reasoning) reasoning = waitMsg;
    confidence = confidence || 'low';
  }

  // The lawyer's explicit "צד מיוצג" pick is authoritative — it wins over the
  // model's inference (and holds even if the AI call failed entirely).
  if (representedPartyOverride) representedParty = representedPartyOverride;

  // `client_id` is NOT NULL in the table — bind '' (never null) so a case
  // without a resolved client can't crash the INSERT (which, being outside the
  // AI try/catch, would surface as a Worker exception / HTTP 1101 and leave the
  // "הצעה לפעולה" card empty). Wrap the write too, so a suggestion is still
  // returned even if persistence hiccups.
  try {
    await ctx.db.prepare(
      `INSERT INTO case_suggested_actions
       (client_id, case_id, document_name, court_type, suggested_action, deadline, deadline_days, represented_party, legal_source, confidence, reasoning)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
      .bind(
        clientId || '',
        caseId,
        docName || null,
        courtTypes.join(','),
        suggested,
        deadline || null,
        deadlineDays,
        representedParty || null,
        legalSource || null,
        confidence || null,
        reasoning || null,
      )
      .run();
  } catch (e) {
    console.warn('[suggest-action] persist failed', String(e).slice(0, 200));
  }

  return json(
    {
      ok: true,
      court_types: courtTypes,
      represented_party: representedParty,
      author_side: authorSide,
      suggested_action: suggested,
      deadline,
      deadline_days: deadlineDays,
      legal_source: legalSource,
      reasoning,
      confidence,
    },
    request,
    env,
  );
}

// ---------------------------------------------------------------------------
// POST /api/split-decision
// For a court DECISION / PROTOCOL document, split its (Cloudflare) summary into
// the operative DECISION/ruling part and the REST, so the decode box can show
// the decision first and the rest after a separator. Pure text (uses the
// existing summary — no PDF). On any failure returns the whole text as `rest`.
// ---------------------------------------------------------------------------
async function handleSplitDecision(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const summary = String(body.summary ?? '').trim();
  // Distinguish "no language requested" (e.g. the make.com pipeline) from an
  // explicit 'he'/'ar'. The app forces a language; the pipeline sends none, and
  // must get the decision summary back in the SUMMARY'S OWN language (regression
  // fix: previously the missing lang defaulted to 'he' and translated Arabic
  // decision summaries into Hebrew).
  const langSent = String(body.lang ?? '').trim().toLowerCase();
  const clientName = String(body.client_name ?? '').trim();
  const lawyerName =
    DEFAULT_LAWYER_NAME +
    (String(body.lawyer_name || '').trim()
      ? ' / ' + String(body.lawyer_name).trim()
      : '');
  if (!summary) return json({ ok: false, decision: '', rest: '' }, request, env);

  const systemPrompt =
    'אתה עוזר משפטי במשרד עורך הדין ' +
    lawyerName +
    '. קיבלת סיכום של החלטה/פרוטוקול מבית משפט/בית דין. הפרד בבירור בין ההחלטה/ההוראה האופרטיבית של בית המשפט לבין שאר תוכן המסמך (רקע, עובדות, נימוקים, מהלך הדיון).\n\n' +
    (clientName
      ? 'לקוח המשרד בתיק זה — הצד שאנו מייצגים — הוא: ' +
        clientName +
        '. זהו הצד המיוצג על ידי עורך הדין הנ"ל; הצד שכנגד אינו מיוצג על ידינו. זהה לפי השמות בהחלטה מי מבין הצדדים (התובע או הנתבע) הוא לקוח המשרד הזה, והתייחס אל "אנחנו/אותנו" ככוונה ללקוח זה בלבד.\n\n'
      : '') +
    'כלל חילוץ המשימה (task_title) — הקפד עליו בדייקנות:\n' +
    '• צור משימה אך ורק כאשר ההחלטה מחייבת אותנו — כלומר את לקוח המשרד' +
    (clientName ? ' (' + clientName + ')' : '') +
    '/עורך הדין הנ"ל — לבצע פעולה דיונית של תגובה: "להגיב על", "להשיב ל-", "לנמק את", להגיש תגובה/תשובה/הבהרה/התייחסות/כתב טענות — בדרך כלל בתוך מועד.\n' +
    '• אל תיצור משימה עבור חיוב כספי (תשלום סכום, הוצאות, מזונות) — חיוב כספי אינו משימה; השאר task_title ריק.\n' +
    '• אל תיצור משימה כאשר החובה/הפעולה מוטלת על הצד שכנגד (הצד שאיננו מייצגים) ולא על לקוח המשרד, או כאשר ההחלטה היא קביעה/הכרעה בלבד שאינה דורשת מלקוח המשרד פעולת תגובה דיונית; השאר task_title ריק. המשימה שתיווצר חייבת להיות הפעולה המוטלת על הצד שאנו מייצגים בלבד.\n\n' +
    'שדה hearing_date מיועד אך ורק למועד של דיון/ישיבה בבית המשפט שעל הצדדים להתייצב אליו, שנקבע במפורש בהחלטה (למשל "נקבע דיון ל...", "הישיבה הבאה תתקיים ביום...", "الجلسة القادمة بتاريخ..."). מועד אחרון להגיש/להגשת תגובה/תשובה/כתב טענות/מסמך — הוא מועד יעד למשימה בלבד (task_due_date), ולעולם אינו hearing_date; במקרה כזה חלץ את התאריך אל task_due_date והשאר hearing_date ריק. לעולם אל תכניס מועד הגשה/תגובה לשדה hearing_date. אל תמציא תוכן, תאריכים או שעות שאינם בסיכום. החזר אובייקט JSON אחד בלבד, ללא טקסט נוסף, ותו ראשון {.';
  const userText =
    'סיכום המסמך:\n' +
    summary +
    '\n\n' +
    (langSent === 'ar'
      ? 'اكتب قيم الحقول decision و rest و task_title باللغة العربية فقط.\n\n' +
        AR_GLOSSARY +
        '\n\n'
      : langSent === 'he'
        ? 'כתוב את הערכים בשדות decision, rest, task_title בעברית בלבד. '
        : 'כתוב את הערכים בשדות decision, rest ו-task_title באותה שפה שבה כתוב הסיכום שקיבלת — אל תתרגם לשפה אחרת. ') +
    'החזר JSON: {"decision":"ההחלטה/ההוראה האופרטיבית של בית המשפט בלשון תמציתית; אם אין החלטה אופרטיבית ברורה השאר מחרוזת ריקה","rest":"שאר תוכן המסמך (רקע/עובדות/נימוקים/מהלך הדיון) בתמצית","task_title":"רק אם ההחלטה מחייבת אותנו בפעולת תגובה דיונית (להגיב/להשיב/לנמק/להגיש תגובה) — נסח את הפעולה שעלינו לבצע; אחרת (כולל חיוב כספי או חובה על הצד שכנגד) השאר ריק","task_due_date":"תאריך היעד לביצוע המשימה בפורמט YYYY-MM-DD אם מצוין, אחרת ריק","hearing_date":"תאריך מועד דיון/ישיבה בבית המשפט שעל הצדדים להתייצב אליו, בפורמט YYYY-MM-DD, אך ורק אם ההחלטה קובעת דיון כזה במפורש; מועד אחרון להגשת תגובה/תשובה/מסמך אינו דיון — הוא task_due_date בלבד, ובמקרה כזה השאר ריק","hearing_time":"שעת הדיון בפורמט HH:MM אם צוינה, אחרת ריק"}.';

  let decision = '';
  let rest = '';
  let taskTitle = '';
  let taskDueDate = '';
  let hearingDate = '';
  let hearingTime = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const textOut = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');
      const cleaned = textOut
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      decision = String(parsed.decision ?? '').trim();
      rest = String(parsed.rest ?? '').trim();
      taskTitle = String(parsed.task_title ?? '').trim();
      taskDueDate = String(parsed.task_due_date ?? '').trim();
      hearingDate = String(parsed.hearing_date ?? '').trim();
      hearingTime = String(parsed.hearing_time ?? '').trim();
    }
  } catch {
    // fall through
  }
  // Never lose the content: if the split failed, show everything as `rest`.
  if (!decision && !rest) rest = summary;

  return json(
    {
      ok: true,
      decision,
      rest,
      task_title: taskTitle,
      task_due_date: taskDueDate,
      hearing_date: hearingDate,
      hearing_time: hearingTime,
    },
    request,
    env,
  );
}

// ---------------------------------------------------------------------------
// POST /api/translate
// Translate a short piece of text into a target language (default Arabic).
// Used by the case-brain so the "משימה שנוצרה" box reads ONLY in Arabic for the
// Sharia / Christian / Druze courts even when the underlying task text (stored
// task title or D1 decision description) was written in Hebrew.
// ---------------------------------------------------------------------------
async function handleTranslate(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const text = String(body.text ?? '').trim();
  const target = String(body.target ?? 'ar').trim().toLowerCase();
  if (!text) return json({ ok: true, text: '' }, request, env);
  const targetName =
    target === 'he' ? 'העברית' : target === 'en' ? 'English' : 'العربية';
  let out = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system:
          'You are a professional legal translator. Translate the user text into ' +
          targetName +
          ' only. Preserve legal meaning, names, numbers and dates exactly. Output ONLY the translation — no quotes, no notes, no transliteration, nothing else.' +
          (target === 'he' || target === 'en' ? '' : '\n\n' + AR_GLOSSARY),
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      out = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('')
        .trim();
    }
  } catch {
    out = '';
  }
  // On any failure return the original text so the caller never shows a blank.
  return json({ ok: true, text: out || text }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/suggested-actions/:case_id
// ---------------------------------------------------------------------------
async function handleGetSuggestedActions(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const caseId = url.pathname.replace('/api/suggested-actions/', '').trim();
  if (!caseId) {
    return json({ error: 'case_id required' }, request, env, 400);
  }
  const rs = await ctx.db.prepare(
    `SELECT * FROM case_suggested_actions
     WHERE case_id = ?
     ORDER BY created_at DESC`,
  )
    .bind(caseId)
    .all();
  return json({ case_id: caseId, suggestions: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/photo/<key>
// ---------------------------------------------------------------------------
// -----------------------------------------------------------------------
// GET /api/document?path=<relative_path>
// Stream a filing document from the office's Dropbox so a device that never
// connected Dropbox itself (a client opening the portal bot on their phone) can
// still download it. The office connected Dropbox once; its refresh token lives
// here as a Worker secret. Requires the shared APP_TOKEN like every authed
// endpoint, and echoes CORS headers because the browser fetches it with an
// Authorization header (a CORS request, unlike an <img> tag).
// -----------------------------------------------------------------------

// Short-lived Dropbox access token, cached across requests in the same isolate
// so we don't re-exchange the refresh token on every download.
let dropboxTokenCache: { token: string; expiresAt: number } | null = null;

async function getDropboxAccessToken(env: Env): Promise<string | null> {
  if (!env.DROPBOX_REFRESH_TOKEN || !env.DROPBOX_APP_KEY) return null;
  const now = Date.now();
  if (dropboxTokenCache && now < dropboxTokenCache.expiresAt) {
    return dropboxTokenCache.token;
  }
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', env.DROPBOX_REFRESH_TOKEN);
  body.set('client_id', env.DROPBOX_APP_KEY);
  try {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      console.warn('[worker dropbox] token refresh failed', res.status);
      return null;
    }
    const jsonBody = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    dropboxTokenCache = {
      token: jsonBody.access_token,
      expiresAt: now + (jsonBody.expires_in - 60) * 1000,
    };
    return jsonBody.access_token;
  } catch (e) {
    console.warn('[worker dropbox] token refresh error', e);
    return null;
  }
}

// Mirror the browser's dropboxPathForRelative: nest a filing relative_path under
// the office's connected base folder, guarding the doubled-"Clients" case, and
// return a leading-slash Dropbox API path.
function dropboxApiPath(relativePath: string, base: string): string {
  const raw = (relativePath || '').replace(/\/{2,}/g, '/');
  let b = (base || '').replace(/\/+$/, '');
  b = b.replace(/\/Clients$/i, '');
  let full: string;
  if (b && raw.toLowerCase().startsWith(b.toLowerCase() + '/')) {
    full = raw;
  } else {
    full = `${b}/${raw.replace(/^\/+/, '')}`;
  }
  full = full.replace(/\/{2,}/g, '/');
  return full.startsWith('/') ? full : '/' + full;
}

// Dropbox-API-Arg must be Latin-1 safe — escape non-ASCII (Hebrew/Arabic
// filenames) as \uXXXX so the fetch doesn't throw on the header value.
function dropboxApiArgHeader(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

function mimeFromExt(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

async function handleDocument(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const relativePath = (url.searchParams.get('path') || '').trim();
  if (!relativePath) {
    return json({ error: 'missing_path' }, request, env, 400);
  }

  // Per-office R2 storage (every office except the operator's Dropbox-backed one).
  if (!usesDropbox(env, ctx)) {
    const obj = await env.DOCS.get(docKey(ctx, relativePath));
    if (!obj) {
      return json({ error: 'document_unavailable' }, request, env, 404);
    }
    const fileName = relativePath.split('/').filter(Boolean).pop() || 'document';
    const headers = new Headers(corsHeaders(request, env));
    obj.writeHttpMetadata(headers);
    if (!headers.get('Content-Type')) {
      headers.set('Content-Type', mimeFromExt(fileName));
    }
    headers.set('Cache-Control', 'private, max-age=3600');
    return new Response(obj.body, { status: 200, headers });
  }

  const token = await getDropboxAccessToken(env);
  if (!token) {
    // The office hasn't provisioned server-side Dropbox credentials yet.
    return json({ error: 'dropbox_not_configured' }, request, env, 500);
  }
  const apiPath = dropboxApiPath(relativePath, env.DROPBOX_BASE_FOLDER || '');
  let dbxRes: Response;
  try {
    dbxRes = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Dropbox-API-Arg': dropboxApiArgHeader({ path: apiPath }),
      },
    });
  } catch (e) {
    console.warn('[worker dropbox] download error', e);
    return json({ error: 'dropbox_unreachable' }, request, env, 502);
  }
  if (!dbxRes.ok || !dbxRes.body) {
    const detail = (await dbxRes.text().catch(() => '')).slice(0, 300);
    console.warn('[worker dropbox] download failed', dbxRes.status, detail);
    // 409 = path not found → surface as 404 so the client can say "unavailable".
    return json(
      { error: 'document_unavailable', detail },
      request,
      env,
      dbxRes.status === 409 ? 404 : 502,
    );
  }
  const fileName = relativePath.split('/').filter(Boolean).pop() || 'document';
  const headers = new Headers(corsHeaders(request, env));
  headers.set('Content-Type', mimeFromExt(fileName));
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(dbxRes.body, { status: 200, headers });
}

// -----------------------------------------------------------------------
// POST /api/document   (multipart form: file, path)
// Upload a filing document into the OFFICE'S Dropbox using the same server-side
// credentials the download proxy uses. This is what lets a REMOTE device (a
// phone/laptop that never connected Dropbox of its own) land a file in the exact
// canonical folder make.com scans and that GET /api/document later reads back —
// instead of the device's own, possibly-different Dropbox account/folder.
//   `path` — the filing-RELATIVE path the client built ("Clients/<clt>/<case>/
//            <file>"). We nest it under DROPBOX_BASE_FOLDER, mirroring downloads.
// Returns { ok, path } where `path` is the filing-relative path to store on the
// document record (derived from Dropbox's ACTUAL final path, so an autorename is
// reflected). The office desktop keeps writing to its local synced folder.
// -----------------------------------------------------------------------
async function handleUploadDocument(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'expected multipart/form-data' }, request, env, 400);
  }
  const entry = form.get('file');
  const relPath = String(form.get('path') || '').trim();
  if (!entry || typeof entry === 'string') {
    return json({ error: 'no file' }, request, env, 400);
  }
  if (!relPath) {
    return json({ error: 'missing_path' }, request, env, 400);
  }
  const file = entry as unknown as { arrayBuffer(): Promise<ArrayBuffer> };

  // Per-office R2 storage (every office except the operator's Dropbox-backed one).
  if (!usesDropbox(env, ctx)) {
    const rel = relPath.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
    const fileName = rel.split('/').filter(Boolean).pop() || 'document';
    await env.DOCS.put(docKey(ctx, rel), await file.arrayBuffer(), {
      httpMetadata: { contentType: mimeFromExt(fileName) },
    });
    // Queue the automatic processing (summary + reply draft) — what make.com
    // does for the operator. Ids come from the form, else the filing name.
    if (/\.pdf$/i.test(fileName) && env.DOC_QUEUE) {
      const fromName = idsFromFileName(fileName);
      const field = (k: string) => String(form.get(k) || '').trim();
      const job: DocJob = {
        tenantId: ctx.tenantId,
        key: docKey(ctx, rel),
        fileName,
        docId: (field('docId') || fromName.docId).toUpperCase(),
        caseId: field('caseId') || fromName.caseId,
        clientId: field('clientId') || fromName.clientId,
        stage: 'process',
        attempt: 0,
      };
      if (job.docId) {
        try {
          await env.DOC_QUEUE.send(job);
        } catch (e) {
          console.warn('[upload] could not queue document processing', e);
        }
      }
    }
    // R2 keys are exact (no autorename); the client's _DOC-NNN suffix already
    // makes names unique, so store the same filing-relative path on the record.
    return json({ ok: true, path: rel }, request, env);
  }

  const token = await getDropboxAccessToken(env);
  if (!token) {
    // The office hasn't provisioned server-side Dropbox credentials yet.
    return json({ error: 'dropbox_not_configured' }, request, env, 500);
  }
  const apiPath = dropboxApiPath(relPath, env.DROPBOX_BASE_FOLDER || '');
  let dbxRes: Response;
  try {
    dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/octet-stream',
        // add + autorename: the client's _DOC-NNN suffix already makes the name
        // unique; autorename is only a last-resort collision guard.
        'Dropbox-API-Arg': dropboxApiArgHeader({
          path: apiPath,
          mode: 'add',
          autorename: true,
          mute: true,
        }),
      },
      body: await file.arrayBuffer(),
    });
  } catch (e) {
    console.warn('[worker dropbox] upload error', e);
    return json({ error: 'dropbox_unreachable' }, request, env, 502);
  }
  if (!dbxRes.ok) {
    const detail = (await dbxRes.text().catch(() => '')).slice(0, 300);
    console.warn('[worker dropbox] upload failed', dbxRes.status, detail);
    return json({ error: 'upload_failed', detail }, request, env, 502);
  }
  const meta = (await dbxRes.json().catch(() => ({}))) as {
    path_display?: string;
    path_lower?: string;
  };
  // Store a filing-RELATIVE path ("Clients/…") so GET /api/document resolves it
  // via dropboxApiPath on any device. Derive it from Dropbox's actual final path
  // (autorename may have adjusted the filename), stripping the office base folder.
  const finalDisplay = meta.path_display || meta.path_lower || apiPath;
  const idx = finalDisplay.toLowerCase().indexOf('/clients/');
  const relativePath =
    idx >= 0 ? finalDisplay.slice(idx + 1) : finalDisplay.replace(/^\/+/, '');
  return json({ ok: true, path: relativePath }, request, env);
}

// -----------------------------------------------------------------------
// GET /api/document-link?path=<relative_path>
// Return a short-lived, PUBLIC direct download link for a filing document
// (Dropbox get_temporary_link → a dl.dropboxusercontent.com URL valid ~4h).
// Unlike streaming through /api/document, this link needs no Authorization
// header, so a third party (e.g. Meta's WhatsApp servers fetching an outgoing
// document attachment) can fetch the file directly. Called server-to-server by
// the app's /api/whatsapp/send route with the shared APP_TOKEN.
// -----------------------------------------------------------------------
async function handleDocumentLink(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const relativePath = (url.searchParams.get('path') || '').trim();
  if (!relativePath) {
    return json({ error: 'missing_path' }, request, env, 400);
  }

  // R2-backed offices have no public share link yet (this is used only by the
  // WhatsApp send flow, which is the operator office for now). Return null so
  // callers degrade gracefully instead of erroring.
  if (!usesDropbox(env, ctx)) {
    return json({ link: null }, request, env);
  }

  const token = await getDropboxAccessToken(env);
  if (!token) {
    return json({ error: 'dropbox_not_configured' }, request, env, 500);
  }
  const apiPath = dropboxApiPath(relativePath, env.DROPBOX_BASE_FOLDER || '');
  let dbxRes: Response;
  try {
    dbxRes = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: apiPath }),
    });
  } catch (e) {
    console.warn('[worker dropbox] temp-link error', e);
    return json({ error: 'dropbox_unreachable' }, request, env, 502);
  }
  if (!dbxRes.ok) {
    const detail = (await dbxRes.text().catch(() => '')).slice(0, 300);
    console.warn('[worker dropbox] temp-link failed', dbxRes.status, detail);
    // 409 = path not found → surface as 404.
    return json(
      { error: 'document_unavailable', detail },
      request,
      env,
      dbxRes.status === 409 ? 404 : 502,
    );
  }
  const data = (await dbxRes.json()) as { link?: string };
  return json({ link: data.link || null }, request, env);
}

async function servePhoto(env: Env, rawKey: string): Promise<Response> {
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    // A malformed percent-escape (e.g. "/api/photo/%") makes
    // decodeURIComponent throw URIError — treat it as not-found instead of
    // letting it bubble up to a bare 500.
    return new Response('not found', { status: 404 });
  }
  if (!key) return new Response('not found', { status: 404 });

  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file';
}

// Per-office document storage backend. The operator office (tenant #1) keeps
// using Dropbox — that's where its existing files live and what make.com scans.
// EVERY OTHER office stores its filing documents in its own isolated R2 space.
function usesDropbox(env: Env, ctx: Ctx): boolean {
  return ctx.tenantId === env.USER_ID && !!env.DROPBOX_REFRESH_TOKEN;
}

// R2 object key for a filing document, namespaced per office (mirrors how client
// photos are keyed at `${tenantId}/client-photos/...`).
function docKey(ctx: Ctx, relativePath: string): string {
  const rel = (relativePath || '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  return `${ctx.tenantId}/documents/${rel}`;
}
// -----------------------------------------------------------------------
// POST /api/whatsapp-messages
// -----------------------------------------------------------------------
async function handleSaveWhatsAppMessage(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  let body: {
    client_phone: string;
    direction: string;
    message_text: string;
    timestamp: number;
    message_type?: string;
    media_url?: string;
    media_mime_type?: string;
    media_id?: string;
    file_name?: string;
  };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'invalid_json' }, request, env, 400);
  }
  if (!body || !body.client_phone) {
    return json({ error: 'missing client_phone' }, request, env, 400);
  }
  try {
    await ctx.db.prepare(
      'INSERT INTO whatsapp_messages (client_phone, direction, message_text, timestamp, message_type, media_url, media_mime_type, media_id, file_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)'
    ).bind(
      body.client_phone,
      body.direction,
      body.message_text || '',
      body.timestamp,
      body.message_type || 'text',
      body.media_url || null,
      body.media_mime_type || null,
      body.media_id || null,
      body.file_name || null
    ).run();
  } catch (e) {
    console.error('[worker] failed to save whatsapp message', e);
    return json({ error: 'db_error' }, request, env, 500);
  }
  return json({ ok: true }, request, env);
}

// -----------------------------------------------------------------------
// GET /api/whatsapp-messages/:phone
// -----------------------------------------------------------------------
// POST /api/whatsapp-transcribe — speech-to-text for an incoming voice message.
// The webhook (which holds Meta's token) downloads the recording and sends it
// here; Workers AI Whisper transcribes it inside Cloudflare, and the stored
// message's "[הודעה קולית]" placeholder becomes "🎤 <transcript>". The
// recording itself stays reachable through its media id.
const VOICE_MAX_BASE64 = 25 * 1024 * 1024;
async function handleWhatsAppTranscribe(
  request: Request,
  env: Env,
  ctx: Ctx,
): Promise<Response> {
  if (!env.AI) return json({ error: 'ai_not_configured' }, request, env, 500);
  const body = (await request.json().catch(() => ({}))) as {
    media_id?: string;
    audio_base64?: string;
  };
  const mediaId = String(body.media_id || '');
  const audio = typeof body.audio_base64 === 'string' ? body.audio_base64 : '';
  if (!/^\d+$/.test(mediaId) || !audio) {
    return json({ error: 'media_id and audio_base64 required' }, request, env, 400);
  }
  if (audio.length > VOICE_MAX_BASE64) {
    return json({ error: 'audio_too_large' }, request, env, 413);
  }
  let text = '';
  try {
    const out = (await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio,
      task: 'transcribe',
      // Skip silence first — fewer invented words on a quiet clip.
      vad_filter: true,
    })) as { text?: string };
    text = String(out?.text || '').trim();
  } catch (e) {
    return json(
      { error: 'transcription_failed', detail: String(e).slice(0, 300) },
      request,
      env,
      502,
    );
  }
  const stored = text ? '🎤 ' + text : '🎤 [הודעה קולית — לא זוהה דיבור]';
  await ctx.db.prepare(
    "UPDATE whatsapp_messages SET message_text = ?1 WHERE media_id = ?2 AND message_type = 'audio'",
  )
    .bind(stored, mediaId)
    .run();
  return json({ ok: true, text }, request, env);
}

// GET /api/whatsapp-summary — one row per phone for the WhatsApp hub list:
// the last message time, and how many incoming messages arrived after the
// office's last reply ("unanswered"), so clients still waiting come first.
// When the office last opened each client's chat screen (the latest message
// timestamp it had then) — incoming messages up to it count as read.
const WA_SEEN_DDL =
  'CREATE TABLE IF NOT EXISTS whatsapp_seen (client_phone TEXT PRIMARY KEY, seen_ts INTEGER NOT NULL)';

async function handleWhatsAppSummary(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  try {
    await ctx.db.prepare(WA_SEEN_DDL).run();
    // `unseen`: incoming messages after both the office's last reply AND the
    // last time the chat was opened — the home card's bell counts these.
    const rs = await ctx.db.prepare(
      `SELECT w.client_phone AS phone,
              MAX(w.timestamp) AS last_ts,
              SUM(CASE WHEN w.direction = 'incoming'
                        AND w.timestamp > COALESCE(o.last_out, 0) THEN 1 ELSE 0 END) AS unanswered,
              SUM(CASE WHEN w.direction = 'incoming'
                        AND w.timestamp > COALESCE(o.last_out, 0)
                        AND w.timestamp > COALESCE(s.seen_ts, 0) THEN 1 ELSE 0 END) AS unseen,
              MAX(CASE WHEN w.direction = 'incoming'
                        AND w.timestamp > COALESCE(o.last_out, 0) THEN w.timestamp END) AS waiting_since
         FROM whatsapp_messages w
         LEFT JOIN (SELECT client_phone, MAX(timestamp) AS last_out
                      FROM whatsapp_messages
                     WHERE direction = 'outgoing'
                       -- the bot's automatic replies (portal invite, "number
                       -- not recognised") are not an answer from the office
                       AND COALESCE(message_text, '') NOT LIKE '%/portal?t=%'
                       AND COALESCE(message_text, '') NOT LIKE '%/portal?phone=%'
                       AND COALESCE(message_text, '') NOT LIKE '%אינו מזוהה כלקוח במערכת%'
                     GROUP BY client_phone) o ON o.client_phone = w.client_phone
         LEFT JOIN whatsapp_seen s ON s.client_phone = w.client_phone
        GROUP BY w.client_phone`,
    ).all();
    return json({ phones: rs.results ?? [] }, request, env);
  } catch {
    // An office DB without the WhatsApp table (tenants don't use WhatsApp).
    return json({ phones: [] }, request, env);
  }
}

async function handleGetWhatsAppMessages(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const phone = url.pathname.split('/').pop() ?? '';
  const rs = await ctx.db.prepare(
    'SELECT * FROM whatsapp_messages WHERE client_phone = ?1 ORDER BY timestamp ASC'
  ).bind(phone).all<Record<string, unknown>>();
  const messages = rs.results ?? [];
  // `?seen=1` — the chat screen is open on this client: everything up to the
  // newest stored message is now read. (The webhook / send routes read this
  // endpoint too, without the flag, so they never mark anything.)
  if (url.searchParams.get('seen') === '1' && messages.length) {
    try {
      await ctx.db.prepare(WA_SEEN_DDL).run();
      await ctx.db
        .prepare(
          `INSERT INTO whatsapp_seen (client_phone, seen_ts)
             SELECT ?1, MAX(timestamp) FROM whatsapp_messages WHERE client_phone = ?1
           ON CONFLICT(client_phone) DO UPDATE SET seen_ts = MAX(seen_ts, excluded.seen_ts)`,
        )
        .bind(phone)
        .run();
    } catch {
      /* read marker only — never fail the chat */
    }
  }
  // An office connected here gets signed links for its media (its token lives
  // in the Worker); the operator's legacy media keep using the app's proxy.
  if (await configForTenant(env, ctx.tenantId)) {
    for (const m of messages) {
      if (m.media_id && !m.media_url) {
        m.signed_media_url = await signedMediaUrl(env, url.origin, ctx.tenantId, String(m.media_id));
      }
    }
  }
  return json({ messages }, request, env);
}