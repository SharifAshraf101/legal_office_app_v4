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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "NM_PUSH") {
    push(msg.payload).then(reply).catch((e) => reply({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === "NM_ENABLE_SITE") {
    enableSite(msg.origin, msg.tabId).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) }));
    return true;
  }
});
