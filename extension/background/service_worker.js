/* Фоновый обработчик: пункт «Добавить в браузерные заметки» в контекстном меню. */

import { buildNoteFromSelection } from "../popup/selectionNote.js";
import { upsertNote } from "../popup/store.js";

const MENU_ID = "nb-add-selection";
const MENU_TITLE = "Добавить в браузерные заметки";
const BADGE_TEXT = "✓";
const BADGE_COLOR = "#20925e";

function createMenu(withIcon = true) {
  const props = {
    id: MENU_ID,
    title: MENU_TITLE,
    contexts: ["selection"],
  };
  if (withIcon) {
    props.icons = { "16": chrome.runtime.getURL("icons/icon16.png") };
  }
  chrome.contextMenus.create(props, () => {
    const err = chrome.runtime.lastError;
    if (err && withIcon) {
      // некоторые сборки не принимают иконку — пересоздаём без неё
      createMenu(false);
    }
  });
}

function showBadge() {
  try {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    chrome.action.setBadgeText({ text: BADGE_TEXT });
    setTimeout(() => {
      try { chrome.action.setBadgeText({ text: "" }); } catch (_) { /* ignore */ }
    }, 2200);
  } catch (_) {
    /* бейдж может быть недоступен — не критично */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => createMenu());
});

chrome.runtime.onStartup.addListener(() => createMenu());

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  try {
    const note = buildNoteFromSelection(info);
    if (!note) return;
    await upsertNote(note);
    showBadge();
  } catch (e) {
    console.error("Не удалось сохранить фрагмент в заметки:", e);
  }
});

createMenu();
