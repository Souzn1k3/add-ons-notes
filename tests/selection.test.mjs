import test from "node:test";
import assert from "node:assert/strict";

import { buildNoteFromSelection } from "../extension/popup/selectionNote.js";
import {
  loadNotes, upsertNote, deleteNoteById, clearNotes,
} from "../extension/popup/store.js";

test("buildNoteFromSelection: title and clickable source", () => {
  const now = 123;
  const note = buildNoteFromSelection({
    selectionText: "  Важный фрагмент  ",
    title: "Статья",
    pageUrl: "https://example.com/post",
  }, now);
  assert.equal(note.title, "Статья");
  assert.equal(note.body, "Важный фрагмент\n\nИсточник: [Статья](https://example.com/post)");
  assert.equal(note.pinned, false);
  assert.equal(note.created, now);
  assert.equal(note.updated, now);
  assert.ok(note.id);
});

test("buildNoteFromSelection: multiline, CRLF, fallback title", () => {
  const note = buildNoteFromSelection({
    selectionText: "Первая строка\r\nВторая строка\rТретья",
    title: "",
    pageUrl: "",
  });
  assert.equal(note.title, "Первая строка");
  assert.equal(note.body, "Первая строка\nВторая строка\nТретья");
});

test("buildNoteFromSelection: empty selection → null", () => {
  assert.equal(buildNoteFromSelection({ selectionText: "   \n\t " }), null);
  assert.equal(buildNoteFromSelection({}), null);
  assert.equal(buildNoteFromSelection(null), null);
});

test("buildNoteFromSelection: non-http page url → no source line", () => {
  const note = buildNoteFromSelection({
    selectionText: "текст", title: "T", pageUrl: "chrome://settings",
  });
  assert.equal(note.body, "текст");
});

test("buildNoteFromSelection: parentheses in URL → plain source line", () => {
  const note = buildNoteFromSelection({
    selectionText: "x",
    title: "Wiki",
    pageUrl: "https://en.wikipedia.org/wiki/Foo_(bar)",
  });
  assert.ok(note.body.includes("Источник: https://en.wikipedia.org/wiki/Foo_(bar)"));
  assert.ok(!note.body.includes("[Wiki]("));
});

test("buildNoteFromSelection: body length cap 20000", () => {
  const long = "а".repeat(30000);
  const note = buildNoteFromSelection({
    selectionText: long, title: "T", pageUrl: "https://e.com/x",
  });
  const textPart = note.body.split("\n\nИсточник:")[0];
  assert.equal(textPart.length, 20000);
  assert.ok(note.body.includes("\n\nИсточник: [T](https://e.com/x)"));
});

test("buildNoteFromSelection: brackets stripped from markdown label", () => {
  const note = buildNoteFromSelection({
    selectionText: "x", title: "A[B]C", pageUrl: "https://e.com",
  });
  assert.ok(note.body.includes("Источник: [ABC](https://e.com)"));
});

/* ---------- атомарные операции хранилища ---------- */

function makeChrome() {
  const store = new Map([["nb_notes_v1", []]]);
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
          for (const [k, v] of Object.entries(obj)) {
            store.set(k, JSON.parse(JSON.stringify(v)));
          }
        },
        async remove(keys) {
          for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        },
      },
    },
  };
  return store;
}

const baseNote = (id, title, updated) => ({
  id, title, body: "", pinned: false, created: updated, updated,
});

test("store: upsert adds and updates by id without losing others", async () => {
  makeChrome();
  await upsertNote(baseNote("a", "A", 1));
  await upsertNote(baseNote("b", "B", 2));
  let notes = await loadNotes();
  assert.deepEqual(notes.map((n) => n.id), ["a", "b"]);

  await upsertNote(baseNote("a", "A2", 3));
  notes = await loadNotes();
  assert.equal(notes.length, 2);
  assert.equal(notes.find((n) => n.id === "a").title, "A2");
});

test("store: deleteNoteById removes only target", async () => {
  makeChrome();
  await upsertNote(baseNote("a", "A", 1));
  await upsertNote(baseNote("b", "B", 2));
  await deleteNoteById("a");
  const notes = await loadNotes();
  assert.deepEqual(notes.map((n) => n.id), ["b"]);
});

test("store: clearNotes empties all", async () => {
  makeChrome();
  await upsertNote(baseNote("a", "A", 1));
  await clearNotes();
  assert.deepEqual(await loadNotes(), []);
});
