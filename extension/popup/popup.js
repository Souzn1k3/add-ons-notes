/* Заметки: локальное приложение внутри попапа. Без сети и сторонних сервисов. */

import {
  loadNotes, upsertNote, deleteNoteById, clearNotes, mergeImportNotes,
  loadSettings, saveSettings, cleanupLegacy,
  seedWelcomeIfNeeded, buildExport, validateImport, makeId,
  saveDraft, loadDraft, clearDraft,
  DEFAULT_SETTINGS,
} from "./store.js";
import {
  esc, deriveTitle, previewText, countChecks, parseBody, toggleCheckLine,
  fmtDate, sortNotes, bytesOf, fmtBytes, sanitizeUrl, tokenizeLine,
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
  armed: { kind: "", at: 0 },
  linkRange: null,
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

/* ---------- ссылки ---------- */

const COPY_SVG = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

function openExternal(rawUrl) {
  const url = sanitizeUrl(rawUrl);
  if (!url) return;
  try {
    if (chrome && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
      window.close();
      return;
    }
  } catch (_) { /* падаем в window.open */ }
  try {
    window.open(url, "_blank", "noopener");
  } catch (_) { /* ignore */ }
}

async function copyLink(rawUrl) {
  const url = sanitizeUrl(rawUrl);
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast("Ссылка скопирована");
    return;
  } catch (_) { /* fallback ниже */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("Ссылка скопирована");
  } catch (_) {
    toast("Не удалось скопировать");
  }
}

function appendRichText(container, text) {
  for (const tk of tokenizeLine(text)) {
    if (tk.type !== "link") {
      container.appendChild(document.createTextNode(tk.text));
      continue;
    }
    const wrap = document.createElement("span");
    wrap.className = "link-wrap";
    const a = document.createElement("a");
    a.className = "link";
    a.href = tk.href;
    a.textContent = tk.text;
    a.title = tk.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      openExternal(tk.href);
    });
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.title = "Копировать ссылку";
    btn.setAttribute("aria-label", "Копировать ссылку");
    btn.innerHTML = COPY_SVG;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      copyLink(tk.href);
    });
    wrap.append(a, btn);
    container.appendChild(wrap);
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
  try {
    await upsertNote(n);
  } catch (e) {
    n.pinned = !n.pinned;
    toast("Не удалось сохранить: " + (e && e.message ? e.message : "ошибка хранилища"));
    return;
  }
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
      input.addEventListener("change", () => {
        onToggleCheck(note.id, ln.line, input.checked, label);
      });
      const span = document.createElement("span");
      appendRichText(span, ln.text || "");
      label.append(input, span);
      body.appendChild(label);
    } else {
      const d = document.createElement("div");
      d.className = "line";
      appendRichText(d, ln.text);
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

async function onToggleCheck(id, lineIndex, checked, labelEl) {
  const n = findNote(id);
  if (!n) return;
  const prevBody = n.body;
  const prevUpdated = n.updated;
  n.body = toggleCheckLine(n.body, lineIndex);
  n.updated = Date.now();
  try {
    await upsertNote(n);
  } catch (e) {
    n.body = prevBody;
    n.updated = prevUpdated;
    toast("Не удалось сохранить: " + (e && e.message ? e.message : "ошибка хранилища"));
    return;
  }
  if (labelEl) labelEl.classList.toggle("done", !!checked);
  const checks = countChecks(n.body);
  $("reader-meta").innerHTML =
    `<span>Изменено: ${fmtDate(n.updated)}</span>` +
    (checks.total ? `<span>${checks.done} из ${checks.total} выполнено</span>` : "");
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
  saveDraftNow();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushEditor, 350);
}

function saveDraftNow() {
  if (state.view !== "view-editor") return;
  const title = $("edit-title").value;
  const body = $("edit-body").value;
  if (!title.trim() && !body.trim() && !state.currentId) return;
  saveDraft({ id: state.currentId || null, title, body, ts: Date.now() });
}

async function flushEditor() {
  if (state.view !== "view-editor" || !state.dirty) return true;
  state.dirty = false;
  const title = $("edit-title").value;
  const body = $("edit-body").value;
  const isNew = !state.currentId;
  if (isNew && !title.trim() && !body.trim()) {
    setSaveState("");
    return true; // пустой черновик не сохраняем
  }
  let note = state.currentId ? findNote(state.currentId) : null;
  const now = Date.now();
  if (!note) {
    note = { id: makeId(), title: "", body: "", pinned: false, created: now, updated: now };
    state.notes.push(note);
    state.currentId = note.id;
    $("editor-heading").textContent = "Заметка";
  }
  note.title = title;
  note.body = body;
  note.updated = now;
  try {
    await upsertNote(note);
    await clearDraft();
    setSaveState("Сохранено");
    return true;
  } catch (e) {
    state.dirty = true; // следующая попытка при вводе/выходе
    setSaveState("⚠ Не сохранено");
    toast("Не удалось сохранить: " + (e && e.message ? e.message : "ошибка хранилища"));
    return false;
  }
}

async function leaveEditor() {
  clearTimeout(state.saveTimer);
  const ok = await flushEditor();
  if (!ok) return; // не выпускаем с несохранёнными данными
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

/* ---------- мини-диалог вставки ссылки ---------- */

function openLinkDialog() {
  const ta = $("edit-body");
  state.linkRange = { start: ta.selectionStart || 0, end: ta.selectionEnd || 0 };
  const selected = ta.value.slice(state.linkRange.start, state.linkRange.end)
    .replace(/\n/g, " ").trim();
  $("link-label").value = selected;
  $("link-url").value = "";
  $("link-dialog").classList.remove("hidden");
  setTimeout(() => {
    ($("link-label").value ? $("link-url") : $("link-label")).focus();
  }, 50);
}

function closeLinkDialog() {
  $("link-dialog").classList.add("hidden");
  if (state.view === "view-editor") $("edit-body").focus();
}

function insertLinkFromDialog() {
  const label = $("link-label").value.trim().replace(/[[\]]/g, "");
  const url = sanitizeUrl($("link-url").value.trim());
  if (!url) {
    toast("Некорректная ссылка: нужен http(s)://, www. или mailto:");
    $("link-url").focus();
    return;
  }
  const ta = $("edit-body");
  const range = state.linkRange || { start: ta.selectionStart || 0, end: ta.selectionEnd || 0 };
  const start = Math.max(0, Math.min(range.start, ta.value.length));
  const end = Math.max(start, Math.min(range.end, ta.value.length));
  const inserted = label ? `[${label}](${url})` : url;
  const needSpace = start > 0 && !/\s/.test(ta.value[start - 1]) && !/^\s/.test(inserted);
  const actual = needSpace ? " " + inserted : inserted;
  ta.value = ta.value.slice(0, start) + actual + ta.value.slice(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + actual.length;
  closeLinkDialog();
  scheduleSave();
}

/* ---------- удаление ---------- */

function armDelete(button, action, kind, label) {
  const now = Date.now();
  if (state.armed.kind === kind && now - state.armed.at < 3000) {
    state.armed = { kind: "", at: 0 };
    button.classList.remove("armed");
    action();
    return;
  }
  state.armed = { kind, at: now };
  toast(label || "Нажмите кнопку ещё раз для подтверждения");
  button.classList.add("armed");
  setTimeout(() => button.classList.remove("armed"), 3000);
}

async function deleteCurrentNote() {
  const n = findNote(state.currentId);
  if (!n) return;
  try {
    await deleteNoteById(n.id);
  } catch (e) {
    toast("Не удалось удалить: " + (e && e.message ? e.message : "ошибка хранилища"));
    return;
  }
  state.notes = state.notes.filter((x) => x.id !== n.id);
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

/* Резервный путь экспорта: JSON в буфер обмена (если скачивание
   в конкретной сборке браузера не сработало). */
async function copyExportJson() {
  if (!state.notes.length) {
    toast("Заметок нет — нечего копировать");
    return;
  }
  const text = JSON.stringify(buildExport(state.notes, state.settings), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast("JSON скопирован в буфер (" + fmtBytes(new Blob([text]).size) + ")");
    return;
  } catch (_) { /* fallback ниже */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("JSON скопирован в буфер");
  } catch (_) {
    toast("Не удалось скопировать — используй «Экспорт заметок (JSON)»");
  }
}

async function importFile(file) {
  if (file.size > 25 * 1024 * 1024) {
    toast("Файл слишком большой — лимит импорта 25 МБ");
    return;
  }
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const incoming = validateImport(payload);
    const { notes, added, updated } = await mergeImportNotes(incoming);
    state.notes = notes;
    renderHome();
    renderSettingsUi();
    toast(`Импорт: добавлено ${added}, обновлено ${updated}`);
  } catch (e) {
    toast("Не удалось импортировать: " + e.message);
  }
}

/* ---------- восстановление черновика ---------- */

async function recoverDraft() {
  const draft = await loadDraft();
  if (!draft) return;
  const hasText = String(draft.title || "").trim() || String(draft.body || "").trim();
  if (!hasText) {
    await clearDraft();
    return;
  }
  const now = Date.now();
  try {
    if (draft.id) {
      const n = findNote(draft.id);
      if (n) {
        if ((draft.ts || 0) > (n.updated || 0)) {
          n.title = draft.title || "";
          n.body = draft.body || "";
          n.updated = now;
          await upsertNote(n);
          toast("Восстановлены несохранённые изменения");
        }
      } else {
        const note = {
          id: draft.id, title: draft.title || "", body: draft.body || "",
          pinned: false, created: now, updated: now,
        };
        state.notes.push(note);
        await upsertNote(note);
        toast("Восстановлена несохранённая заметка");
      }
    } else {
      const note = {
        id: makeId(), title: draft.title || "", body: draft.body || "",
        pinned: false, created: now, updated: now,
      };
      state.notes.push(note);
      await upsertNote(note);
      toast("Восстановлена несохранённая заметка");
    }
    await clearDraft();
  } catch (_) {
    /* сохранить не удалось — черновик оставляем до следующего запуска */
  }
}

/* ---------- инициализация ---------- */

async function init() {
  await cleanupLegacy();
  state.settings = await loadSettings();
  applyAppearance();
  await seedWelcomeIfNeeded();
  state.notes = await loadNotes();
  await recoverDraft();
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
    armDelete(ev.currentTarget, deleteCurrentNote, "note", "Нажмите «Удалить» ещё раз для подтверждения");
  });

  $("btn-edit-back").addEventListener("click", leaveEditor);
  $("btn-insert-check").addEventListener("click", insertChecklist);
  $("btn-insert-link").addEventListener("click", openLinkDialog);
  $("link-insert").addEventListener("click", insertLinkFromDialog);
  $("link-cancel").addEventListener("click", closeLinkDialog);
  $("link-dialog").addEventListener("click", (ev) => {
    if (ev.target === $("link-dialog")) closeLinkDialog();
  });
  $("link-url").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      insertLinkFromDialog();
    }
  });
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
  $("btn-copy-json").addEventListener("click", copyExportJson);
  $("btn-import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (file) await importFile(file);
  });
  $("btn-clear").addEventListener("click", (ev) => {
    armDelete(ev.currentTarget, async () => {
      try {
        await clearNotes();
        await clearDraft();
      } catch (e) {
        toast("Не удалось очистить: " + (e && e.message ? e.message : "ошибка хранилища"));
        return;
      }
      state.notes = [];
      renderHome();
      renderSettingsUi();
      toast("Все заметки удалены");
    }, "clear", "Нажмите «Удалить все заметки» ещё раз для подтверждения");
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!$("link-dialog").classList.contains("hidden")) closeLinkDialog();
    else if (!$("settings").classList.contains("hidden")) closeSettings();
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

  // Внешние изменения (пункт контекстного меню) — подхватываем без потери правок
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes["nb_notes_v1"]) return;
    const fresh = await loadNotes();
    if (JSON.stringify(fresh) === JSON.stringify(state.notes)) return;
    if (state.view === "view-editor") {
      const cur = state.currentId ? findNote(state.currentId) : null;
      const merged = fresh.map((n) => (cur && n.id === cur.id && state.dirty ? cur : n));
      if (cur && state.dirty && !merged.some((n) => n.id === cur.id)) merged.push(cur);
      state.notes = merged;
    } else {
      state.notes = fresh;
    }
    if (state.view === "view-home") renderHome();
    if (state.view === "view-reader" && state.currentId) {
      const n = findNote(state.currentId);
      if (n) renderReader(n);
    }
  });

  // Бейдж «✓» мог остаться от контекстного меню — гасим при открытии попапа
  try { chrome.action.setBadgeText({ text: "" }); } catch (_) { /* ignore */ }
}

document.addEventListener("DOMContentLoaded", init);
