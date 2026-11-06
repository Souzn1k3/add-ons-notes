/* Заметки: локальное приложение внутри попапа. Без сети и сторонних сервисов. */

import {
  loadNotes, saveNotes, loadSettings, saveSettings, cleanupLegacy,
  seedWelcomeIfNeeded, buildExport, validateImport, mergeNotes, makeId,
  DEFAULT_SETTINGS,
} from "./store.js";
import {
  esc, deriveTitle, previewText, countChecks, parseBody, toggleCheckLine,
  fmtDate, sortNotes, bytesOf, fmtBytes,
} from "./util.js";

const $ = (id) => document.getElementById(id);

const state = {
  notes: [],
  settings: { ...DEFAULT_SETTINGS },
  view: "home",
  currentId: null,
  query: "",
  editorReturn: "home",
  dirty: false,
  saveTimer: null,
  deleteArmedAt: 0,
  clearArmedAt: 0,
};

/* ---------- helpers ---------- */

const findNote = (id) => state.notes.find((n) => n.id === id);

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

function setSaveState(text) {
  $("save-state").textContent = text || "";
}

function applyAppearance() {
  const root = document.documentElement;
  root.dataset.accent = state.settings.accent;
  if (state.settings.theme === "auto") root.removeAttribute("data-theme");
  else root.dataset.theme = state.settings.theme;
}

function switchView(name) {
  state.view = name;
  for (const v of ["view-home", "view-reader", "view-editor"]) {
    $(v).classList.toggle("hidden", v !== name);
  }
}

/* ---------- домашний экран ---------- */

function noteCardHtml(n) {
  const title = deriveTitle(n);
  const preview = previewText(n);
  const checks = countChecks(n.body);
  const badge = checks.total
    ? `<span class="badge ${checks.done === checks.total ? "done" : ""}">${checks.done}/${checks.total}</span>`
    : "";
  return `
    <article class="note-card" data-id="${esc(n.id)}">
      <div class="t">${esc(title)}</div>
      <div class="p">${esc(preview)}</div>
      <div class="meta">
        <span>${fmtDate(n.updated)}</span>
        ${badge}
      </div>
      <button class="star-btn ${n.pinned ? "on" : ""}" data-pin="${esc(n.id)}" title="${n.pinned ? "Открепить" : "Закрепить"}" aria-label="Закрепить">
        <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>
      </button>
    </article>`;
}

function renderHome() {
  const box = $("notes-list");
  const q = state.query.trim().toLowerCase();
  let items = sortNotes(state.notes);
  if (q) {
    items = items.filter((n) =>
      deriveTitle(n).toLowerCase().includes(q) ||
      String(n.body || "").toLowerCase().includes(q));
  }
  if (!items.length) {
    box.innerHTML = `<div class="empty"><div class="big">🗒️</div>${
      q ? "Ничего не найдено" : "Заметок пока нет.<br>Нажми «+», чтобы создать первую."
    }</div>`;
    return;
  }
  const pinned = items.filter((n) => n.pinned);
  const rest = items.filter((n) => !n.pinned);
  let html = "";
  if (pinned.length) {
    html += `<div class="section-label">Закреплённые</div>` + pinned.map(noteCardHtml).join("");
  }
  if (rest.length) {
    if (pinned.length) html += `<div class="section-label">Все заметки</div>`;
    html += rest.map(noteCardHtml).join("");
  }
  box.innerHTML = html;

  for (const card of box.querySelectorAll(".note-card")) {
    card.addEventListener("click", () => openReader(card.dataset.id));
  }
  for (const star of box.querySelectorAll(".star-btn")) {
    star.addEventListener("click", (ev) => {
      ev.stopPropagation();
      togglePin(star.dataset.pin);
    });
  }
}

async function togglePin(id) {
  const n = findNote(id);
  if (!n) return;
  n.pinned = !n.pinned;
  n.updated = Date.now();
  await saveNotes(state.notes);
  renderHome();
  if (state.view === "reader" && state.currentId === id) renderReader(n);
}

/* ---------- просмотр ---------- */

function renderReader(note) {
  $("reader-title").textContent = deriveTitle(note);
  const checks = countChecks(note.body);
  $("reader-meta").innerHTML =
    `<span>Изменено: ${fmtDate(note.updated)}</span>` +
    (checks.total ? `<span>${checks.done} из ${checks.total} выполнено</span>` : "");
  const pinBtn = $("btn-read-pin");
  pinBtn.classList.toggle("pinned", !!note.pinned);
  pinBtn.title = note.pinned ? "Открепить" : "Закрепить";

  const body = $("reader-body");
  body.replaceChildren();
  const lines = parseBody(note.body || "");
  if (!lines.some((l) => l.type === "check" || l.text.trim())) {
    const d = document.createElement("div");
    d.className = "line";
    d.textContent = "Пустая заметка";
    d.style.color = "var(--text-hint)";
    body.appendChild(d);
    return;
  }
  for (const ln of lines) {
    if (ln.type === "check") {
      const label = document.createElement("label");
      label.className = "chk" + (ln.checked ? " done" : "");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = ln.checked;
      input.addEventListener("change", () => onToggleCheck(note.id, ln.line));
      const span = document.createElement("span");
      span.textContent = ln.text || "";
      label.append(input, span);
      body.appendChild(label);
    } else {
      const d = document.createElement("div");
      d.className = "line";
      d.textContent = ln.text;
      body.appendChild(d);
    }
  }
}

function openReader(id) {
  const n = findNote(id);
  if (!n) return;
  state.currentId = id;
  renderReader(n);
  switchView("view-reader");
}

async function onToggleCheck(id, lineIndex) {
  const n = findNote(id);
  if (!n) return;
  n.body = toggleCheckLine(n.body, lineIndex);
  n.updated = Date.now();
  await saveNotes(state.notes);
  renderReader(n);
}

/* ---------- редактор ---------- */

function openEditor(id) {
  const n = id ? findNote(id) : null;
  state.currentId = n ? n.id : null;
  state.dirty = false;
  state.editorReturn = state.view === "reader" ? "reader" : "home";
  $("editor-heading").textContent = n ? "Заметка" : "Новая заметка";
  $("edit-title").value = n ? n.title || "" : "";
  $("edit-body").value = n ? n.body || "" : "";
  setSaveState("");
  switchView("view-editor");
  setTimeout(() => (n ? $("edit-body") : $("edit-title")).focus(), 60);
}

function scheduleSave() {
  state.dirty = true;
  setSaveState("Сохранение…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushEditor, 350);
}

async function flushEditor() {
  if (state.view !== "view-editor" || !state.dirty) return;
  state.dirty = false;
  const title = $("edit-title").value;
  const body = $("edit-body").value;
  if (!title.trim() && !body.trim()) {
    setSaveState("");
    return; // пустой черновик не сохраняем
  }
  let note = state.currentId ? findNote(state.currentId) : null;
  const now = Date.now();
  if (!note) {
    note = { id: makeId(), title: "", body: "", pinned: false, created: now, updated: now };
    state.notes.push(note);
    state.currentId = note.id;
  }
  note.title = title;
  note.body = body;
  note.updated = now;
  await saveNotes(state.notes);
  setSaveState("Сохранено");
}

async function leaveEditor() {
  clearTimeout(state.saveTimer);
  await flushEditor();
  const note = state.currentId ? findNote(state.currentId) : null;
  if (!note) {
    switchView("view-home");
    renderHome();
    return;
  }
  if (state.editorReturn === "reader") {
    state.currentId = note.id;
    renderReader(note);
    switchView("view-reader");
  } else {
    switchView("view-home");
    renderHome();
  }
}

function insertChecklist() {
  const ta = $("edit-body");
  const pos = ta.selectionStart || 0;
  const before = ta.value.slice(0, pos);
  const after = ta.value.slice(ta.selectionEnd || pos);
  const lineStart = before.lastIndexOf("\n") + 1;
  const prefix = before.slice(lineStart);
  const already = /^[-*]\s+\[[ xX]\]/.test(prefix);
  let insert = "";
  let caretShift = 0;
  if (prefix.trim() === "" && !already) {
    insert = "- [ ] ";
    caretShift = insert.length;
  } else if (!already) {
    // переносим на новую строку
    insert = "\n- [ ] ";
    caretShift = insert.length;
  } else {
    toast("Здесь уже чек-лист");
    return;
  }
  ta.value = ta.value.slice(0, pos) + insert + ta.value.slice(pos);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = pos + caretShift;
  scheduleSave();
}

/* ---------- удаление ---------- */

function armDelete(button, action) {
  const now = Date.now();
  if (now - state.deleteArmedAt < 3000) {
    state.deleteArmedAt = 0;
    button.classList.remove("armed");
    action();
    return;
  }
  state.deleteArmedAt = now;
  toast("Нажмите «Удалить» ещё раз для подтверждения");
  button.classList.add("armed");
  setTimeout(() => button.classList.remove("armed"), 3000);
}

async function deleteCurrentNote() {
  const n = findNote(state.currentId);
  if (!n) return;
  state.notes = state.notes.filter((x) => x.id !== n.id);
  await saveNotes(state.notes);
  state.currentId = null;
  switchView("view-home");
  renderHome();
  toast("Заметка удалена");
}

/* ---------- настройки ---------- */

function renderSettingsUi() {
  for (const b of document.querySelectorAll("#theme-seg button")) {
    b.classList.toggle("on", b.dataset.theme === state.settings.theme);
  }
  for (const b of document.querySelectorAll("#accent-row button")) {
    b.classList.toggle("on", b.dataset.accent === state.settings.accent);
  }
  const size = bytesOf(state.notes);
  $("storage-info").textContent =
    `${state.notes.length} заметок · ${fmtBytes(size)} · хранится только в браузере`;
}

function openSettings() {
  renderSettingsUi();
  $("settings").classList.remove("hidden");
}

function closeSettings() {
  $("settings").classList.add("hidden");
}

function downloadExport() {
  const data = buildExport(state.notes, state.settings);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `notes-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("Экспорт: " + name);
}

async function importFile(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const incoming = validateImport(payload);
    const { notes, added, updated } = mergeNotes(state.notes, incoming);
    state.notes = notes;
    await saveNotes(state.notes);
    renderHome();
    renderSettingsUi();
    toast(`Импорт: добавлено ${added}, обновлено ${updated}`);
  } catch (e) {
    toast("Не удалось импортировать: " + e.message);
  }
}

/* ---------- инициализация ---------- */

async function init() {
  await cleanupLegacy();
  state.settings = await loadSettings();
  applyAppearance();
  await seedWelcomeIfNeeded();
  state.notes = await loadNotes();
  renderHome();
  switchView("view-home");

  $("btn-settings").addEventListener("click", openSettings);
  $("btn-settings-close").addEventListener("click", closeSettings);
  $("settings").addEventListener("click", (ev) => {
    if (ev.target === $("settings")) closeSettings();
  });

  $("search").addEventListener("input", (ev) => {
    state.query = ev.target.value;
    renderHome();
  });

  $("fab").addEventListener("click", () => openEditor(null));

  $("btn-read-back").addEventListener("click", () => {
    switchView("view-home");
    renderHome();
  });
  $("btn-read-pin").addEventListener("click", () => togglePin(state.currentId));
  $("btn-read-edit").addEventListener("click", () => openEditor(state.currentId));
  $("btn-read-delete").addEventListener("click", (ev) => {
    armDelete(ev.currentTarget, deleteCurrentNote);
  });

  $("btn-edit-back").addEventListener("click", leaveEditor);
  $("btn-insert-check").addEventListener("click", insertChecklist);
  for (const el of [$("edit-title"), $("edit-body")]) {
    el.addEventListener("input", scheduleSave);
  }

  for (const b of document.querySelectorAll("#theme-seg button")) {
    b.addEventListener("click", async () => {
      state.settings.theme = b.dataset.theme;
      applyAppearance();
      await saveSettings(state.settings);
      renderSettingsUi();
    });
  }
  for (const b of document.querySelectorAll("#accent-row button")) {
    b.addEventListener("click", async () => {
      state.settings.accent = b.dataset.accent;
      applyAppearance();
      await saveSettings(state.settings);
      renderSettingsUi();
    });
  }

  $("btn-export").addEventListener("click", downloadExport);
  $("btn-import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (file) await importFile(file);
  });
  $("btn-clear").addEventListener("click", (ev) => {
    armDelete(ev.currentTarget, async () => {
      state.notes = [];
      await saveNotes(state.notes);
      renderHome();
      renderSettingsUi();
      toast("Все заметки удалены");
    });
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!$("settings").classList.contains("hidden")) closeSettings();
    else if (state.view === "editor") leaveEditor();
    else if (state.view === "reader") {
      switchView("view-home");
      renderHome();
    }
  });

  const flushNow = () => {
    if (state.view === "editor" && state.dirty) {
      clearTimeout(state.saveTimer);
      flushEditor();
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
  window.addEventListener("pagehide", flushNow);
}

document.addEventListener("DOMContentLoaded", init);
