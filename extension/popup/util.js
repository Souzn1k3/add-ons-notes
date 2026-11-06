/* Чистые утилиты: рендер-помощники, чек-листы, даты. */

const CHECK_RE = /^([ \t]*)[-*]\s+\[([ xX])\]\s?(.*)$/;

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function deriveTitle(note) {
  const t = (note.title || "").trim();
  if (t) return t;
  for (const line of String(note.body || "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    const m = CHECK_RE.exec(s);
    const clean = (m ? m[3] : s.replace(/^[-*]\s*/, "")).trim();
    if (clean) return clean.slice(0, 80);
  }
  return "Без названия";
}

export function previewText(note) {
  const title = deriveTitle(note);
  const bytes = [];
  for (const line of String(note.body || "").split("\n")) {
    const m = CHECK_RE.exec(line);
    const clean = (m ? (m[2].trim() ? "☑ " : "☐ ") + m[3] : line).trim();
    if (!clean) continue;
    if (!note.title && clean === title) continue;
    if (clean === title) continue;
    bytes.push(clean);
    if (bytes.join(" ").length > 140) break;
  }
  return bytes.join(" ").slice(0, 160) || "Пустая заметка";
}

export function countChecks(body) {
  let done = 0, total = 0;
  for (const line of String(body || "").split("\n")) {
    const m = CHECK_RE.exec(line);
    if (!m) continue;
    total++;
    if (m[2].trim()) done++;
  }
  return { done, total };
}

export function parseBody(body) {
  const lines = String(body || "").split("\n");
  return lines.map((line, idx) => {
    const m = CHECK_RE.exec(line);
    if (!m) return { type: "text", text: line, line: idx };
    return {
      type: "check",
      checked: !!m[2].trim(),
      text: m[3],
      line: idx,
    };
  });
}

export function toggleCheckLine(body, lineIndex) {
  const lines = String(body || "").split("\n");
  const m = CHECK_RE.exec(lines[lineIndex] || "");
  if (!m) return body;
  lines[lineIndex] = `${m[1]}- [${m[2].trim() ? " " : "x"}]${m[3] ? " " + m[3] : ""}`;
  return lines.join("\n");
}

export function fmtDate(ms) {
  if (!ms) return "";
  const d = new Date(Number(ms));
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (same(d, yest)) return "вчера";
  if (d.getFullYear() === now.getFullYear()) {
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  }
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

export function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.updated || 0) - (a.updated || 0);
  });
}

export function bytesOf(obj) {
  try { return new Blob([JSON.stringify(obj)]).size; } catch (_) { return 0; }
}

export function fmtBytes(b) {
  if (b < 1024) return b + " Б";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " КБ";
  return (b / 1024 / 1024).toFixed(1) + " МБ";
}
