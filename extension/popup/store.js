/* Локальное хранилище заметок (chrome.storage.local). Без сети и без агента. */

const NOTES_KEY = "nb_notes_v1";
const SETTINGS_KEY = "nb_settings_v1";
const INIT_KEY = "nb_init_v2";
const LEGACY_KEYS = ["cached_notes", "cached_at", "port", "token", "writeback"];

export const DEFAULT_SETTINGS = { theme: "auto", accent: "blue" };

export function makeId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return "n-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

let saveChain = Promise.resolve();

export function saveNotes(notes) {
  const snapshot = notes.map((n) => ({ ...n }));
  saveChain = saveChain
    .then(() => chrome.storage.local.set({ [NOTES_KEY]: snapshot }))
    .catch(() => {});
  return saveChain;
}

export async function loadNotes() {
  const o = await chrome.storage.local.get({ [NOTES_KEY]: [] });
  return Array.isArray(o[NOTES_KEY]) ? o[NOTES_KEY] : [];
}

export async function loadSettings() {
  const o = await chrome.storage.local.get({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS, ...(o[SETTINGS_KEY] || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function cleanupLegacy() {
  try { await chrome.storage.local.remove(LEGACY_KEYS); } catch (_) { /* ignore */ }
}

export async function seedWelcomeIfNeeded() {
  const o = await chrome.storage.local.get({ [INIT_KEY]: false, [NOTES_KEY]: [] });
  if (o[INIT_KEY]) return;
  const notes = Array.isArray(o[NOTES_KEY]) ? o[NOTES_KEY] : [];
  if (!notes.length) {
    const now = Date.now();
    notes.push({
      id: makeId(),
      title: "Добро пожаловать",
      body: "Это локальные заметки в браузере — без интернета и без сторонних приложений.\n\n- [ ] создать заметку кнопкой «+»\n- [ ] закрепить важное звёздочкой\n- [ ] чек-лист — строка вида «- [ ]»\n\nВсё хранится только в этом браузере.",
      pinned: true,
      created: now,
      updated: now,
    });
    await saveNotes(notes);
  }
  await chrome.storage.local.set({ [INIT_KEY]: true });
}

/* ---------- экспорт/импорт ---------- */

export function buildExport(notes, settings) {
  return {
    app: "notes-local",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    notes: notes.map((n) => ({ ...n })),
  };
}

export function validateImport(payload) {
  let arr = null;
  if (Array.isArray(payload)) arr = payload;
  else if (payload && Array.isArray(payload.notes)) arr = payload.notes;
  if (!arr) throw new Error("в файле нет списка заметок");
  return arr
    .filter((n) => n && typeof n === "object")
    .map((n) => ({
      id: typeof n.id === "string" && n.id ? n.id : makeId(),
      title: typeof n.title === "string" ? n.title : "",
      body: typeof n.body === "string" ? n.body : "",
      pinned: !!n.pinned,
      created: Number(n.created) || Date.now(),
      updated: Number(n.updated) || Number(n.created) || Date.now(),
    }));
}

export function mergeNotes(current, incoming) {
  const byId = new Map(current.map((n) => [n.id, n]));
  let added = 0, updated = 0;
  for (const n of incoming) {
    const ex = byId.get(n.id);
    if (!ex) {
      byId.set(n.id, n);
      added++;
    } else if (n.updated > ex.updated) {
      byId.set(n.id, n);
      updated++;
    }
  }
  return { notes: Array.from(byId.values()), added, updated };
}
