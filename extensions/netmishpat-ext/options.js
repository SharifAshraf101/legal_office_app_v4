const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["endpoint", "token"]).then(({ endpoint = "", token = "" }) => {
  $("endpoint").value = endpoint;
  $("token").value = token;
});

$("save").onclick = async () => {
  const endpoint = $("endpoint").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  if (!/^https:\/\//.test(endpoint)) return ($("msg").textContent = "הכתובת חייבת להתחיל ב-https://");

  // אם ה-Worker יושב על דומיין פרטי (לא workers.dev) – מבקשים הרשאה לדומיין הזה בלבד
  const origin = new URL(endpoint).origin + "/*";
  if (!/\.workers\.dev$/.test(new URL(endpoint).hostname)) {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) return ($("msg").textContent = "לא אושרה הרשאה לדומיין של ה-Worker");
  }
  await chrome.storage.local.set({ endpoint, token });
  $("msg").textContent = "נשמר ✓";
};
