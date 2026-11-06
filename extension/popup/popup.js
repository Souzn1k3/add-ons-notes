/* Popup: список/поиск/чтение/создание/настройки. */

import { loadSettings, saveSettings, health, listNotes, getNote, createNote }
  from "./agent_api.js";

const $ = (id) => document.getElementById(id);
const state = {
  settings: { port: 8712, token: "", writeback: false },
  notes: [],
  folders: {},
  folder: "",
  query: "",
  online: null,
  appRunning: false,
  currentNote: null,
};

/* ---------- утилиты ---------- */

function fmtDate(ms) {
  if (!ms) return "";
  const d = new Date(Number(ms));
  const pad = (n) => String(n).padStart(2, "0");
  const today = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function switchView(name) {
  for (const v of ["view-home", "view-reader", "view-composer"]) {
    $(v).classList.toggle("hidden", v !== name);
  }
}

/* ---------- статус ---------- */

function renderStatus() {
  const dot = $("status-dot");
  const txt = $("status-text");
  if (state.online === undefined || state.online === null) {
    dot.className = "status-dot";
    txt.textContent = "Подключение…";
  } else if (state.online) {
    dot.className = "status-dot ok";
    txt.textContent = state.appRunning
      ? "Мост активен, синхронизация работает"
      : "Мост активен (приложение Samsung Notes закрыто)";
  } else {
    dot.className = "status-dot err";
    txt.textContent = "Агент не запущен — запускайте через install.bat";
  }
}

/* ---------- список ---------- */

function renderFolders() {
  const box = $("folders");
  const counts = {};
  for (const n of state.notes) {
    counts[n.folder_uuid] = (counts[n.folder_uuid] || 0) + 1;
  }
  const chips = [{ uuid: "", name: "Все", count: state.notes.length }];
  const seen = new Set(["", "uncategorized:///", "trash:///"]);
  for (const n of state.notes) {
    if (seen.has(n.folder_uuid) || !n.folder_name) continue;
    seen.add(n.folder_uuid);
    chips.push({ uuid: n.folder_uuid, name: n.folder_name, count: counts[n.folder_uuid] || 0 });
  }
  box.innerHTML = chips.map((c) =>
    `<button class="chip ${c.uuid === state.folder ? "active" : ""}" data-uuid="${esc(c.uuid)}">` +
    `${esc(c.name)} <span class="n">${c.count}</span></button>`).join("");
  for (const b of box.querySelectorAll(".chip")) {
    b.addEventListener("click", () => {
      state.folder = b.dataset.uuid;
      renderFolders();
      renderList();
    });
  }
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.notes.filter((n) => {
    if (state.folder && n.folder_uuid !== state.folder) return false;
    if (!q) return true;
    return n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q);
  });
}

const star = `<span class="fav"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg></span>`;

function renderList() {
  const box = $("notes-list");
  const items = filtered();
  if (!items.length) {
    box.innerHTML = `<div class="empty">Ничего не найдено</div>`;
    return;
  }
  box.innerHTML = items.map((n) => `
    <article class="note-card" data-uuid="${esc(n.uuid)}">
      <div class="t">${n.is_locked ? "" : (n.favorite ? star : "")}${esc(n.title)}</div>
      ${n.is_locked
        ? `<div class="p">🔒 Заметка защищена паролем — откройте её в приложении Samsung Notes.</div>`
        : `<div class="p">${esc(n.preview || "Пустая заметка")}</div>`}
      <div class="meta">
        <span>${fmtDate(n.modified_at)}</span>
        ${n.folder_name && state.folder === "" ? `<span>${esc(n.folder_name)}</span>` : ""}
        ${n.has_checkbox ? `<span class="badge">чек-лист</span>` : ""}
        ${n.has_bullets && !n.has_checkbox ? `<span class="badge">список</span>` : ""}
        ${n.media_count ? `<span class="badge">медиа ${n.media_count}</span>` : ""}
        ${n.is_locked ? `<span class="badge lock">🔒</span>` : ""}
      </div>
    </article>`).join("");
  for (const c of box.querySelectorAll(".note-card")) {
    c.addEventListener("click", () => openNote(c.dataset.uuid));
  }
}

/* ---------- чтение ---------- */

async function openNote(uuid) {
  const cached = state.notes.find((n) => n.uuid === uuid);
  $("reader-title").textContent = cached ? cached.title : "Заметка";
  $("reader-meta").innerHTML = cached
    ? `${fmtDate(cached.modified_at)} · ${esc(cached.folder_name || "")}`
    : "";
  $("reader-body").textContent = "";
  switchView("view-reader");
  try {
    const res = await getNote({ ...state.settings, uuid });
    const note = res.note || res;
    $("reader-title").textContent = note.title;
    $("reader-meta").innerHTML =
      `${fmtDate(note.modified_at)} · ${esc(note.folder_name || "")}` +
      (note.document_type ? " · рукопись/рисунок (текст доступен частично)" : "");
    $("reader-body").textContent = note.text || "Пустая заметка";
  } catch (e) {
    if (cached) $("reader-body").textContent = cached.preview;
    toast("Не удалось загрузить текст: " + e.message);
  }
}

/* ---------- создание ---------- */

async function saveComposed() {
  const title = $("compose-title").value.trim();
  const body = $("compose-text").value;
  if (!title && !body.trim()) {
    toast("Заметка пустая");
    return;
  }
  const btn = $("compose-save");
  btn.disabled = true;
  btn.textContent = "Сохранение…";
  try {
    await createNote({ ...state.settings, title, body });
    $("compose-title").value = "";
    $("compose-text").value = "";
    switchView("view-home");
    btn.textContent = "Сохранить";
    btn.disabled = false;
    toast("Заметка отправлена в Samsung Notes");
    await refreshAll(true);
  } catch (e) {
    btn.textContent = "Сохранить";
    btn.disabled = false;
    toast("Ошибка: " + e.message);
  }
}

/* ---------- синхронизация ---------- */

async function refreshAll(force = false) {
  const s = state.settings;
  if (!s.token) {
    state.online = false;
    renderStatus();
    $("home-empty").textContent =
      "Не указан токен агента — откройте настройки";
    return;
  }
  try {
    const h = await health(s.port, s.token);
    state.online = true;
    state.appRunning = !!h.app_running;
    state.writebackAvailable = !!h.writeback_enabled;
    renderStatus();
    const res = await listNotes(s);
    state.notes = res.notes || [];
    await chrome.storage.local.set({ cached_notes: state.notes, cached_at: Date.now() });
    renderFolders();
    renderList();
  } catch (e) {
    state.online = false;
    renderStatus();
    const got = await chrome.storage.local.get({ cached_notes: [] });
    if (got.cached_notes.length) {
      state.notes = got.cached_notes;
      $("status-text").textContent = "Агент недоступен, показан локальный кэш";
      renderFolders();
      renderList();
    } else if (force === false && e.status !== 401) {
      $("home-empty").textContent = "Запустите агента на ПК (agent\\install.bat)";
    }
  }
}

/* ---------- настройки ---------- */

async function openSettings() {
  const s = state.settings;
  $("set-port").value = s.port;
  $("set-token").value = s.token;
  $("set-writeback").classList.toggle("on", !!s.writeback);
  $("settings-modal").classList.remove("hidden");
}

async function closeSettings() {
  const port = Math.max(8712, Math.min(8719, parseInt($("set-port").value, 10) || 8712));
  const token = $("set-token").value.trim();
  const writeback = $("set-writeback").classList.contains("on");
  await saveSettings({ port, token, writeback });
  state.settings = { ...state.settings, port, token, writeback };
  $("settings-modal").classList.add("hidden");
  await refreshAll(true);
}

/* ---------- инициализация ---------- */

async function init() {
  state.settings = await loadSettings();

  $("btn-settings").addEventListener("click", openSettings);
  $("set-close").addEventListener("click", closeSettings);
  $("set-test").addEventListener("click", async () => {
    const port = parseInt($("set-port").value, 10) || 8712;
    const token = $("set-token").value.trim();
    try {
      const h = await health(port, token);
      toast(`Связь есть: ${h.notes} заметок${h.app_running ? ", приложение запущено" : ""}`);
    } catch (e) {
      toast("Нет связи: " + e.message);
    }
  });
  $("set-writeback").addEventListener("click", (el) => {
    el.currentTarget.classList.toggle("on");
  });
  $("settings-modal").addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) $("set-close").click();
  });

  $("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList();
  });

  $("btn-back-read").addEventListener("click", () => switchView("view-home"));
  $("btn-back-compose").addEventListener("click", () => switchView("view-home"));
  $("fab").addEventListener("click", () => {
    $("compose-title").value = "";
    $("compose-text").value = "";
    switchView("view-composer");
  });
  $("compose-save").addEventListener("click", saveComposed);
  $("compose-cancel").addEventListener("click", () => switchView("view-home"));

  const cached = await chrome.storage.local.get({ cached_notes: [] });
  if (cached.cached_notes.length && !state.notes.length) {
    state.notes = cached.cached_notes;
    renderFolders();
    renderList();
  }
  $("home-empty").textContent = "Загрузка…";
  await refreshAll();
  $("search").focus({ preventScroll: true });
}

document.addEventListener("DOMContentLoaded", init);
