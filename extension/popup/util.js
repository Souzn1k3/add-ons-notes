/* Чистые утилиты: рендер-помощники, чек-листы, ссылки, даты. */

const CHECK_RE = /^([ \t]*)[-*]\s+\[([ xX])\]\s?(.*)$/;
const MD_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi;
const BARE_URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/* Убираем хвостовую пунктуацию и несбалансированные скобки у «сырого» URL. */
function trimUrlTail(raw) {
  let s = raw;
  while (/[.,;:!?…»"'“”\]]$/.test(s)) s = s.slice(0, -1);
  let extra = (s.match(/\)/g) || []).length - (s.match(/\(/g) || []).length;
  while (extra > 0 && s.endsWith(")")) {
    s = s.slice(0, -1);
    extra--;
  }
  return s;
}

/* Разрешённые схемы: http, https, mailto. www. → https://. Иначе null. */
export function sanitizeUrl(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (/^www\./i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  const proto = u.protocol.toLowerCase();
  if (proto !== "http:" && proto !== "https:" && proto !== "mailto:") return null;
  if (proto === "mailto:" && !u.pathname.trim()) return null;
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

function linkifyText(text) {
  const out = [];
  const re = new RegExp(BARE_URL_RE.source, "gi");
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    const raw = trimUrlTail(m[0]);
    const href = raw ? sanitizeUrl(raw) : null;
    if (href) out.push({ type: "link", text: raw, href });
    else if (raw) out.push({ type: "text", text: raw });
    const tail = m[0].slice(raw.length);
    if (tail) out.push({ type: "text", text: tail });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/* Разбивает строку на токены: текст и ссылки (markdown + авто-URL). */
export function tokenizeLine(text) {
  const s = String(text == null ? "" : text);
  if (!s) return [];
  const tokens = [];
  const md = new RegExp(MD_LINK_RE.source, "gi");
  let pos = 0;
  let m;
  while ((m = md.exec(s))) {
    if (m.index > pos) tokens.push(...linkifyText(s.slice(pos, m.index)));
    const href = sanitizeUrl(m[2]);
    if (href) {
      const label = (m[1] || "").trim() || href;
      tokens.push({ type: "link", text: label, href });
    } else {
      tokens.push({ type: "text", text: m[0] });
    }
    pos = m.index + m[0].length;
  }
  if (pos < s.length) tokens.push(...linkifyText(s.slice(pos)));
  return tokens;
}

/* Только текст ссылки — чтобы в заголовке/превью не было сырого markdown. */
export function stripMarkdownLinks(text) {
  return String(text == null ? "" : text).replace(
    new RegExp(MD_LINK_RE.source, "gi"),
    (all, label) => label || all,
  );
}

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
    const clean = stripMarkdownLinks(m ? m[3] : s.replace(/^[-*]\s*/, "")).trim();
    if (clean) return clean.slice(0, 80);
  }
  return "Без названия";
}

export function previewText(note) {
  const title = deriveTitle(note);
  const bytes = [];
  for (const line of String(note.body || "").split("\n")) {
    const m = CHECK_RE.exec(line);
    const clean = stripMarkdownLinks(
      m ? (m[2].trim() ? "☑ " : "☐ ") + m[3] : line,
    ).trim();
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
  const line = lines[lineIndex] || "";
  const m = CHECK_RE.exec(line);
  if (!m) return body;
  const bullet = (line.match(/^[ \t]*([-*])/) || [null, "-"])[1];
  lines[lineIndex] = `${m[1]}${bullet} [${m[2].trim() ? " " : "x"}]${m[3] ? " " + m[3] : ""}`;
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
