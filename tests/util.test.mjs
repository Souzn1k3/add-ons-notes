import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveTitle, previewText, countChecks, parseBody, toggleCheckLine,
  sortNotes, fmtDate,
} from "../extension/popup/util.js";
import {
  validateImport, mergeNotes, makeId, saveNotes,
  saveDraft, loadDraft, clearDraft,
} from "../extension/popup/store.js";

/* ---------- mock chrome.storage.local ---------- */

function makeChrome({ failSetTimes = 0 } = {}) {
  const store = new Map();
  let setCalls = 0;
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          const out = {};
          for (const [k, v] of Object.entries(defaults || {})) {
            out[k] = store.has(k) ? store.get(k) : v;
          }
          return out;
        },
        async set(obj) {
          setCalls++;
          if (setCalls <= failSetTimes) throw new Error("QUOTA_BYTES quota exceeded");
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        async remove(keys) {
          for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        },
      },
    },
  };
  return store;
}

/* ---------- util ---------- */

test("deriveTitle: title, first line, checklist, fallback", () => {
  assert.equal(deriveTitle({ title: "  ", body: "Первая строка\nвторая" }), "Первая строка");
  assert.equal(deriveTitle({ title: "Заголовок", body: "текст" }), "Заголовок");
  assert.equal(deriveTitle({ title: "", body: "- [ ] купить хлеб" }), "купить хлеб");
  assert.equal(deriveTitle({ title: "", body: "" }), "Без названия");
});

test("countChecks counts done/total", () => {
  assert.deepEqual(countChecks("- [ ] a\n- [x] b\n- [X] c\nтекст"), { done: 2, total: 3 });
  assert.deepEqual(countChecks(""), { done: 0, total: 0 });
});

test("parseBody maps lines with original line indexes", () => {
  const pb = parseBody("привет\n- [ ] задача\n- [x] готово");
  assert.equal(pb[0].type, "text");
  assert.equal(pb[1].type, "check");
  assert.equal(pb[1].checked, false);
  assert.equal(pb[2].checked, true);
  assert.equal(pb[2].line, 2);
});

test("toggleCheckLine toggles state and preserves bullet marker", () => {
  let body = "a\n- [ ] задача\nb";
  body = toggleCheckLine(body, 1);
  assert.equal(body, "a\n- [x] задача\nb");
  body = toggleCheckLine(body, 1);
  assert.equal(body, "a\n- [ ] задача\nb");

  let star = "* [ ] звезда";
  star = toggleCheckLine(star, 0);
  assert.equal(star, "* [x] звезда");
  star = toggleCheckLine(star, 0);
  assert.equal(star, "* [ ] звезда");
});

test("previewText skips title line and renders checks", () => {
  const pv = previewText({ title: "", body: "Заголовок\n- [x] дело\nтекст заметки" });
  assert.ok(!pv.includes("Заголовок"));
  assert.ok(pv.includes("☑ дело"));
  assert.ok(pv.includes("текст заметки"));
});

test("sortNotes: pinned first, then newest", () => {
  const sorted = sortNotes([
    { id: "a", pinned: false, updated: 10 },
    { id: "b", pinned: true, updated: 5 },
    { id: "c", pinned: false, updated: 20 },
  ]);
  assert.deepEqual(sorted.map((n) => n.id), ["b", "c", "a"]);
});

test("fmtDate: today is HH:MM", () => {
  assert.match(fmtDate(Date.now()), /^\d{2}:\d{2}$/);
  assert.equal(fmtDate(0), "");
});

/* ---------- store: import/merge ---------- */

test("validateImport accepts array and {notes}, coerces types", () => {
  const a = validateImport([{ id: "x", title: "T", body: "B", updated: 5 }]);
  assert.equal(a.length, 1);
  assert.equal(a[0].pinned, false);
  const b = validateImport({ notes: [{ title: 5, body: null }] });
  assert.equal(b[0].title, "");
  assert.equal(b[0].body, "");
  assert.throws(() => validateImport({ foo: 1 }), /нет списка заметок/);
});

test("mergeNotes: add, update newer, ignore older", () => {
  const base = [{ id: "x", title: "old", body: "", updated: 50, pinned: false, created: 1 }];
  const r1 = mergeNotes(base, [{ id: "x", title: "new", body: "B", updated: 100, pinned: false, created: 1 }]);
  assert.equal(r1.updated, 1);
  assert.equal(r1.notes[0].title, "new");
  const r2 = mergeNotes(base, [{ id: "x", title: "older", body: "", updated: 10, pinned: false, created: 1 }]);
  assert.equal(r2.updated, 0);
  assert.equal(r2.notes[0].title, "old");
  const r3 = mergeNotes(base, [{ id: "y", title: "Y", body: "", updated: 1, pinned: false, created: 1 }]);
  assert.equal(r3.added, 1);
});

test("makeId is unique", () => {
  assert.notEqual(makeId(), makeId());
});

/* ---------- store: устойчивость записи ---------- */

test("saveNotes propagates write errors and keeps the queue alive", async () => {
  makeChrome({ failSetTimes: 1 });
  await assert.rejects(saveNotes([{ id: "a", title: "", body: "" }]), /quota/i);
  await assert.doesNotReject(saveNotes([{ id: "b", title: "", body: "" }]));
});

test("draft roundtrip via storage", async () => {
  makeChrome();
  await saveDraft({ id: null, title: "t", body: "b", ts: 123 });
  const d = await loadDraft();
  assert.equal(d.title, "t");
  assert.equal(d.ts, 123);
  await clearDraft();
  assert.equal(await loadDraft(), null);
});
