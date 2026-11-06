# -*- coding: utf-8 -*-
"""Чтение локальной базы Samsung Notes (Storage.sqlite + wdoc).

Только чтение. Копирует БД во временный файл перед открытием,
чтобы не конфликтовать с работающим приложением.
"""

import glob
import json
import os
import shutil
import sqlite3
import tempfile

APP_DIR_NAME = "SBNAgent"


def find_localstate():
    """Автоматически находит LocalState приложения Samsung Notes."""
    pattern = os.path.join(os.environ["LOCALAPPDATA"], "Packages", "*SamsungNotes*")
    for pkg in sorted(glob.glob(pattern)):
        cand = os.path.join(pkg, "LocalState")
        if os.path.isfile(os.path.join(cand, "Storage.sqlite")):
            return cand
    return None


def state_dir():
    d = os.path.join(os.environ["LOCALAPPDATA"], APP_DIR_NAME)
    os.makedirs(d, exist_ok=True)
    return d


def _note_state_dir():
    d = os.path.join(state_dir(), "tmp")
    os.makedirs(d, exist_ok=True)
    return d


class SbnIndex:
    """Индекс заметок + lazy-обновление по mtime."""

    def __init__(self, localstate: str):
        self.localstate = localstate
        self.storage = os.path.join(localstate, "Storage.sqlite")
        self.wdoc = os.path.join(localstate, "wdoc")
        self._wdoc_mtimes = {}
        self._db_mtime = 0.0
        self.notes = []          # list[dict]
        self.folders = {}        # uuid -> {"name":..., "parent":...}
        self.by_uuid = {}
        self.last_indexed = None

    # ---------- снятие копии БД ----------

    def _copy_db(self) -> str:
        dst = os.path.join(_note_state_dir(), "storage_copy.sqlite")
        shutil.copy2(self.storage, dst)
        return dst

    # ---------- индексирование ----------

    def _changed(self) -> bool:
        try:
            dbm = os.path.getmtime(self.storage)
        except OSError:
            return False
        changed = dbm != self._db_mtime
        self._db_mtime = dbm
        if os.path.isdir(self.wdoc):
            for name in os.listdir(self.wdoc):
                d = os.path.join(self.wdoc, name)
                if not os.path.isdir(d):
                    continue
                try:
                    m = os.path.getmtime(d)
                except OSError:
                    continue
                if self._wdoc_mtimes.get(name) != m:
                    changed = True
                    self._wdoc_mtimes[name] = m
        return changed

    def refresh(self, force: bool = False) -> bool:
        """Перестраивает индекс при изменениях. Возвращает True, если менялось."""
        if not force and not self._changed():
            return False
        self._load()
        self.last_indexed = time_now_ms()
        return True

    def _load(self):
        db_copy = self._copy_db()
        try:
            con = sqlite3.connect(db_copy)
            con.row_factory = sqlite3.Row
            self.folders = self._load_folders(con)
            self.notes = self._load_notes(con)
            con.close()
        finally:
            try:
                os.remove(db_copy)
            except OSError:
                pass
        self.by_uuid = {n["uuid"]: n for n in self.notes}

    def _load_folders(self, con) -> dict:
        out = {}
        try:
            rows = con.execute(
                "SELECT UUID, ParentUUID, DisplayName, IsDeleted FROM CategoryTreeDB"
            ).fetchall()
        except sqlite3.Error:
            return out
        for r in rows:
            name = (r["DisplayName"] or "").replace("\u200b", "").strip()
            out[r["UUID"]] = {
                "uuid": r["UUID"],
                "name": name or "(без названия)",
                "parent": r["ParentUUID"] or "",
                "is_deleted": bool(r["IsDeleted"]),
            }
        # виртуальные корни не должны попадать в UI как "папки"
        for special in ("uncategorized:///", "trash:///", "old:///", "UUID_UNCATEGORIZED"):
            if special in out:
                out[special]["special"] = True
        return out

    def _load_notes(self, con) -> list:
        sql = (
            "SELECT Id, UUID, CategoryUUID, DocumentType, Title, RecommendedTitle,"
            " StrippedTitle, DeletedStatus, IsLocked, IsTextOnly, IsFavorite,"
            " CreatedAt, LastModifiedAt, Size, PageType, ThemeMode,"
            " DisplayContent, StrokeTextContents, InsertedTextboxContents,"
            " PDFTextContents"
        )
        try:
            rows = con.execute(sql + " FROM NoteDB").fetchall()
        except sqlite3.Error:
            return []
        notes = []
        for r in rows:
            uuid = r["UUID"] or ""
            if not uuid:
                continue
            locked = bool(r["IsLocked"])
            deleted = (r["DeletedStatus"] or 0) != 0
            title = (r["Title"] or "").strip()
            if not title:
                title = (r["RecommendedTitle"] or "").strip()
            if not title:
                title = (r["StrippedTitle"] or "").strip()
            text, bullets, checkbox = "", False, False
            if not locked and not deleted:
                text, bullets, checkbox = extract_text(r["DisplayContent"])
                if not text:
                    text = extract_text(r["StrokeTextContents"])[0]
                if not text:
                    text = extract_text(r["PDFTextContents"])[0]
            if not title and text:
                title = text.split("\n", 1)[0][:80]
            folder_uuid = r["CategoryUUID"] or ""
            folder = self.folders.get(folder_uuid)
            if folder and folder.get("special"):
                folder_name = ""  # uncategorized/корзина не показываем как папку
            else:
                folder_name = (folder or {}).get("name", "")
            notes.append({
                "uuid": uuid,
                "title": title or "Без названия",
                "folder_uuid": folder_uuid if not (folder and folder.get("special")) else "",
                "folder_name": folder_name,
                "is_locked": locked,
                "deleted": deleted,
                "text_only": bool(r["IsTextOnly"]),
                "favorite": bool(r["IsFavorite"]),
                "document_type": r["DocumentType"] or 0,
                "created_at": r["CreatedAt"] or 0,
                "modified_at": r["LastModifiedAt"] or 0,
                "size": r["Size"] or 0,
                "text": text,
                "preview": text[:160].replace("\n", " ").strip(),
                "has_bullets": bullets,
                "has_checkbox": checkbox,
                "media_count": self._media_count(uuid),
                "source": "samsung",
            })
        notes.sort(key=lambda n: (not n["favorite"], -n["modified_at"]))
        return notes

    def _media_count(self, uuid: str) -> int:
        media = os.path.join(self.wdoc, uuid, "media")
        try:
            return len([f for f in os.listdir(media)
                        if os.path.isfile(os.path.join(media, f))])
        except OSError:
            return 0

    # ---------- публичные выборки ----------

    def list_notes(self, query="", folder="", limit=200, include_trash=False):
        q = (query or "").strip().lower()
        res = []
        for n in self.notes:
            if n["deleted"] and not include_trash:
                continue
            if folder and n["folder_uuid"] != folder:
                continue
            if q and (q not in n["title"].lower() and q not in n["text"].lower()):
                continue
            res.append(n)
        if limit:
            res = res[:limit]
        # /notes не отправляет полный текст (экономия трафика и кэша);
        # полный текст доступен только через /note/<uuid>
        return [{k: v for k, v in n.items() if k != "text"} for n in res]

    def get_note(self, uuid: str):
        n = self.by_uuid.get(uuid)
        if not n:
            return None
        out = dict(n)
        out["media"] = self._media_list(uuid)
        return out

    def list_folders(self):
        f = [v for v in self.folders.values()
             if not v["is_deleted"] and not v["uuid"].endswith(":///")]
        f.sort(key=lambda x: x["name"].lower())
        count = {}
        for n in self.notes:
            count[n["folder_uuid"]] = count.get(n["folder_uuid"], 0) + 1
        return count

    def _media_list(self, uuid: str):
        media = os.path.join(self.wdoc, uuid, "media")
        out = []
        try:
            for f in sorted(os.listdir(media)):
                fp = os.path.join(media, f)
                if os.path.isfile(fp):
                    out.append({"name": f, "size": os.path.getsize(fp)})
        except OSError:
            pass
        return out

    def media_path(self, uuid: str, name: str):
        media = os.path.join(self.wdoc, uuid, "media")
        cand = os.path.abspath(os.path.join(media, name))
        if not cand.startswith(os.path.abspath(media) + os.sep):
            return None
        if not os.path.isfile(cand):
            return None
        return cand


# ---------- разбор DisplayContent ----------

def extract_text(display_content) -> tuple:
    """Возвращает (текст, есть_буллеты, есть_чекбоксы)."""
    if not display_content:
        return "", False, False
    if isinstance(display_content, bytes):
        display_content = display_content.decode("utf-8", errors="replace")
    try:
        j = json.loads(display_content)
    except (ValueError, TypeError):
        return "", False, False
    if not isinstance(j, dict):
        return str(j), False, False
    text = j.get("Text", "")
    spans = (j.get("Spans") or {}).get("$values") or []
    lines = text.split("\n")
    line_starts = []
    pos = 0
    for ln in lines:
        line_starts.append(pos)
        pos += len(ln) + 1
    prefixes = {}
    has_bullets = has_checkbox = False
    for sp in spans:
        if not isinstance(sp, dict):
            continue
        start, end = sp.get("Start") or 0, sp.get("End") or 0
        if end <= start:
            continue
        indent = sp.get("IndentLevel") or 0
        pad = " " * (4 * indent)
        if sp.get("IsChecked"):
            sym, has_checkbox = "☑ ", True
        elif sp.get("IsBullet"):
            sym, has_bullets = "• ", False
        else:
            continue
        for i, ls in enumerate(line_starts):
            le = ls + len(lines[i])
            if le >= start and ls < end:
                if i not in prefixes or len(pad + sym) < len(
                        prefixes[i].split("\x01")[0]):
                    prefixes[i] = pad + sym + "\x01"
    out_lines = []
    for i, ln in enumerate(lines):
        pre = prefixes.get(i, "")
        if pre:
            out_lines.append(pre.split("\x01")[0] + ln)
        else:
            out_lines.append(ln)
    return "\n".join(out_lines), has_bullets, has_checkbox


def time_now_ms() -> int:
    import time
    return int(time.time() * 1000)
