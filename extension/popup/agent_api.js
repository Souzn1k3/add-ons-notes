/* Модуль-клиент локального агента (Notes Bridge agent). */

const DEFAULTS = { port: 8712, token: "", writeback: false };

export async function loadSettings() {
  const got = await chrome.storage.local.get(DEFAULTS);
  return got;
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

function url(port, path) {
  return `http://127.0.0.1:${port}${path}`;
}

export async function request(port, token, path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(options.timeoutMs || 8000),
  };
  if (options.body) init.body = JSON.stringify(options.body);
  const res = await fetch(url(port, path), init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch (_) { /* не-JSON ответ */ }
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

export function health(port, token) {
  return request(port, token, "/health", { timeoutMs: 4000 });
}

export function listNotes({ port, token, query = "", folder = "", limit = 300 }) {
  const qs = new URLSearchParams({ query, folder, limit });
  return request(port, token, `/notes?${qs}`);
}

export function getNote({ port, token, uuid }) {
  return request(port, token, `/note/${encodeURIComponent(uuid)}`);
}

export function createNote({ port, token, title, body, bookmark }) {
  return request(port, token, "/notes/create", {
    method: "POST",
    timeoutMs: 60000,
    body: { title, body, bookmark },
  });
}
