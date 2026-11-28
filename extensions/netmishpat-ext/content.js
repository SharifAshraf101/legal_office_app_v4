// גשר נט המשפט – content script
// רץ רק בעמודי court.gov.il שבהם המשתמש כבר מחובר (כרטיס חכם / הזדהות לאומית).
// אינו סורק אוטומטית: הוא שולף רק את מה שמוצג כרגע על המסך, ורק אחרי לחיצה.

(() => {
  if (window.__nmBridgeLoaded) return;
  window.__nmBridgeLoaded = true;

  // מקור: נט המשפט (court.gov.il) או נט בתי הדין השרעיים (כל אתר אחר שהופעל ידנית)
  const SOURCE = /court\.gov\.il$/.test(location.hostname) ? "net-hamishpat" : "net-batei-hadin";
  // מספר תיק בפורמט נט המשפט: 12345-06-26 (ייתכן עם קידומת סוג הליך: תמ"ש, תלה"מ, ת"ק ...)
  const CASE_RE = /(?:([א-ת"']{1,8})\s*)?(\d{3,6}-\d{2}-\d{2})/g;
  // פורמט נפוץ בבתי הדין השרעיים: 1234/2025 (לפחות 3 ספרות לפני הלוכסן, כדי לא לבלבל עם תאריך)
  const SHARIA_CASE_RE = /(?<![\d/.])(\d{3,6})\/(\d{4})(?![\d/])/g;
  const DATE_RE = /\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/;

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  function extractTables() {
    const out = [];
    document.querySelectorAll("table").forEach((tbl, ti) => {
      const rows = [...tbl.querySelectorAll("tr")];
      if (rows.length < 2) return;
      let headers = [...(tbl.querySelector("thead tr") || rows[0]).querySelectorAll("th,td")].map((c) => clean(c.innerText));
      const bodyRows = tbl.querySelector("thead") ? [...tbl.querySelectorAll("tbody tr")] : rows.slice(1);
      const data = bodyRows
        .map((tr) => {
          const cells = [...tr.querySelectorAll("td,th")];
          if (!cells.length) return null;
          const obj = {};
          cells.forEach((c, i) => {
            obj[headers[i] || `col${i}`] = clean(c.innerText);
          });
          const links = [...tr.querySelectorAll("a[href]")].map((a) => ({ text: clean(a.innerText), href: a.href }));
          if (links.length) obj.__links = links;
          return obj;
        })
        .filter((r) => r && Object.values(r).some((v) => typeof v === "string" && v));
      if (data.length) out.push({ index: ti, headers, rows: data });
    });
    return out;
  }

  function extractCaseNumbers(text) {
    const set = new Map();
    let m;
    CASE_RE.lastIndex = 0;
    while ((m = CASE_RE.exec(text))) {
      const num = m[2];
      if (!set.has(num)) set.set(num, { number: num, type: m[1] ? m[1].trim() : null });
    }
    if (SOURCE === "net-batei-hadin") {
      SHARIA_CASE_RE.lastIndex = 0;
      while ((m = SHARIA_CASE_RE.exec(text))) {
        const num = `${m[1]}/${m[2]}`;
        if (!set.has(num)) set.set(num, { number: num, type: "שרעי" });
      }
    }
    return [...set.values()];
  }

  function extractDocLinks() {
    return [...document.querySelectorAll("a[href]")]
      .filter((a) => /\.pdf|document|ViewDoc|Download|GetFile/i.test(a.href + " " + a.innerText))
      .map((a) => ({ text: clean(a.innerText), href: a.href }))
      .slice(0, 300);
  }

  function snapshot() {
    const text = document.body ? document.body.innerText : "";
    return {
      source: SOURCE,
      url: location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
      caseNumbers: extractCaseNumbers(text),
      tables: extractTables(),
      docLinks: extractDocLinks(),
      // טקסט מלא מוגבל – לשמירה/חיפוש בצד המערכת
      text: text.slice(0, 200000),
      firstDate: (text.match(DATE_RE) || [null])[0],
    };
  }

  function toast(msg, ok = true) {
    const t = document.createElement("div");
    t.className = "nm-bridge-toast " + (ok ? "ok" : "err");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  // כפתור צף – רק במסגרת העליונה
  if (window.top === window) {
    const btn = document.createElement("button");
    btn.className = "nm-bridge-btn";
    btn.type = "button";
    btn.textContent = "⚖ שלח למערכת המשרד";
    btn.addEventListener("click", () => {
      btn.disabled = true;
      chrome.runtime.sendMessage({ type: "NM_PUSH", payload: snapshot() }, (res) => {
        btn.disabled = false;
        if (chrome.runtime.lastError) return toast("שגיאה: " + chrome.runtime.lastError.message, false);
        toast(res && res.ok ? `נשלח ✓ (${res.summary || "OK"})` : "נכשל: " + ((res && res.error) || "לא ידוע"), !!(res && res.ok));
      });
    });
    document.documentElement.appendChild(btn);
  }

  // בקשה מה-popup
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg && msg.type === "NM_SNAPSHOT") {
      reply(snapshot());
      return true;
    }
  });
})();
