/* Popup: список/поиск/чтение/создание/настройки. */

import {
  loadSettings, saveSettings, health, listNotes, getNote, createNote, setWriteback,
} from "./agent_api.js";

const $ = (id) => document.getElementById(id);
const PORT_MIN = 8712, PORT_MAX = 8719;

const state = {
  settings: { port: PORT_MIN, token: "", writeback: false },
  notes: [],      // в памяти — с полным text (если есть); в кэш пишется лёгкая версия
  folder: "",
  query: "",
  online: null,
  appRunning: false,
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

function setEmpty(message) {
  const el = $("home-empty");
  if (el) el.textContent = message;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
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
  if (state.online === null) {
    dot.className = "status-dot";
    txt.textContent = "Подключение…";
  } else if (state.online) {
    dot.className = "status-dot ok";
    txt.textContent = state.appRunning
      ? "Мост активен, синхронизация работает"
      : "Мост активен (Samsung Notes закрыт)";
  } else {
    dot.className = "status-dot err";
    txt.textContent = "Агент не запущен — agent\\install.bat";
  }
}

/* ---------- список ---------- */

function renderFolders() {
  const box = $("folders");
  const counts = {};
  const names = {};
  for (const n of state.notes) {
    if (!n.folder_uuid) continue;
    counts[n.folder_uuid] = (counts[n.folder_uuid] || 0) + 1;
    if (!names[n.folder_uuid]) names[n.folder_uuid] = n.folder_name || "Папка";
  }
  const chips = [{ uuid: "", name: "Все", count: state.notes.length }];
  for (const uuid of Object.keys(counts)) {
    chips.push({ uuid, name: names[uuid], count: counts[uuid] });
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
    return String(n.title || "").toLowerCase().includes(q) ||
      String(n.preview || "").toLowerCase().includes(q);
  });
}

const star = `<span class="fav"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg></span>`;

function renderList() {
  const box = $("notes-list");
  const items = filtered();
  if (!items.length) {
    box.innerHTML = `<div class="empty" id="home-empty">${
      state.notes.length ? "Ничего не найдено" : "Заметок нет"
    }</div>`;
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
    ? `${fmtDate(cached.modified_at)}${cached.folder_name ? " · " + esc(cached.folder_name) : ""}`
    : "";
  $("reader-body").textContent = cached && cached.text ? cached.text : "Загрузка…";
  switchView("view-reader");
  if (cached && cached.text) return; // текст уже есть
  try {
    const res = await getNote({ ...state.settings, uuid });
    const note = res.note || res;
    $("reader-title").textContent = note.title;
    $("reader-meta").innerHTML =
      `${fmtDate(note.modified_at)}${note.folder_name ? " · " + esc(note.folder_name) : ""}` +
      (note.document_type ? " · рукопись/рисунок (текст частично)" : "");
    $("reader-body").textContent = note.text || "Пустая заметка";
    if (cached) cached.text = note.text; // чтобы повторно не тянуть
  } catch (e) {
    if (cached && cached.preview) {
      $("reader-body").textContent = cached.preview;
    }
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
  if (!state.settings.token) {
    toast("Сначала настройте токен агента (Настройки)");
    return;
  }
  const btn = $("compose-save");
  btn.disabled = true;
  btn.textContent = "Сохранение…";
  try {
    const res = await createNote({ ...state.settings, title, body });
    $("compose-title").value = "";
    $("compose-text").value = "";
    switchView("view-home");
    btn.textContent = "Сохранить";
    btn.disabled = false;
    if (res && res.ok) {
      toast("Заметка создана в Samsung Notes");
    } else {
      toast("Заметка отправлена (проверьте список в приложении)");
    }
    // агент переиндексирует через ~2-3 c после автосохранения
    setTimeout(() => refreshAll(true), 3500);
  } catch (e) {
    btn.textContent = "Сохранить";
    btn.disabled = false;
    toast("Ошибка: " + e.message);
  }
}

/* ---------- синхронизация ---------- */

async function tryPort(port) {
  try {
    await health(port, state.settings.token);
    return true;
  } catch (_) {
    return false;
  }
}

async function autodetectPort() {
  // агент поднимается на 8712..8719; если сохранённый недоступен — сканируем
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (await tryPort(p)) {
      state.settings.port = p;
      await saveSettings({ port: p });
      return p;
    }
  }
  return null;
}

function toLight(n) {
  // без полного text — экономим квоту chrome.storage.local
  const { text, ...light } = n;
  return light;
}

async function fetchNotes(query = "") {
  const s = state.settings;
  const res = await listNotes({ ...s, query });
  return res.notes || [];
}

async function refreshAll(force = false) {
  const s = state.settings;
  if (!s.token) {
    state.online = false;
    renderStatus();
    setEmpty("Не указан токен агента — откройте настройки");
    return;
  }
  try {
    const h = await health(s.port, s.token);
    state.online = true;
    state.appRunning = !!h.app_running;
    renderStatus();
    state.notes = await fetchNotes(state.query);
    renderFolders();
    renderList();
    // кэш для офлайн-открытия попапа (лёгкая версия, без text)
    chrome.storage.local.set({
      cached_notes: state.notes.map(toLight),
      cached_at: Date.now(),
    }).catch(() => { /* квота — не критично */ });
  } catch (e) {
    // если порт не тот — пробуем найти агента на 8712-8719
    if (e.status !== 401) {
      const p = await autodetectPort();
      if (p) {
        try {
          const h = await health(p, s.token);
          state.online = true;
          state.appRunning = !!h.app_running;
          state.settings.port = p;
          renderStatus();
          state.notes = await fetchNotes(state.query);
          renderFolders();
          renderList();
          chrome.storage.local.set({
            cached_notes: state.notes.map(toLight),
            cached_at: Date.now(),
          }).catch(() => {});
          return;
        } catch (_) { /* упали в обычный офлайн-путь */ }
      }
    }
    state.online = false;
    renderStatus();
    const got = await chrome.storage.local.get({ cached_notes: [] });
    if (got.cached_notes.length) {
      state.notes = got.cached_notes;
      $("status-text").textContent = "Агент недоступен, показан локальный кэш";
      renderFolders();
      renderList();
    } else {
      setEmpty(e.status === 401
        ? "Неверный токен агента — сверьте token.txt в настройках"
        : "Запустите агента на ПК (agent\\install.bat)");
    }
  }
}

/* ---------- настройки ---------- */

function openSettings() {
  const s = state.settings;
  $("set-port").value = s.port;
  $("set-token").value = s.token;
  $("set-writeback").classList.toggle("on", !!s.writeback);
  $("settings-modal").classList.remove("hidden");
}

async function closeSettings() {
  const port = Math.max(PORT_MIN, Math.min(PORT_MAX,
    parseInt($("set-port").value, 10) || PORT_MIN));
  const token = $("set-token").value.trim();
  const writeback = $("set-writeback").classList.contains("on");
  await saveSettings({ port, token, writeback });
  state.settings = { ...state.settings, port, token, writeback };
  if (token) {
    try {
      await health(port, token);
    } catch (_) {
      const found = await autodetectPort();
      if (found) await saveSettings({ port: found });
    }
  }
  await setWriteback({
    ...state.settings, writeback,
  });
  $("settings-modal").classList.add("hidden");
  await refreshAll(true);
}

/* ---------- инициализация ---------- */

async function init() {
  state.settings = await loadSettings();

  $("btn-settings").addEventListener("click", openSettings);
  $("set-close").addEventListener("click", closeSettings);
  $("set-test").addEventListener("click", async () => {
    const port = parseInt($("set-port").value, 10) || PORT_MIN;
    const token = $("set-token").value.trim();
    try {
      const h = await health(port, token);
      toast(`Связь есть: ${h.notes} заметок${h.app_running ? ", приложение открыто" : ""}`);
    } catch (e) {
      toast("Нет связи: " + e.message);
    }
  });
  $("set-writeback").addEventListener("click", (ev) => {
    ev.currentTarget.classList.toggle("on");
  });
  $("settings-modal").addEventListener("click", (ev) => {
    if (ev.target === $("settings-modal")) $("set-close").click();
  });

  $("search").addEventListener("input", (ev) => {
    state.query = ev.target.value;
    renderList();
    // сетевой поиск — дебаунс, когда есть строка
    clearTimeout(state._qsTimer);
    state._qsTimer = setTimeout(async () => {
      if (state.online && state.query.trim()) {
        try {
          state.notes = await fetchNotes(state.query);
          renderFolders();
          renderList();
        } catch (_) { /* локальный фильтр уже работает */ }
      } else if (state.online && !state.query.trim()) {
        await refreshAll(true);
      }
    }, 350);
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
  if (cached.cached_notes.length) {
    state.notes = cached.cached_notes;
    renderFolders();
    renderList();
  } else {
    setEmpty("Загрузка…");
  }
  await refreshAll();
  $("search").focus({ preventScroll: true });
}

document.addEventListener("DOMContentLoaded", init);
