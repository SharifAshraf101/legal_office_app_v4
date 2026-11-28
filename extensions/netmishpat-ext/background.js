// גשר נט המשפט / נט בתי הדין – service worker
// מעביר את הנתונים ל-Worker של המערכת. הטוקן נשמר ב-chrome.storage.local בלבד (לא בקוד).

async function getConfig() {
  const { endpoint = "", token = "" } = await chrome.storage.local.get(["endpoint", "token"]);
  return { endpoint: endpoint.replace(/\/+$/, ""), token };
}

// ---- אתרים נוספים (נט בתי הדין השרעיים וכו') – רישום דינמי של ה-content script ----
const scriptId = (origin) => "site_" + origin.replace(/[^a-z0-9]/gi, "_");

async function registerSite(origin) {
  const id = scriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([
    {
      id,
      matches: [origin + "/*"],
      js: ["content.js"],
      css: ["content.css"],
      runAt: "document_idle",
      allFrames: true,
      persistAcrossSessions: true,
    },
  ]);
}

async function enableSite(origin, tabId) {
  const { extraSites = [] } = await chrome.storage.local.get("extraSites");
  if (!extraSites.includes(origin)) {
    extraSites.push(origin);
    await chrome.storage.local.set({ extraSites });
  }
  await registerSite(origin);
  if (tabId) {
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
  }
}

async function restoreSites() {
  const { extraSites = [] } = await chrome.storage.local.get("extraSites");
  for (const origin of extraSites) {
    if (await chrome.permissions.contains({ origins: [origin + "/*"] })) await registerSite(origin);
  }
}
chrome.runtime.onInstalled.addListener(restoreSites);
chrome.runtime.onStartup.addListener(restoreSites);

// ---- שליחה ל-Worker ----
async function push(payload) {
  const { endpoint, token } = await getConfig();
  if (!endpoint || !token) return { ok: false, error: "יש להגדיר כתובת Worker וטוקן בהגדרות התוסף" };

  const res = await fetch(`${endpoint}/api/netmishpat/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  let body = {};
  try { body = await res.json(); } catch (_) {}
  if (!res.ok) return { ok: false, error: body.error || `HTTP ${res.status}` };
  return { ok: true, summary: body.summary || `${payload.caseNumbers.length} תיקים, ${payload.tables.length} טבלאות` };
}

// ---- קובצי מסמכים: PDF שנשמר מחלון הצפייה של נט המשפט נשלח גם למערכת המשרד ----
// נט המשפט שומר מסמך מכתובת זמנית (10 דקות) במאגר הקבצים שלו. כשהורדה כזו מתחילה,
// התוסף מוריד את אותו קובץ ושולח אותו ל-Worker, יחד עם הקישור שנלחץ כדי לפתוח אותו.
const COURT_FILE_RE = /^https:\/\/ngcs[^/]*\.amazonaws\.com\/([^/?#]+\.pdf)(?:[?#]|$)/i;
const CLICK_TTL = 60 * 1000;          // מלחיצה על הקישור ועד שנפתח חלון הצפייה
const VIEWER_TTL = 6 * 60 * 60 * 1000; // כמה זמן חלון צפייה נשאר משויך להחלטה

async function sessionGet(key) {
  return (await chrome.storage.session.get(key))[key] || {};
}

// לחיצה על קישור מסמך בלשונית מסוימת
async function rememberClick(tabId, click) {
  const clicks = await sessionGet("clicks");
  clicks[tabId] = { ...click, at: Date.now() };
  await chrome.storage.session.set({ clicks });
}

// חלון הצפייה נפתח כלשונית חדשה מתוך הלשונית שבה נלחץ הקישור
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.openerTabId == null) return;
  const click = (await sessionGet("clicks"))[tab.openerTabId];
  if (!click || Date.now() - click.at > CLICK_TTL) return;
  const viewers = await sessionGet("viewers");
  for (const id of Object.keys(viewers)) if (Date.now() - viewers[id].at > VIEWER_TTL) delete viewers[id];
  viewers[tab.id] = { ...click, at: Date.now() };
  await chrome.storage.session.set({ viewers });
});

// ---- ייבוא אוטומטי: מעבר על כל המסמכים שבעמוד, אחד אחד ----
// המשתמש לוחץ "ייבוא כל המסמכים שבעמוד" ברשימה של נט המשפט. לכל מסמך שעדיין אין
// לו קובץ במערכת: לוחצים על הקישור שלו, חלון הצפייה נפתח, שם נלחץ כפתור השמירה,
// הקובץ נשלח למשרד (כמו בשמירה ידנית) והחלון נסגר. בקצב מתון, מסמך אחר מסמך.
// המצב נשמר ב-chrome.storage.session, כי העמוד נטען מחדש אחרי כל לחיצה; העמוד
// עצמו "מתקתק" (NM_AUTO_TICK) ומקבל בתשובה מה לעשות ומה להציג.
const AUTO_GAP = 3000;            // הפסקה בין מסמך למסמך
const AUTO_ITEM_TIMEOUT = 60000;  // כמה זמן מחכים למסמך אחד
const AUTO_MAX = 60;

let autoChain = Promise.resolve();
const autoLocked = (fn) => (autoChain = autoChain.then(fn, fn));
async function autoGet() { return (await chrome.storage.session.get("auto")).auto || null; }
async function autoSet(a) { await chrome.storage.session.set({ auto: a }); }

async function serverPending(hrefs, diag) {
  const { endpoint, token } = await getConfig();
  if (!endpoint || !token) throw new Error("יש להגדיר כתובת Worker וטוקן בהגדרות התוסף");
  const res = await fetch(`${endpoint}/api/netmishpat/pending`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ hrefs, diag }),
  });
  let body = {};
  try { body = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.pending || [];
}

async function autoStart(tabId, items, path) {
  const all = (items || []).slice(0, AUTO_MAX);
  const pending = new Set(await serverPending(all.map((i) => i.href)));
  const queue = all.filter((i) => pending.has(i.href));
  await autoSet({
    tabId, path: path || "", queue, i: 0, running: queue.length > 0, phase: "idle", nextAt: Date.now(),
    skipped: all.length - queue.length, filed: 0, saved: 0, failed: 0, note: "",
  });
  return { ok: true, total: queue.length, skipped: all.length - queue.length };
}

async function closeViewer(a) {
  if (a.viewerTabId != null && a.viewerTabId !== a.tabId) {
    try { await chrome.tabs.remove(a.viewerTabId); } catch (_) {}
  }
  a.viewerTabId = null;
}

// מסמך אחד הסתיים (הצליח או לא) – עוברים לבא
async function autoAdvance(a, outcome, note) {
  await closeViewer(a);
  a[outcome] = (a[outcome] || 0) + 1;
  if (note) a.note = note;
  a.i += 1;
  a.phase = "idle";
  a.nextAt = Date.now() + AUTO_GAP;
  if (a.i >= a.queue.length) a.running = false;
  await autoSet(a);
}

const autoView = (a) => a ? {
  running: !!a.running, i: a.i, total: a.queue.length, skipped: a.skipped,
  filed: a.filed, saved: a.saved, failed: a.failed, note: a.note || "",
} : { running: false };

// תקתוק מהעמוד של הרשימה
function autoTick(tabId, path) {
  return autoLocked(async () => {
    const a = await autoGet();
    if (!a || a.tabId !== tabId) return { running: false };
    if (!a.running) return autoView(a);
    // לחיצה על מסמך העבירה את הלשונית לעמוד אחר (למשל לעמוד התיק): הרשימה כבר לא
    // על המסך, ואין על מה ללחוץ. עוצרים, ולא מסמנים את שאר המסמכים כנכשלים.
    if (a.path && path && path !== a.path) {
      await closeViewer(a);
      a.running = false;
      a.failed += 1;
      a.note = "אחד המסמכים פתח עמוד אחר במקום חלון צפייה, והייבוא נעצר. חזור לרשימה ולחץ שוב על הייבוא – מה שכבר יובא ידולג";
      await autoSet(a);
      return autoView(a);
    }
    const now = Date.now();
    if (a.phase === "idle") {
      if (now < a.nextAt) return autoView(a);
      const item = a.queue[a.i];
      await rememberClick(tabId, { href: item.href, text: item.text, context: item.context });
      a.phase = "open"; a.startedAt = now; a.viewerTabId = null;
      await autoSet(a);
      // הלחיצה נעשית בתוך העמוד עצמו: קישור "פקודה" (javascript:) שנלחץ מתוך התוסף
      // נחסם על ידי Chrome ואינו עושה דבר.
      let clicked = false;
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          args: [item.href],
          func: (href) => {
            const link = [...document.querySelectorAll("a[href]")].find((x) => x.href === href);
            if (!link) return false;
            document.documentElement.removeAttribute("data-nm-blocked-open");
            link.click();
            return true;
          },
        });
        clicked = !!(r && r.result);
      } catch (_) {}
      if (!clicked) await autoAdvance(a, "failed", "קישור של מסמך לא נמצא בעמוד");
      return autoView(await autoGet());
    }
    if (now - a.startedAt > AUTO_ITEM_TIMEOUT) {
      const why = a.viewerTabId == null
        ? "חלון המסמך לא נפתח"
        : "הקובץ לא ירד – אם Chrome שואל על הורדת כמה קבצים, יש לאשר";
      await autoAdvance(a, "failed", why);
    }
    return autoView(await autoGet());
  });
}

chrome.tabs.onCreated.addListener((tab) => {
  autoLocked(async () => {
    const a = await autoGet();
    if (!a || !a.running || a.phase !== "open" || tab.openerTabId !== a.tabId) return;
    a.viewerTabId = tab.id;
    await autoSet(a);
  });
});

// האתר ניסה לפתוח את חלון המסמך ו-Chrome חסם אותו: התוסף פותח אותה כתובת כלשונית
function autoOpenBlocked(tabId, url) {
  return autoLocked(async () => {
    const a = await autoGet();
    if (!a || !a.running || a.phase !== "open" || a.tabId !== tabId || a.viewerTabId != null) return;
    let ok = false;
    try { const u = new URL(url); ok = /(^|\.)court\.gov\.il$/.test(u.hostname) && u.protocol === "https:"; } catch (_) {}
    if (!ok) return;
    const tab = await chrome.tabs.create({ url, openerTabId: tabId, active: true });
    a.viewerTabId = tab.id;
    await autoSet(a);
  });
}

// חלון הצפייה שואל אם הוא חלק מהייבוא האוטומטי
function autoIsViewer(tabId) {
  return autoLocked(async () => {
    const a = await autoGet();
    if (!a || !a.running || a.phase !== "open") return { auto: false };
    if (a.viewerTabId == null && tabId !== a.tabId) { a.viewerTabId = tabId; await autoSet(a); }
    return { auto: a.viewerTabId === tabId };
  });
}

// חלון הצפייה מדווח: נלחץ כפתור השמירה, או שלא נמצא כזה
function autoSaveReport(tabId, frameId, found, diag) {
  return autoLocked(async () => {
    const a = await autoGet();
    if (!a || !a.running || a.viewerTabId !== tabId) return;
    if (found) {
      // הלחיצה על כפתור השמירה – גם היא בתוך העמוד עצמו
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId || 0] },
          world: "MAIN",
          func: () => {
            const el = document.querySelector("[data-nm-save]");
            if (el) el.click();
          },
        });
      } catch (_) {}
    }
    if (!a.diagSent || !found) {
      a.diagSent = true;
      await autoSet(a);
      try { await serverPending([], String(diag || "").slice(0, 60000)); } catch (_) {}
    }
    if (found) return;
    // בלי כפתור שמירה אין טעם להמשיך לשאר המסמכים
    await closeViewer(a);
    a.running = false; a.failed += 1;
    a.note = "לא נמצא כפתור השמירה בחלון הצפייה – פרטי החלון נשלחו לבדיקה";
    await autoSet(a);
  });
}

// ההורדה של המסמך הנוכחי נשלחה (או נכשלה)
function autoFileDone(ok, status, error) {
  return autoLocked(async () => {
    const a = await autoGet();
    if (!a || !a.running || a.phase !== "open") return;
    if (!ok) return autoAdvance(a, "failed", "שליחה נכשלה: " + error);
    await autoAdvance(a, status === "filed" ? "filed" : "saved", "");
  });
}

async function tellTab(tabId, text, ok) {
  if (tabId == null) return;
  try { await chrome.tabs.sendMessage(tabId, { type: "NM_TOAST", text, ok }); } catch (_) {}
}

// שלוש ההורדות האחרונות שהתוסף ראה – לאבחון, מוצג בלחיצה על הכפתור שבחלון הצפייה
async function noteDownload(fileUrl, result) {
  let where = "";
  try { const u = new URL(fileUrl); where = u.protocol === "https:" ? u.hostname : u.protocol; } catch (_) {}
  const { seen = [] } = await chrome.storage.session.get("seen");
  seen.unshift({ where, result, at: Date.now() });
  await chrome.storage.session.set({ seen: seen.slice(0, 3) });
}

chrome.downloads.onCreated.addListener(async (item) => {
  const fileUrl = item.finalUrl || item.url || "";
  const m = COURT_FILE_RE.exec(fileUrl);
  if (!m) {
    await noteDownload(fileUrl, "לא קובץ של נט המשפט");
    // הורדה מאתר שהגשר הופעל בו ידנית (בתי הדין השרעיים): פרטי ההורדה נשלחים לבדיקה,
    // בלי ערכי הפרמטרים שבכתובת – רק כדי לדעת מאיפה ואיך הקובץ יורד שם.
    try {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const { extraSites = [] } = await chrome.storage.local.get("extraSites");
      const origin = active && active.url ? new URL(active.url).origin : "";
      if (origin && extraSites.includes(origin)) {
        const bare = (u) => {
          try {
            const x = new URL(u);
            return x.protocol === "blob:" || x.protocol === "data:"
              ? x.protocol
              : x.origin + x.pathname + (x.search ? "?" + [...x.searchParams.keys()].join("&") : "");
          } catch (_) { return ""; }
        };
        await serverPending([], "DOWNLOAD " + JSON.stringify({
          page: origin + new URL(active.url).pathname,
          url: bare(item.url), finalUrl: bare(item.finalUrl), referrer: bare(item.referrer),
          mime: item.mime, filename: String(item.filename || "").split(/[\\/]/).pop(),
        }));
      }
    } catch (_) {}
    return;
  }
  // ההורדה מתחילה מהלשונית הפעילה – חלון הצפייה שבו נלחץ "שמירה"
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let tabId = tab ? tab.id : null;
  // בייבוא אוטומטי: המסמך הנוכחי בתור הוא שנשמר עכשיו
  const run = await autoGet();
  const inAuto = !!(run && run.running && run.phase === "open");
  if (inAuto && run.viewerTabId != null) tabId = run.viewerTabId;
  try {
    const { endpoint, token } = await getConfig();
    if (!endpoint || !token) {
      await noteDownload(fileUrl, "חסרים כתובת או טוקן בהגדרות");
      return tellTab(tabId, "יש להגדיר כתובת Worker וטוקן בהגדרות התוסף", false);
    }
    const click = inAuto ? run.queue[run.i] : tabId != null ? (await sessionGet("viewers"))[tabId] : null;

    const file = await fetch(fileUrl);
    if (!file.ok) throw new Error(`הורדת הקובץ נכשלה (HTTP ${file.status})`);
    const blob = await file.blob();

    const q = new URLSearchParams({ name: decodeURIComponent(m[1]) });
    if (click) {
      q.set("href", click.href);
      q.set("text", click.text || "");
      q.set("context", click.context || "");
    }
    const res = await fetch(`${endpoint}/api/netmishpat/file?${q}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf", Authorization: `Bearer ${token}` },
      body: blob,
    });
    let body = {};
    try { body = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    // תיוק אוטומטי בתיק הלקוח – התשובה אומרת אם תויק, ואם לא – למה
    const f = body.filing || {};
    const st = String(f.status || "");
    let text = body.linked ? "המסמך נשמר במערכת המשרד ✓" : "המסמך נשמר במערכת המשרד ✓ (ללא שיוך לתיק)";
    if (st === "filed") text = `המסמך תויק בתיק ${f.caseId} (${f.docId}) ✓`;
    else if (st.startsWith("duplicate:")) text = `המסמך נשמר ✓ – לא תויק: נראה שכבר מתויק בתיק (${st.slice(10)}). אפשר לתייק ממסך "סנכרון נט"`;
    else if (st === "no_case") text = "המסמך נשמר ✓ – לא תויק: אין במערכת תיק עם מספר התיק הזה";
    else if (st === "ambiguous") text = "המסמך נשמר ✓ – לא תויק: יש במערכת יותר מתיק אחד עם מספר התיק הזה";
    else if (st.startsWith("error:")) text = "המסמך נשמר ✓ – התיוק בתיק נכשל, אפשר לנסות שוב ממסך \"סנכרון נט\"";
    await noteDownload(fileUrl, "נשלח: " + (st || "נשמר"));
    if (inAuto) return autoFileDone(true, st, "");
    await tellTab(tabId, text, true);
  } catch (e) {
    await noteDownload(fileUrl, "נכשל: " + (e && e.message ? e.message : e));
    if (inAuto) return autoFileDone(false, "", e && e.message ? e.message : String(e));
    await tellTab(tabId, "שמירת המסמך במערכת המשרד נכשלה: " + (e && e.message ? e.message : e), false);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === "NM_DOC_CLICK") {
    if (sender.tab && sender.tab.id != null) rememberClick(sender.tab.id, { href: msg.href, text: msg.text, context: msg.context });
    return;
  }
  const fromTab = sender.tab && sender.tab.id != null ? sender.tab.id : null;
  if (msg && msg.type === "NM_AUTO_START") {
    autoStart(fromTab, msg.items, msg.path).then(reply).catch((e) => reply({ ok: false, error: e && e.message ? e.message : String(e) }));
    return true;
  }
  if (msg && msg.type === "NM_AUTO_TICK") {
    autoTick(fromTab, msg.path).then(reply).catch(() => reply({ running: false }));
    return true;
  }
  if (msg && msg.type === "NM_AUTO_VIEWER") {
    autoIsViewer(fromTab).then(reply).catch(() => reply({ auto: false }));
    return true;
  }
  if (msg && msg.type === "NM_AUTO_SAVE") {
    autoSaveReport(fromTab, sender.frameId, !!msg.found, msg.diag).then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
  if (msg && msg.type === "NM_PENDING") {
    serverPending(msg.hrefs || []).then((pending) => reply({ ok: true, pending })).catch((e) => reply({ ok: false, error: e && e.message ? e.message : String(e) }));
    return true;
  }
  // קובץ שנבנה בתוך העמוד (בתי הדין השרעיים) – מגיע מה-content script ונשלח למשרד
  if (msg && msg.type === "NM_BLOB_FILE") {
    (async () => {
      const { endpoint, token } = await getConfig();
      if (!endpoint || !token) throw new Error("יש להגדיר כתובת Worker וטוקן בהגדרות התוסף");
      const bin = atob(msg.b64 || "");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const q = new URLSearchParams({
        name: msg.name, href: msg.href || "", text: msg.text || "", context: msg.context || "", source: "net-batei-hadin",
      });
      const res = await fetch(`${endpoint}/api/netmishpat/file?${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/pdf", Authorization: `Bearer ${token}` },
        body: bytes,
      });
      let body = {};
      try { body = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return { ok: true, filing: body.filing || {} };
    })().then(reply).catch((e) => reply({ ok: false, error: e && e.message ? e.message : String(e) }));
    return true;
  }
  if (msg && msg.type === "NM_PAGE_DIAG") {
    serverPending([], String(msg.diag || "").slice(0, 60000)).catch(() => {});
    return;
  }
  if (msg && msg.type === "NM_AUTO_OPEN") {
    autoOpenBlocked(fromTab, msg.url).then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
  if (msg && msg.type === "NM_AUTO_NOLINK") {
    autoLocked(async () => {
      const a = await autoGet();
      if (a && a.running && a.tabId === fromTab && a.phase === "open") await autoAdvance(a, "failed", "קישור של מסמך לא נמצא בעמוד");
    }).then(() => reply({ ok: true }));
    return true;
  }
  if (msg && msg.type === "NM_AUTO_STOP") {
    autoLocked(async () => {
      const a = await autoGet();
      if (!a) return;
      await closeViewer(a);
      a.running = false;
      a.note = "הייבוא נעצר";
      await autoSet(a);
    }).then(() => reply({ ok: true }));
    return true;
  }
  if (msg && msg.type === "NM_DIAG") {
    (async () => {
      const { endpoint, token } = await getConfig();
      const { seen = [] } = await chrome.storage.session.get("seen");
      reply({ version: chrome.runtime.getManifest().version, downloads: !!chrome.downloads, configured: !!(endpoint && token), seen });
    })().catch(() => reply(null));
    return true;
  }
  if (msg && msg.type === "NM_PUSH") {
    push(msg.payload).then(reply).catch((e) => reply({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "NM_ENABLE_SITE") {
    enableSite(msg.origin, msg.tabId).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) }));
    return true;
  }
});
