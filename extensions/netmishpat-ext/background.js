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

async function tellTab(tabId, text, ok) {
  if (tabId == null) return;
  try { await chrome.tabs.sendMessage(tabId, { type: "NM_TOAST", text, ok }); } catch (_) {}
}

chrome.downloads.onCreated.addListener(async (item) => {
  const fileUrl = item.finalUrl || item.url || "";
  const m = COURT_FILE_RE.exec(fileUrl);
  if (!m) return;
  // ההורדה מתחילה מהלשונית הפעילה – חלון הצפייה שבו נלחץ "שמירה"
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabId = tab ? tab.id : null;
  try {
    const { endpoint, token } = await getConfig();
    if (!endpoint || !token) return;
    const click = tabId != null ? (await sessionGet("viewers"))[tabId] : null;

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
    await tellTab(tabId, body.linked ? "המסמך נשמר במערכת המשרד ✓" : "המסמך נשמר במערכת המשרד ✓ (ללא שיוך לתיק)", true);
  } catch (e) {
    await tellTab(tabId, "שמירת המסמך במערכת המשרד נכשלה: " + (e && e.message ? e.message : e), false);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === "NM_DOC_CLICK") {
    if (sender.tab && sender.tab.id != null) rememberClick(sender.tab.id, { href: msg.href, text: msg.text, context: msg.context });
    return;
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
