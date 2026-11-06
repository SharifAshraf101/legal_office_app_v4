# Hardening the archiving scenarios against large files

Why the make.com modules crash and the scenario "stops working", and the exact
changes that fix it. Grammar below follows the official Make Skills references
(`make-scenario-building` → `flow-control.md`, `error-handling.md`).

> **Status: APPLIED 2026-10-27** to all four scenarios via Make MCP. Size gate
> and a `builtin:Break` retry handler are live on each; `dlq` enabled on each.
> Outstanding: oversized files are skipped SILENTLY (no marker row written) —
> see §10. Model swap (§7) not applied.

---

## 1. Which scenarios are affected

Three scenarios, two different paths — and only one of them is protected by the
app-side guards added in `lib/pdfLimits.ts` / `worker/src/pdfLimits.ts`:

| Scenario | Path | Protected by the code fix? |
|---|---|---|
| Drafts | → Worker `POST /api/draft` | **Yes.** Size guard, retry and the removed string copies all apply. |
| Summaries (`files summary Handler … v4`) | → `api.anthropic.com/v1/messages` **directly**, `{{base64(40.data)}}` | **No.** Never touches our code. |
| Decisions | → `api.anthropic.com/v1/messages` **directly**, `{{base64(3.data)}}` | **No.** Never touches our code. |

The summaries and decisions scenarios base64-encode inside Make and POST
straight to Anthropic. That is where the failures are.

## 2. Root cause

A PDF base64-expands by 4/3. Anthropic caps a request at **32 MiB**
(33,554,432 bytes). So the largest raw PDF that can fit is ~23 MiB:

```
23 MiB  = 24,117,248 bytes raw
        → 4 × ceil(24117248 / 3) = 32,156,332 bytes of base64  (30.7 MiB)
        → 1.33 MiB of headroom for the prompt + JSON envelope   ✓
```

Anything larger fails at the model with an opaque 400 — after Make has already
spent the memory building the oversized string.

**Why it then stops working entirely.** Make stops a run on the first error and
**deactivates the scenario after repeated failures**. Worse, per the official
error-handling reference:

> A webhook-triggered scenario with `maxErrors` set deactivates on the **first**
> error, not after N.

Both affected scenarios are webhook-triggered. So a single oversized file can
switch the whole scenario off, and nothing archives until someone re-enables it
by hand. That is the "modules crashed and stopped working" symptom, exactly.

---

## 3. Step 1 — gate on size before `base64()`

Put the decision *before* the encode, so Make never builds a 30 MiB string it
cannot use.

Use **`builtin:BasicIfElse`**, not a router: the two outcomes are mutually
exclusive (process it, or flag it). A router would run both arms.

```json
{ "id": 200, "module": "builtin:BasicIfElse", "version": 1, "follows": 40, "config": {} },

{ "id": 201, "module": "http:ActionSendData",
  "parent": { "moduleId": 200, "kind": "branch", "index": 0, "label": "Too large",
              "conditions": [[ { "a": "{{40.size}}",
                                 "o": "number:greaterorequal",
                                 "b": "24117248" } ]] },
  "config": { "…": "the marker write — see step 2" } },

{ "id": 202, "module": "http:ActionSendData",
  "parent": { "moduleId": 200, "kind": "branch", "index": 1, "label": "Normal size" },
  "config": { "…": "the existing Anthropic call, unchanged" } }
```

Three rules this obeys, from the flow-control reference:

- **The condition lives on the branch (`parent.conditions`), never as a `filter`
  on the branch's first module** — "the engine deletes it".
- **Arms are ordered most-specific first.** Index 0 is the oversized case; the
  last arm carries no `conditions` and is the catch-all `else`.
- **No `mergesTo`.** The arms do genuinely different things and never rejoin, so
  leaving it off is correct and no `BasicMerge` is needed.

## 4. Step 2 — flag the oversized file instead of losing it

The oversized arm writes a summary row saying so, which means the run *completes*
(no error, no deactivation) and the file shows up in the UI flagged rather than
silently missing.

`POST {{WORKER_URL}}/api/file-summary`, `Authorization: Bearer <APP_TOKEN>`:

```json
{
  "file_name":    "{{40.name}}",
  "client_id":    "",
  "case_id":      "",
  "language":     "he",
  "ai_model":     "skipped-too-large",
  "summary_he":   "המסמך גדול מדי לעיבוד אוטומטי. יש לפצל או לדחוס אותו ולהעלות מחדש.",
  "summary_ar":   "المستند كبير جداً للمعالجة التلقائية. يلزم تقسيمه أو ضغطه وإعادة تحميله.",
  "summary_orig": "המסמך גדול מדי לעיבוד אוטומטי. יש לפצל או לדחוס אותו ולהעלות מחדש."
}
```

Field names match what the Worker's `/api/file-summary` handler reads (see
`app/api/generate-summary/route.ts` step 3 for the same payload shape).

## 5. Step 3 — retry transient Anthropic failures

A 429 (rate limit) or 529 (overloaded) is not a permanent failure, but with no
handler it counts as an error and feeds the auto-deactivation. Attach an error
handler arm to each Anthropic HTTP module, ending in the `Break` directive:

```json
{ "id": 210, "module": "builtin:Break", "version": 1,
  "parent": { "moduleId": 29, "kind": "errorHandler" },
  "config": { "mapper": { "retry": true, "count": 3, "interval": 10 } } }
```

`interval` is in **minutes**. `Break` stores the run as an *incomplete
execution* and retries it later — the right directive for rate limits and
outages per the reference's directive table.

Two consequences to accept deliberately:

- **Incomplete executions need a human.** `Break` requires `dlq: true` in the
  scenario settings, and the stored runs must be retried or discarded in Make's
  UI. The MCP surface cannot clear them.
- **If the scenario is `sequential`, stored failures block the queue** — new
  data waits until the incomplete runs are resolved. Check
  `isWaitingOnIncompleteExecutions` in `scenario_get`. If these scenarios are
  sequential, prefer `count: 2, interval: 5` so a stuck run drains quickly.

Also worth checking while we are in the settings: `maxErrors`. Given the
webhook-trigger caveat above, confirm what it is currently set to.

## 6. Step 4 — the open architectural choice

Both affected scenarios duplicate the prompt and the Anthropic call that
`app/api/generate-summary/route.ts` already implements — which is why the code
fix missed them, and why the prompt has to be kept in sync by hand (a pitfall
their own doc already warns about).

| | Keep calling Anthropic directly | Repoint at `/api/generate-summary` |
|---|---|---|
| Size guard | Must be maintained in Make (steps 1–2 above) | Inherited from `lib/pdfLimits.ts` |
| Prompt | Duplicated in the Make module | One copy, in the repo |
| Retry | Make error handler | Inherited from the Worker helper |
| Blast radius of the change | Small, additive | Larger — rewires the scenario |
| Vercel timeout | Not in the path | Now in the path (`maxDuration = 60`) |

Direct calls are not wrong — they dodge the Vercel function timeout entirely,
which matters for big files. **Recommendation: do steps 1–3 now** (they fix the
outage and are additive), and treat step 4 as a separate decision once the
pipeline is stable.

## 7. Free win while editing

Both scenarios pin `claude-sonnet-4-6`. **`claude-sonnet-5` has the same 1M
context — so the same 600-page PDF ceiling — and costs less: $2/$10 per MTok
against $3/$15.** The decisions scenario uses forced tool use
(`tool_choice: {type: "tool", name: "record_decision"}`), which Sonnet 5 still
supports, so the swap is safe for both.

Note for later: forced tool use **is** rejected by Claude Fable 5.1 / Mythos 5.1.
If either scenario is ever moved to that tier, `tool_choice` must become `auto`
with the tool named in the prompt, or switch to structured outputs.

---

## 8. Applying it by hand in the Make UI (no MCP needed)

MCP is only a more convenient editor — every change below is doable in the UI,
and this is the fastest route to stopping the outage. Do it on the **summaries**
scenario first (`webhook trigger - Legal AI - files summary Handler (Dropbox +
Cloudflare) - v4`), then repeat on the decisions scenario.

The threshold everywhere is **`24117248`** (23 MiB in bytes).

### A. Gate the existing `pdf` route on size — stops the crash

The scenario already has a Router after the Text parser, with a `pdf` route. Add
the size condition to that route's existing filter rather than building an
if-else: a Make Router runs *every* route whose filter matches, so two
mutually-exclusive size filters give exactly the behavior we want with the
smallest possible edit.

1. Open the scenario → click the **filter icon** on the `pdf` route.
2. Keep the existing file-type condition and **AND** a second one:
   - Left: the Dropbox module's **File Size** field (`{{40.fileSize}}`)
   - Operator: **Numeric → less than**
   - Right: `24117248`
3. Save.

Oversized files now skip the Anthropic call instead of failing the run. The
scenario stops erroring, so it stops auto-deactivating.

> **Field name confirmed via `module_spec`.** `dropbox:getFile` (v5) outputs
> `data`, `fileName` and **`fileSize`** — a number, in bytes. The mapping is
> therefore `{{40.fileSize}}`, NOT `{{40.size}}`: a wrong field name resolves to
> empty and the filter would never match, silently doing nothing.

### B. Add a "too large" route — so the file is flagged, not lost

Step A alone makes oversized files vanish silently. Add a second route so they
surface in the app:

1. On the same Router, **add a route**.
2. Filter on it: same file-type condition **AND** Dropbox **Size** → **Numeric →
   greater than or equal to** → `24117248`.
3. Add one module: **HTTP → Make a request**
   - URL: `https://legal-office-api-v4.sharifashraf.workers.dev/api/file-summary`
   - Method: `POST`
   - Headers: `Authorization: Bearer <APP_TOKEN>`, `Content-Type: application/json`
   - Body type: **Raw**, content type **JSON**, body = the payload in §4 above.

### C. Retry transient Anthropic failures

1. **Right-click the Anthropic HTTP module** → **Add error handler**.
2. Pick the **Break** directive.
3. Set **Retry** on, **count 3**, **interval 10** (minutes). If the scenario is
   sequential, use count 2 / interval 5 so a stuck run drains faster.
4. Scenario **Settings** → enable **Allow storing incomplete executions**.

### D. Check the auto-deactivation setting

Scenario **Settings** → find the consecutive-errors / `maxErrors` value. Because
both scenarios are **webhook-triggered**, a set `maxErrors` deactivates them on
the *first* error, not after N. This is what turns one oversized PDF into a dead
pipeline.

### E. Model swap (optional, saves money)

In each Anthropic HTTP module's request body, change
`"model": "claude-sonnet-4-6"` → `"model": "claude-sonnet-5"`. Same 1M context
and 600-page ceiling, $2/$10 per MTok instead of $3/$15.

### F. Re-enable, in this order

Only **after** A–C are saved, re-activate the scenario. Re-enabling first just
means it switches off again on the next oversized file.

---

## 9. What has to be verified against the live blueprint

The module ids above (`40` = Dropbox Download, `29` = Anthropic HTTP in the
summaries scenario, `3` = Dropbox Download in the decisions scenario) come from
`make-com-summary-prompt.md` and `make-com-decisions-full-body.json`, not from
the live scenarios. Before patching:

1. `scenario_get` — real ids, `lastEdit`, `sequential`, `maxErrors`, `dlq`.
2. `module_spec` on the Dropbox download module — **confirm the size output
   field is `size`** and in bytes. If it is absent, gate on
   `{{length(base64(40.data))}}` against `32156332` instead, accepting that this
   builds the string before rejecting it.
3. One `scenario_patch` per scenario, with `expectedLastEdit`, carrying every
   operation for that scenario in a single call.

---

## 10. What was actually applied (2026-10-27)

| Scenario | id | Size gate | Retry handler | `dlq` |
|---|---|---|---|---|
| Summaries | 9458704 | router `24`: `{{40.fileSize}} < 24117248` | `41` → `Break` on `29` | on |
| Suggested legal action | 9458702 | module `4`: `{{3.fileSize}} < 24117248` | `9` → `Break` on `4` | on |
| Decisions | 9458700 | module `10`: `{{3.fileSize}} < 24117248` | `27` → `Break` on `10` | on |
| Drafts | 9458707 | router `24`: `{{2.fileSize}} < 24117248` | `44` on `29`, `45` on `42` | on |

All four are `active`. Every `Break` is `retry: true, count: 3, interval: 10` (minutes).

### Still open: oversized files vanish silently

A blocked filter stops the item with no error and no output, so an oversized PDF
now produces *nothing* — no `file_summary` row, no log, no trace in the app. The
scenario stays healthy, which was the goal, but the file is invisibly skipped.

The marker write in §4 cannot simply be bolted on where the gate currently sits:
in 9458704 and 9458707 the gate is on the **router itself**, so an oversized item
never reaches any route and no new route can catch it. Closing this needs one of:

- move the size condition off the router onto each route's first module, then add
  a third route filtered on `fileSize >= 24117248` carrying the marker POST; or
- insert `builtin:BasicIfElse` between the Dropbox download and the router.

Either is a structural edit to a now-working pipeline — worth doing deliberately,
not as a follow-on to the outage fix.

### Still open: two plaintext Anthropic API keys

`sk-ant-api03-…` live keys are stored as inline `x-api-key` header values in
scenario configs — one in 9458704 module `29`, a second (different key) shared by
9458702 module `4` and 9458700 module `10`. Anyone with access to the Make team,
or to a blueprint export, has the office's Anthropic billing. Rotate both at
console.anthropic.com and move them to a Make connection/keychain value.
