// גשר נט המשפט – רץ בתוך העמוד עצמו (לא בעולם המבודד של התוסף), בתחילת הטעינה.
// בייבוא אוטומטי התוסף לוחץ על קישור המסמך במקום המשתמש, ו-Chrome חוסם אז את החלון
// שהאתר מנסה לפתוח (חלון קופץ בלי לחיצה של אדם). כאן רק נרשמת הכתובת של חלון
// שנחסם, כדי שהתוסף יפתח אותה בעצמו כלשונית. חלון שנפתח כרגיל – לא נוגעים בו.
(() => {
  if (window.__nmBridgeOpenHook) return;
  window.__nmBridgeOpenHook = true;
  // אתר בתי הדין השרעיים בונה את קובץ ההחלטה בתוך העמוד ושומר אותו משם. כל קובץ
  // שהעמוד בונה מועבר גם ל-content script של התוסף (שבודק אם זה PDF של החלטה).
  if (!/(^|\.)court\.gov\.il$/.test(location.hostname)) {
    const make = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      try {
        if (obj instanceof Blob) window.postMessage({ __nmBridgeBlob: true, blob: obj }, location.origin);
      } catch (_) {}
      return make.apply(this, arguments);
    };
  }
  const original = window.open;
  window.open = function (url, ...rest) {
    const opened = original.call(this, url, ...rest);
    try {
      if (!opened && url && document.documentElement) {
        document.documentElement.setAttribute("data-nm-blocked-open", new URL(String(url), location.href).href);
      }
    } catch (_) {}
    return opened;
  };
})();
