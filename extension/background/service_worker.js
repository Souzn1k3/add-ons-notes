/* Фоновый воркер: периодическое обновление кэша списка заметок,
   чтобы popup открывался мгновенно. AgentAPI дублируется компактно —
   у service worker свой контекст модулей. */

const REFRESH_PERIOD_MIN = 30;

async function settings() {
  return chrome.storage.local.get({ port: 8712, token: "" });
}

async function refreshCache() {
  try {
    const s = await settings();
    if (!s.token) return;
    const res = await fetch(
      `http://127.0.0.1:${s.port}/notes?limit=300`,
      {
        headers: { Authorization: `Bearer ${s.token}` },
        signal: AbortSignal.timeout(6000),
      });
    if (res.ok) {
      const data = await res.json();
      await chrome.storage.local.set({
        cached_notes: data.notes || [],
        cached_at: Date.now(),
      });
    }
  } catch (_) { /* агент офлайн — молча */ }
}

chrome.alarms.create("refresh", { periodInMinutes: REFRESH_PERIOD_MIN });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "refresh") refreshCache();
});
chrome.runtime.onInstalled.addListener(refreshCache);
