/* Фоновый обработчик: пункт «Добавить в браузерные заметки» в контекстном меню. */

import { buildNoteFromSelection } from "../popup/selectionNote.js";
import { upsertNote } from "../popup/store.js";

const MENU_ID = "nb-add-selection";
const MENU_TITLE = "Добавить в браузерные заметки";
const BADGE_TEXT = "✓";
const BADGE_COLOR = "#20925e";

/* chrome.contextMenus.create не принимает поле icons
   (в части сборок это синхронный TypeError) — создаём только валидные свойства. */
function createMenu() {
  if (!chrome.contextMenus || !chrome.contextMenus.create) return;
  try {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: MENU_TITLE,
      contexts: ["selection"],
    }, () => {
      // подавляем "Unchecked runtime.lastError" при дубликате id
      void chrome.runtime.lastError;
    });
  } catch (e) {
    console.warn("Не удалось создать пункт контекстного меню:", e);
  }
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
  if (chrome.contextMenus && chrome.contextMenus.removeAll) {
    chrome.contextMenus.removeAll(() => createMenu());
  } else {
    createMenu();
  }
});

chrome.runtime.onStartup.addListener(createMenu);

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
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
}

createMenu();
