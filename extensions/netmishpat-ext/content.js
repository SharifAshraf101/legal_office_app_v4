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
      // אתר בתי הדין השרעיים: מבנה העמוד נשלח גם הוא (שתי השורות הראשונות של כל טבלה
      // והכפתורים שבהן), כדי שאפשר יהיה לבנות לו ייבוא אוטומטי כמו בנט המשפט.
      if (SOURCE === "net-batei-hadin") {
        try {
          const rows = [...document.querySelectorAll("table")]
            .slice(0, 6)
            .map((t, i) => {
              const trs = [...t.querySelectorAll("tr")].slice(0, 3);
              return `TABLE ${i} class=${t.className}\n` + trs.map((tr) => tr.outerHTML.replace(/\s+/g, " ").slice(0, 4000)).join("\n");
            })
            .join("\n\n");
          chrome.runtime.sendMessage({ type: "NM_PAGE_DIAG", diag: `PAGE ${location.origin}${location.pathname}\n${rows}` });
        } catch (_) {}
      }
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
  let sendError = ""; // למה ההודעה האחרונה לתוסף לא נענתה
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          if (chrome.runtime.lastError) sendError = chrome.runtime.lastError.message || "";
          resolve(chrome.runtime.lastError ? null : r);
        });
      } catch (e) {
        sendError = String(e && e.message ? e.message : e);
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
      const s = await send({ type: "NM_AUTO_TICK", path: location.pathname });
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
      // חלון מסמך שהאתר ניסה לפתוח ונחסם (ראה main-world.js): התוסף יפתח אותו
      const blocked = document.documentElement.getAttribute("data-nm-blocked-open");
      if (blocked) {
        document.documentElement.removeAttribute("data-nm-blocked-open");
        await send({ type: "NM_AUTO_OPEN", url: blocked });
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
      const r = await send({ type: "NM_AUTO_START", items, path: location.pathname });
      if (!r || !r.ok) {
        auto.disabled = false;
        return toast(r && r.error ? "נכשל: " + r.error : "אין תשובה מהתוסף – F5 בעמוד הזה (אם לא עוזר: ↻ ב-chrome://extensions). [" + sendError + "]", false, 12000);
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
    send({ type: "NM_AUTO_TICK", path: location.pathname }).then((s) => {
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
      document.getElementById("btnSave") ||
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
          // מסמנים את הכפתור; הלחיצה עצמה נעשית בתוך העמוד (background.js)
          el.setAttribute("data-nm-save", "1");
          await send({ type: "NM_AUTO_SAVE", found: true, diag: frame + "\n" + describe() });
          return;
        }
        await new Promise((res) => setTimeout(res, 500));
      }
      // רק המסגרת העליונה מדווחת על כישלון, כדי שמסגרת פנימית לא תעצור את הייבוא
      if (window.top === window) await send({ type: "NM_AUTO_SAVE", found: false, diag: frame + "\n" + describe() });
    })();
  }

  // ---- נט בתי הדין השרעיים (unicourt.justice.gov.il) ----
  // שם אין חלון צפייה: בכל שורה של הטבלה יש סמל הורדה, והעמוד עצמו בונה את הקובץ
  // ושומר אותו. main-world.js מעביר לכאן כל קובץ שהעמוד בונה; אם זה PDF שנוצר מיד
  // אחרי לחיצה בשורה של החלטה – הוא נשלח למשרד עם פרטי השורה (תאריך, סוג, מספר תיק,
  // צדדים). "ייבוא כל ההחלטות שבעמוד" לוחץ על סמל ההורדה של כל שורה, אחת אחת.
  if (SOURCE === "net-batei-hadin" && window.top === window) {
    const ROWS = 'tr, [role="row"], mat-row';
    const parseRow = (row) => {
      const cells = [...row.children].map((c) => clean(c.innerText)).filter(Boolean);
      let date = "";
      let caseNo = "";
      const rest = [];
      for (const c of cells) {
        if (!date && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c)) date = c;
        else if (!caseNo && /^\d{1,6}\/\d{4}$/.test(c)) caseNo = c;
        else rest.push(c);
      }
      if (!date || !caseNo) return null;
      return { date, caseNo, kind: rest[0] || "מסמך", parties: rest[1] || "" };
    };
    // כל השורות שבעמוד, עם מזהה קבוע לכל אחת (שתי החלטות זהות באותו יום – לפי הסדר)
    const listRows = () => {
      const count = new Map();
      const out = [];
      for (const row of document.querySelectorAll(ROWS)) {
        const p = parseRow(row);
        if (!p) continue;
        const base = `sharia:${p.caseNo}|${p.date}|${p.kind}|${p.parties}`;
        const n = count.get(base) || 0;
        count.set(base, n + 1);
        out.push({ row, ...p, href: n ? `${base}#${n}` : base });
      }
      return out;
    };
    // סמל ההורדה של שורה: הסמל האחרון בשורה (אחרי סמל ההצגה), או זה ששמו "הורדה".
    // השורה עצמה היא קישור לתיק, ולכן לוחצים על הסמל עצמו ולא על מה שעוטף אותו.
    // הטבלה שם בנויה משני חלקים: השורה עם הטקסט, ולצידה עמודה "מוצמדת" נפרדת שבה
    // הסמלים. שני החלקים של אותה שורה נושאים אותו מספר שורה.
    const rowParts = (row) => {
      for (const attr of ["row-id", "row-index", "aria-rowindex", "data-rowindex", "data-row-index"]) {
        const v = row.getAttribute(attr);
        if (v == null || v === "") continue;
        const parts = [...document.querySelectorAll(`[${attr}="${CSS.escape(v)}"]`)];
        if (parts.length > 1) return parts;
      }
      return [row];
    };
    const downloadButton = (row) => {
      const parts = rowParts(row);
      const pick = (sel) =>
        parts.flatMap((p) => [...p.querySelectorAll(sel)]).filter((el) => !clean(el.textContent) && !el.closest('input, label, [type="checkbox"]') && !el.matches('input'));
      const own = (el) =>
        [el.id, el.getAttribute("class"), el.getAttribute("title"), el.getAttribute("aria-label"), el.getAttribute("alt"), el.getAttribute("src"), el.getAttribute("href"), el.getAttribute("data-icon")]
          .filter(Boolean)
          .join(" ");
      let icons = pick('svg, img, i, mat-icon, button, [role="button"], [class*="icon" i], [class*="download" i]');
      // אין סמל מוכר: כל רכיב ריק מטקסט שנראה על המסך, בעמודה המוצמדת
      if (!icons.length) {
        icons = pick("*").filter((el) => !el.children.length && el.getClientRects().length > 0 && !parts.includes(el));
      }
      const el = icons.find((x) => /download|הורד/i.test(own(x))) || icons[icons.length - 1];
      if (!el) return null;
      const wrap = el.closest('button, a, [role="button"]');
      return wrap && !parts.includes(wrap) && parts.some((p) => p.contains(wrap)) && !clean(wrap.textContent) ? wrap : el;
    };
    const rowHtmlOf = (row) =>
      rowParts(row).map((p) => p.outerHTML.replace(/\s+/g, " ").slice(0, 6000)).join("\n---\n");
    const press = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    const filingText = (f) => {
      const st = String((f && f.status) || "");
      if (st === "filed") return `המסמך תויק בתיק ${f.caseId} (${f.docId}) ✓`;
      if (st.startsWith("duplicate:")) return `המסמך נשמר ✓ – לא תויק: נראה שכבר מתויק בתיק (${st.slice(10)})`;
      if (st === "no_case") return "המסמך נשמר ✓ – לא תויק: אין במערכת תיק עם מספר התיק הזה";
      if (st === "ambiguous") return "המסמך נשמר ✓ – לא תויק: יש במערכת יותר מתיק אחד עם המספר הזה";
      return "המסמך נשמר במערכת המשרד ✓";
    };

    let lastClick = null; // השורה שנלחצה לאחרונה
    let waiting = null;   // הייבוא האוטומטי מחכה לתוצאה של השורה הנוכחית
    let blobsSeen = 0;    // כמה קבצים העמוד בנה מאז שנטען (לאבחון)
    let reported = false;

    // רכיב, וכל מה שעוטף אותו – לדיווח על מבנה העמוד כשמשהו לא עובד
    const describeUp = (el) => {
      const out = [];
      for (let n = el, i = 0; n && n.nodeType === 1 && i < 12; n = n.parentElement, i++) {
        out.push(`${n.tagName} ${[...n.attributes].map((a) => `${a.name}="${String(a.value).slice(0, 70)}"`).join(" ")}`.slice(0, 320));
      }
      return out.join("\n  < ");
    };
    // סמלי השורה יושבים בעמודה נפרדת מהטקסט שלה, ולכן השורה של לחיצה נקבעת לפי
    // המקום על המסך: השורה שהגובה שלה כולל את נקודת הלחיצה.
    const rowAtY = (y) =>
      listRows().find((r) => {
        const b = r.row.getBoundingClientRect();
        return b.height > 0 && y >= b.top && y <= b.bottom;
      });

    document.addEventListener(
      "click",
      (e) => {
        const hit = rowAtY(e.clientY);
        if (!hit) return;
        const click = { ...hit, row: null, at: Date.now() };
        lastClick = click;
        // לחיצה על סמל (לא על הטקסט של השורה) שלא הביאה PDF תוך 20 שניות: מדווחים
        // פעם אחת איך הסמל בנוי, כדי שאפשר יהיה לתקן.
        const box = e.target.getBoundingClientRect ? e.target.getBoundingClientRect() : { width: 999 };
        if (reported || box.width > 80 || hit.row.contains(e.target)) return;
        const seenBefore = blobsSeen;
        const target = describeUp(e.target);
        setTimeout(() => {
          if (lastClick !== click || reported) return;
          reported = true;
          send({ type: "NM_PAGE_DIAG", diag: `SHARIA NO PDF after click; blobs ${seenBefore}->${blobsSeen}; trusted=${e.isTrusted}\n${target}` });
        }, 20000);
      },
      true
    );

    // נקודת הלחיצה של חץ ההורדה בשורה: מבין הסמלים הקטנים שנמצאים בגובה השורה,
    // זה ששמו "הורדה", ואם אין שם – השמאלי ביותר (החץ נמצא משמאל לסמל ההצגה).
    const downloadPoint = (row) => {
      const b = row.getBoundingClientRect();
      const sig = (el) =>
        [el.id, el.getAttribute("class"), el.getAttribute("title"), el.getAttribute("aria-label"), el.getAttribute("alt"), el.getAttribute("src"), el.getAttribute("data-icon"), el.getAttribute("mattooltip")]
          .filter(Boolean)
          .join(" ");
      const cands = [...document.querySelectorAll('svg, img, i, button, a, [role="button"], mat-icon, [class*="icon" i]')].filter((el) => {
        if (el.matches("input") || el.closest("label") || String(el.getAttribute("class") || "").includes("nm-bridge")) return false;
        if (clean(el.textContent)) return false;
        const r = el.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        return r.width >= 8 && r.width <= 64 && r.height >= 8 && r.height <= 64 && cy > b.top && cy < b.bottom;
      });
      if (!cands.length) return null;
      const left = (el) => el.getBoundingClientRect().left;
      const picked = cands.find((x) => /download|הורד/i.test(sig(x))) || cands.reduce((a, c) => (left(c) < left(a) ? c : a));
      const r = picked.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      // מה שעכבר אמיתי היה פוגע בו בנקודה הזו
      return { x, y, picked, el: document.elementFromPoint(x, y) || picked };
    };
    const pressAt = (p) => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        const Ev = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        p.el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: p.x, clientY: p.y, button: 0 }));
      }
    };

    const toBase64 = (blob) =>
      new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });

    window.addEventListener("message", async (e) => {
      if (e.source !== window || !e.data || e.data.__nmBridgeBlob !== true) return;
      const blob = e.data.blob;
      blobsSeen++;
      const click = lastClick;
      if (!(blob instanceof Blob) || !click || Date.now() - click.at > 60000) return;
      const done = (r) => {
        if (waiting) { const w = waiting; waiting = null; w(r); }
        else if (r.ok) toast(filingText(r.filing), true, 8000);
        else toast("שמירת המסמך במערכת המשרד נכשלה: " + r.error, false, 8000);
      };
      try {
        const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
        if (!(head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) return; // לא PDF
        lastClick = null;
        if (blob.size > 40 * 1024 * 1024) return done({ ok: false, error: "הקובץ גדול מדי" });
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", await blob.arrayBuffer()));
        const hex = [...digest].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
        const r = await send({
          type: "NM_BLOB_FILE",
          b64: await toBase64(blob),
          name: `sharia_${hex}.pdf`,
          href: click.href,
          text: click.kind,
          context: `${click.date}\n${click.kind}\n${click.caseNo}\n${click.parties}`,
        });
        done(r || { ok: false, error: "אין תשובה מהתוסף – F5 בעמוד הזה [" + sendError + "]" });
      } catch (err) {
        done({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    });

    const auto = document.createElement("button");
    auto.className = "nm-bridge-btn nm-bridge-auto";
    auto.type = "button";
    auto.textContent = "⚖ ייבוא כל ההחלטות שבעמוד";
    const bar = document.createElement("div");
    bar.className = "nm-bridge-bar";
    bar.hidden = true;
    const barText = document.createElement("span");
    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.textContent = "עצור";
    bar.append(barText, stopBtn);
    document.documentElement.append(auto, bar);
    let stopped = false;
    stopBtn.addEventListener("click", () => { stopped = true; });
    const pause = (ms) => new Promise((res) => setTimeout(res, ms));

    auto.addEventListener("click", async () => {
      const rows = listRows();
      if (!rows.length) return toast("לא נמצאו בעמוד שורות של החלטות (תאריך ומספר תיק)", false, 8000);
      auto.disabled = true;
      const p = await send({ type: "NM_PENDING", hrefs: rows.map((r) => r.href) });
      if (!p || !p.ok) {
        auto.disabled = false;
        return toast(p && p.error ? "נכשל: " + p.error : "אין תשובה מהתוסף – F5 בעמוד הזה (אם לא עוזר: ↻ ב-chrome://extensions). [" + sendError + "]", false, 12000);
      }
      const want = new Set(p.pending);
      const queue = rows.filter((r) => want.has(r.href));
      if (!queue.length) {
        auto.disabled = false;
        return toast(`כל ${rows.length} ההחלטות שבעמוד כבר נמצאות במערכת המשרד`, true, 8000);
      }
      const s = { filed: 0, saved: 0, failed: 0, note: "" };
      const summary = () => `${s.filed} תויקו בתיקים, ${s.saved} נשמרו ללא תיוק, ${s.failed} נכשלו` + (s.note ? ` | ${s.note}` : "");
      stopped = false;
      bar.hidden = false;
      const startPath = location.pathname;
      const rowHtml = rowHtmlOf(queue[0].row);
      for (let i = 0; i < queue.length && !stopped; i++) {
        barText.textContent = `מייבא החלטה ${i + 1} מתוך ${queue.length}… (${summary()})`;
        const item = queue[i];
        let btn = null;
        if (item.row.isConnected) {
          item.row.scrollIntoView({ block: "center" });
          await pause(400);
          btn = downloadPoint(item.row);
        }
        if (!btn) {
          s.failed++;
          s.note = "לא נמצא סמל ההורדה בשורה; מבנה השורה נשלח לבדיקה";
          await send({ type: "NM_PAGE_DIAG", diag: `SHARIA ROW no button ${startPath}\n${rowHtml}` });
          break;
        }
        if (i === 0) {
          await send({ type: "NM_PAGE_DIAG", diag: `SHARIA PICK\npicked: ${describeUp(btn.picked)}\nat point: ${describeUp(btn.el)}` });
        }
        const result = new Promise((resolve) => {
          waiting = resolve;
          setTimeout(() => { if (waiting === resolve) { waiting = null; resolve({ ok: false, error: "הקובץ לא נוצר" }); } }, 45000);
        });
        pressAt(btn);
        const r = await result;
        if (!r.ok) { s.failed++; s.note = r.error; }
        else if (r.filing && r.filing.status === "filed") s.filed++;
        else s.saved++;
        // הלחיצה לא הביאה קובץ, או העבירה לעמוד אחר: מבנה השורה נשלח לבדיקה, ועוצרים
        if (!r.ok || location.pathname !== startPath) {
          if (i === 0 || location.pathname !== startPath) {
            await send({ type: "NM_PAGE_DIAG", diag: `SHARIA ROW ${startPath} -> ${location.pathname}\n${rowHtml}` });
          }
          if (location.pathname !== startPath) {
            s.note = "הלחיצה פתחה עמוד אחר במקום להוריד את הקובץ; מבנה השורה נשלח לבדיקה";
            break;
          }
        }
        if (i < queue.length - 1) await pause(3000);
      }
      bar.hidden = true;
      auto.disabled = false;
      toast((stopped ? "הייבוא נעצר: " : "הייבוא הסתיים: ") + summary(), s.failed === 0, 20000);
    });
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
