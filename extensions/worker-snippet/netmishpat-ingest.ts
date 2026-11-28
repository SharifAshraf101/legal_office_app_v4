// ===== הוספה ל-Worker ‏legal-office-api-v4 =====
// 1) סכמת D1 – הרץ פעם אחת:
//    wrangler d1 execute <DB_NAME> --remote --config wrangler.v4.toml --file=netmishpat.sql
// 2) טוקן נפרד לתוסף (לא APP_TOKEN):
//    wrangler secret put NM_BRIDGE_TOKEN --config wrangler.v4.toml
// 3) חבר את handleNetMishpat ל-router שלך (ראה למטה).

export interface Env {
  DB: D1Database;
  NM_BRIDGE_TOKEN: string;
}

type Snapshot = {
  source: string;
  url: string;
  title: string;
  capturedAt: string;
  caseNumbers: { number: string; type: string | null }[];
  tables: { index: number; headers: string[]; rows: Record<string, unknown>[] }[];
  docLinks: { text: string; href: string }[];
  text: string;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...cors } });

// השוואה בזמן קבוע של הטוקן
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function handleNetMishpat(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname !== "/api/netmishpat/ingest") return null;
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!env.NM_BRIDGE_TOKEN || !safeEqual(token, env.NM_BRIDGE_TOKEN)) return json({ error: "unauthorized" }, 401);

  const snap = (await req.json()) as Snapshot;
  // רק אתרי ממשלה (נט המשפט / נט בתי הדין השרעיים)
  let host = "";
  try { host = new URL(snap.url).hostname; } catch (_) {}
  if (!snap || !/\.gov\.il$/.test(host)) return json({ error: "bad source" }, 400);
  const source = snap.source === "net-batei-hadin" ? "net-batei-hadin" : "net-hamishpat";

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];

  // צילום גולמי – תמיד נשמר, כדי שלא יאבד מידע גם אם מבנה העמוד משתנה
  stmts.push(
    env.DB.prepare(
      `INSERT INTO nm_snapshots (source, url, title, captured_at, case_numbers, tables_json, doc_links_json, text_content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      source, snap.url, snap.title, snap.capturedAt,
      JSON.stringify(snap.caseNumbers), JSON.stringify(snap.tables),
      JSON.stringify(snap.docLinks), snap.text.slice(0, 200000), now
    )
  );

  // תיקים – upsert לפי מספר תיק
  for (const c of snap.caseNumbers) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO nm_cases (case_number, case_type, source, last_seen_url, last_seen_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(case_number) DO UPDATE SET
           case_type = COALESCE(excluded.case_type, nm_cases.case_type),
           last_seen_url = excluded.last_seen_url,
           last_seen_at = excluded.last_seen_at`
      ).bind(c.number, c.type, source, snap.url, now)
    );
  }

  // מסמכים/החלטות – לפי קישור (ייחודי)
  for (const d of snap.docLinks) {
    const caseNo = (d.text.match(/\d{3,6}-\d{2}-\d{2}|\d{3,6}\/\d{4}/) || snap.caseNumbers.map((c) => [c.number])[0] || [null])[0];
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO nm_documents (href, title, case_number, source, first_seen_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(d.href, d.text, caseNo, source, now)
    );
  }

  await env.DB.batch(stmts);
  return json({ ok: true, summary: `${source === "net-batei-hadin" ? "שרעי" : "נט המשפט"}: ${snap.caseNumbers.length} תיקים, ${snap.docLinks.length} מסמכים` });
}

// דוגמה לחיבור ב-fetch הראשי:
// export default {
//   async fetch(req: Request, env: Env) {
//     const nm = await handleNetMishpat(req, env);
//     if (nm) return nm;
//     ...שאר הנתיבים הקיימים
//   },
// };
