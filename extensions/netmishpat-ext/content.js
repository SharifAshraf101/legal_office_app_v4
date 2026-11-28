// גשר נט המשפט – content script
// רץ רק בעמודי court.gov.il שבהם המשתמש כבר מחובר (כרטיס חכם / הזדהות לאומית).
// שולף את מה שמוצג כרגע על המסך, אחרי לחיצה. "ייבוא כל המסמכים שבעמוד" (גם הוא
// רק אחרי לחיצה) עובר על המסמכים שברשימה המוצגת, אחד אחד, ושומר כל אחד מהם.

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

  function toast(msg, ok = true, ms = 4000) {
    const t = document.createElement("div");
    t.className = "nm-bridge-toast " + (ok ? "ok" : "err");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // כפתור צף – רק במסגרת העליונה
  if (window.top === window) {
    const btn = document.createElement("button");
    btn.className = "nm-bridge-btn";
    btn.type = "button";
    // חלון הצפייה במסמך: המסמך מוצג כתמונה ואין בעמוד נתונים לשליחה. הקובץ עצמו
    // נשלח למערכת כשלוחצים על "שמירה" בסרגל של חלון הצפייה (ראה background.js).
    const IS_VIEWER = /\/Viewer\//i.test(location.pathname);
    btn.textContent = IS_VIEWER ? "⚖ שמירת המסמך במערכת המשרד" : "⚖ שלח למערכת המשרד";
    btn.addEventListener("click", () => {
      if (IS_VIEWER) {
        // הכפתור הזה אינו שומר בעצמו: השמירה נעשית בכפתור 💾 של נט המשפט, והתוסף
        // שולח את אותו קובץ למשרד. כאן מוצג מצב התוסף, כדי לדעת למה מסמך לא הגיע.
        const stale = "התוסף עודכן ולא נטען מחדש: ב-chrome://extensions ללחוץ ↻ על התוסף, ואז F5 בעמוד הזה";
        try {
          chrome.runtime.sendMessage({ type: "NM_DIAG" }, (d) => {
            if (chrome.runtime.lastError || !d) return toast(stale, false, 12000);
            if (!d.downloads) return toast(stale, false, 12000);
            if (!d.configured) return toast("יש להגדיר כתובת Worker וטוקן בהגדרות התוסף", false, 12000);
            const last = (d.seen || [])[0];
            const tail = last
              ? ` | הורדה אחרונה: ${last.result}${last.where ? " (" + last.where + ")" : ""}`
              : " | עדיין לא זוהתה הורדה";
            toast(`לחץ על כפתור השמירה (💾) בסרגל שלמעלה. תוסף ${d.version}${tail}`, true, 12000);
          });
        } catch (_) {
          toast(stale, false, 12000);
        }
        return;
      }
      btn.disabled = true;
      chrome.runtime.sendMessage({ type: "NM_PUSH", payload: snapshot() }, (res) => {
        btn.disabled = false;
        if (chrome.runtime.lastError) return toast("שגיאה: " + chrome.runtime.lastError.message, false);
        toast(res && res.ok ? `נשלח ✓ (${res.summary || "OK"})` : "נכשל: " + ((res && res.error) || "לא ידוע"), !!(res && res.ok));
      });
    });
    document.documentElement.appendChild(btn);
  }

  // ---- ייבוא אוטומטי של כל המסמכים שבעמוד (ראה background.js) ----
  const IS_VIEWER_PAGE = /\/Viewer\//i.test(location.pathname);
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? null : r));
      } catch (_) {
        resolve(null);
      }
    });

  // השורה שבה נמצא קישור: עולים עד שהטקסט כולל מספר תיק
  function rowOf(a) {
    let row = a;
    for (let i = 0; i < 8 && row.parentElement; i++) {
      row = row.parentElement;
      if (/\d{3,6}-\d{2}-\d{2}|\d{3,6}\/\d{4}/.test(row.innerText || "")) break;
    }
    return row;
  }

  function docItems() {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll("a[href]")) {
      if (!/^javascript:/i.test(a.href) || !/document/i.test(a.href) || seen.has(a.href)) continue;
      seen.add(a.href);
      out.push({ href: a.href, text: clean(a.innerText), context: (rowOf(a).innerText || "").slice(0, 600) });
    }
    return out;
  }

  if (window.top === window && !IS_VIEWER_PAGE && SOURCE === "net-hamishpat") {
    const auto = document.createElement("button");
    auto.className = "nm-bridge-btn nm-bridge-auto";
    auto.type = "button";
    auto.textContent = "⚖ ייבוא כל המסמכים שבעמוד";
    const bar = document.createElement("div");
    bar.className = "nm-bridge-bar";
    bar.hidden = true;
    const barText = document.createElement("span");
    const stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = "עצור";
    bar.append(barText, stop);
    document.documentElement.append(auto, bar);

    let timer = null;
    let wasRunning = false;
    const summary = (s) =>
      `${s.filed} תויקו בתיקים, ${s.saved} נשמרו ללא תיוק, ${s.failed} נכשלו` + (s.note ? ` | ${s.note}` : "");

    async function tick() {
      const s = await send({ type: "NM_AUTO_TICK" });
      if (!s || (!s.running && !wasRunning)) {
        if (timer) { clearInterval(timer); timer = null; }
        bar.hidden = true;
        return;
      }
      if (!s.running) {
        // הסתיים
        wasRunning = false;
        clearInterval(timer); timer = null;
        bar.hidden = true;
        auto.disabled = false;
        toast("הייבוא הסתיים: " + summary(s), s.failed === 0, 20000);
        return;
      }
      wasRunning = true;
      auto.disabled = true;
      bar.hidden = false;
      barText.textContent = `מייבא מסמך ${Math.min(s.i + 1, s.total)} מתוך ${s.total}… (${summary(s)})`;
      if (s.click) {
        const a = [...document.querySelectorAll("a[href]")].find((x) => x.href === s.click);
        if (a) a.click();
        else await send({ type: "NM_AUTO_NOLINK" });
      }
    }
    const startTicking = () => { if (!timer) timer = setInterval(tick, 1500); };

    stop.addEventListener("click", async () => {
      await send({ type: "NM_AUTO_STOP" });
      void tick();
    });

    auto.addEventListener("click", async () => {
      const items = docItems();
      if (!items.length) return toast("אין בעמוד הזה קישורים למסמכים או להחלטות", false, 6000);
      auto.disabled = true;
      const r = await send({ type: "NM_AUTO_START", items });
      if (!r || !r.ok) {
        auto.disabled = false;
        return toast(r && r.error ? "נכשל: " + r.error : "התוסף עודכן ולא נטען מחדש: ↻ ב-chrome://extensions ואז F5 כאן", false, 12000);
      }
      if (!r.total) {
        auto.disabled = false;
        return toast(`כל ${r.skipped} המסמכים שבעמוד כבר נמצאים במערכת המשרד`, true, 8000);
      }
      toast(`מתחיל לייבא ${r.total} מסמכים` + (r.skipped ? ` (${r.skipped} כבר במערכת)` : ""), true, 6000);
      wasRunning = true;
      startTicking();
    });

    // העמוד נטען מחדש אחרי כל לחיצה על מסמך: אם ייבוא פעיל – ממשיכים ממנו
    send({ type: "NM_AUTO_TICK" }).then((s) => {
      if (s && s.running) { wasRunning = true; startTicking(); void tick(); }
    });
  }

  // חלון הצפייה, כשנפתח מתוך ייבוא אוטומטי: לוחצים על כפתור השמירה של נט המשפט
  if (IS_VIEWER_PAGE) {
    const describe = () =>
      [...document.querySelectorAll("a, button, input, img, area, [onclick]")]
        .filter((el) => !String(el.className || "").includes("nm-bridge"))
        .slice(0, 150)
        .map((el) =>
          [
            el.tagName,
            el.id && "id=" + el.id,
            el.getAttribute("name") && "name=" + el.getAttribute("name"),
            el.getAttribute("type") && "type=" + el.getAttribute("type"),
            el.title && "title=" + el.title,
            el.getAttribute("alt") && "alt=" + el.getAttribute("alt"),
            el.getAttribute("value") && "value=" + String(el.getAttribute("value")).slice(0, 40),
            el.getAttribute("src") && "src=" + String(el.getAttribute("src")).slice(-70),
            el.getAttribute("href") && "href=" + String(el.getAttribute("href")).slice(0, 90),
            el.getAttribute("onclick") && "onclick=" + String(el.getAttribute("onclick")).slice(0, 140),
            el.className && "class=" + String(el.className).slice(0, 60),
          ]
            .filter(Boolean)
            .join(" "),
        )
        .join("\n");
    const SAVE_RE = /save|שמיר|שמור/i;
    const findSave = () =>
      [...document.querySelectorAll("a, button, input, img, area, [onclick]")].find((el) => {
        if (String(el.className || "").includes("nm-bridge")) return false;
        const sig = [el.id, el.getAttribute("name"), el.title, el.getAttribute("alt"), el.getAttribute("src"), el.getAttribute("onclick"), el.getAttribute("href"), el.className]
          .filter(Boolean)
          .join(" ");
        return SAVE_RE.test(sig) && el.getClientRects().length > 0;
      });

    (async () => {
      let mine = false;
      for (let i = 0; i < 4 && !mine; i++) {
        const r = await send({ type: "NM_AUTO_VIEWER" });
        mine = !!(r && r.auto);
        if (!mine) await new Promise((res) => setTimeout(res, 700));
      }
      if (!mine) return;
      const frame = window.top === window ? "top" : "frame " + location.pathname;
      for (let i = 0; i < 40; i++) {
        const el = findSave();
        if (el) {
          await send({ type: "NM_AUTO_SAVE", found: true, diag: frame + "\n" + describe() });
          el.click();
          return;
        }
        await new Promise((res) => setTimeout(res, 500));
      }
      // רק המסגרת העליונה מדווחת על כישלון, כדי שמסגרת פנימית לא תעצור את הייבוא
      if (window.top === window) await send({ type: "NM_AUTO_SAVE", found: false, diag: frame + "\n" + describe() });
    })();
  }

  // לחיצה על קישור של מסמך/החלטה (קישור "פקודה" של האתר, לא כתובת): זוכרים איזה
  // קישור נלחץ, כדי שהקובץ שיישמר מחלון הצפייה שנפתח ישויך לאותה החלטה.
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || !/^javascript:/i.test(a.href) || !/document/i.test(a.href)) return;
      // השורה שבה נמצא הקישור: עולים עד שהטקסט כולל מספר תיק
      let row = a;
      for (let i = 0; i < 8 && row.parentElement; i++) {
        row = row.parentElement;
        if (/\d{3,6}-\d{2}-\d{2}|\d{3,6}\/\d{4}/.test(row.innerText || "")) break;
      }
      try {
        chrome.runtime.sendMessage({
          type: "NM_DOC_CLICK",
          href: a.href,
          text: clean(a.innerText),
          context: (row.innerText || "").slice(0, 600),
        });
      } catch (_) {}
    },
    true
  );

  // בקשות מה-popup ומה-service worker
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg && msg.type === "NM_SNAPSHOT") {
      reply(snapshot());
      return true;
    }
    if (msg && msg.type === "NM_TOAST" && window.top === window) toast(msg.text, msg.ok !== false);
  });
})();
