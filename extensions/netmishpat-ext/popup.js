const $ = (id) => document.getElementById(id);
const status = (t, ok = true) => { $("status").textContent = t; $("status").style.color = ok ? "#2e7d32" : "#c62828"; };

$("opts").onclick = () => chrome.runtime.openOptionsPage();

let tab, origin, enabled = false;

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\//.test(tab.url || "")) { $("site").textContent = "עמוד לא נתמך"; return; }
  origin = new URL(tab.url).origin;
  $("site").textContent = origin;
  const isCourt = /\.court\.gov\.il$/.test(new URL(origin).hostname);
  const { extraSites = [] } = await chrome.storage.local.get("extraSites");
  enabled = isCourt || (extraSites.includes(origin) && (await chrome.permissions.contains({ origins: [origin + "/*"] })));
  $("enable").hidden = enabled;
})();

// הפעלה באתר נוסף – בקשת הרשאה לדומיין הזה בלבד (מחייבת לחיצה של המשתמש)
$("enable").onclick = async () => {
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (!granted) return status("ההרשאה לא אושרה", false);
  chrome.runtime.sendMessage({ type: "NM_ENABLE_SITE", origin, tabId: tab.id }, (res) => {
    if (res && res.ok) { enabled = true; $("enable").hidden = true; status("הגשר הופעל באתר זה ✓"); }
    else status("הפעלה נכשלה: " + ((res && res.error) || "לא ידוע"), false);
  });
};

$("send").onclick = async () => {
  if (!enabled) return status("יש להפעיל את הגשר באתר זה קודם", false);
  status("שולף נתונים…");
  chrome.tabs.sendMessage(tab.id, { type: "NM_SNAPSHOT" }, (snap) => {
    if (chrome.runtime.lastError || !snap) return status("לא ניתן לקרוא את העמוד – רענן ונסה שוב", false);
    chrome.runtime.sendMessage({ type: "NM_PUSH", payload: snap }, (res) => {
      res && res.ok ? status("נשלח ✓ " + (res.summary || "")) : status("נכשל: " + ((res && res.error) || "לא ידוע"), false);
    });
  });
};
