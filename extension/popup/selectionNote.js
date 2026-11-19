/* Формирование заметки из выделенного фрагмента страницы (контекстное меню). */

import { sanitizeUrl } from "./util.js";
import { makeId } from "./store.js";

const MAX_BODY = 20000;
const MAX_TITLE = 120;

function collapse(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function isHttpUrl(raw) {
  const s = sanitizeUrl(raw);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  } catch (_) {
    return null;
  }
  return s;
}

export function buildNoteFromSelection(info, now = Date.now()) {
  const selection = String(info && info.selectionText ? info.selectionText : "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!selection) return null;

  const bodyText = selection.length > MAX_BODY ? selection.slice(0, MAX_BODY) : selection;

  const pageTitle = collapse(info && info.title ? info.title : "").slice(0, MAX_TITLE);
  let title = pageTitle;
  if (!title) {
    const firstLine = bodyText
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) || "";
    title = firstLine.slice(0, 80);
  }

  let body = bodyText;
  const pageUrl = isHttpUrl(info && info.pageUrl ? info.pageUrl : "");
  if (pageUrl) {
    const label = pageTitle.replace(/[[\]]/g, "");
    const markdownSafe = !/[()\s]/.test(pageUrl);
    if (label && markdownSafe) {
      body += `\n\nИсточник: [${label}](${pageUrl})`;
    } else {
      body += `\n\nИсточник: ${pageUrl}`;
    }
  }

  return {
    id: makeId(),
    title: title || "Без названия",
    body,
    pinned: false,
    created: now,
    updated: now,
  };
}
