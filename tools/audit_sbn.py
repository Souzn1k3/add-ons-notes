# -*- coding: utf-8 -*-
"""Read-only аудит целостности данных Samsung Notes.

Проверяет:
- PRAGMA integrity_check базы;
- для каждой заметки из NoteDB: wdoc/<uuid>/note.note + SHA-256 трейлер;
- pageIdInfo.dat: note_hash == трейлер note.note, список страниц и их хэши;
- каждый <page>.page: хэш в EOF-58..EOF-26 и сигнатуру "Page for SAMSUNG S-Pen SDK".
"""
import hashlib
import os
import shutil
import sqlite3
import sys
import tempfile

SIG = b"Page for SAMSUNG S-Pen SDK"


def find_localstate():
    import glob
    base = os.environ["LOCALAPPDATA"]
    for pkg in glob.glob(os.path.join(base, "Packages", "*SamsungNotes*")):
        cand = os.path.join(pkg, "LocalState")
        if os.path.isfile(os.path.join(cand, "Storage.sqlite")):
            return cand
    return None


def main():
    ls = find_localstate()
    if not ls:
        print("FAIL: LocalState not found")
        return 1
    wdoc = os.path.join(ls, "wdoc")

    tmpdir = tempfile.mkdtemp(prefix="sbn_audit_")
    dbcopy = os.path.join(tmpdir, "Storage.sqlite")
    shutil.copy2(os.path.join(ls, "Storage.sqlite"), dbcopy)

    con = sqlite3.connect(dbcopy)
    cur = con.cursor()
    print("== DB integrity ==")
    print("integrity_check:", cur.execute("PRAGMA integrity_check").fetchone()[0])

    notes = cur.execute(
        "SELECT UUID, Title, DeletedStatus, IsLocked FROM NoteDB").fetchall()
    print("total notes:", len(notes),
          "| active:", sum(1 for n in notes if not n[2]),
          "| trash:", sum(1 for n in notes if n[2]),
          "| locked:", sum(1 for n in notes if n[3]))
    con.close()

    problems = []
    pages_ok = 0
    notes_ok = 0

    for uuid, title, deleted, locked in notes:
        d = os.path.join(wdoc, uuid)
        nn = os.path.join(d, "note.note")
        if not os.path.isdir(d):
            problems.append(f"{uuid[:8]}: нет папки wdoc")
            continue
        if not os.path.isfile(nn):
            problems.append(f"{uuid[:8]}: нет note.note")
            continue
        data = open(nn, "rb").read()
        if len(data) < 33:
            problems.append(f"{uuid[:8]}: note.note слишком короткий")
            continue
        note_hash = hashlib.sha256(data[:-32]).digest()
        if note_hash != data[-32:]:
            problems.append(f"{uuid[:8]}: note.note трейлер не совпал")
            continue
        notes_ok += 1

        pi_path = os.path.join(d, "pageIdInfo.dat")
        if not os.path.isfile(pi_path):
            problems.append(f"{uuid[:8]}: нет pageIdInfo.dat")
            continue
        pi = open(pi_path, "rb").read()
        if pi[:32] != note_hash:
            problems.append(f"{uuid[:8]}: pageIdInfo note_hash не совпал")
            continue
        if len(pi) < 34:
            problems.append(f"{uuid[:8]}: pageIdInfo короче заголовка")
            continue
        cnt = int.from_bytes(pi[32:34], "little")
        pos = 34
        entries_ok = True
        for _ in range(cnt):
            if pos + 2 > len(pi):
                problems.append(f"{uuid[:8]}: pageIdInfo обрезан")
                entries_ok = False
                break
            u16 = int.from_bytes(pi[pos:pos + 2], "little")
            pos += 2
            puuid = pi[pos:pos + 2 * u16].decode("utf-16-le", "replace")
            pos += 2 * u16
            phash = pi[pos:pos + 32]
            pos += 32
            page_file = os.path.join(d, puuid + ".page")
            if not os.path.isfile(page_file):
                problems.append(f"{uuid[:8]}: нет страницы {puuid[:8]}")
                entries_ok = False
                continue
            pg = open(page_file, "rb").read()
            if len(pg) < 58 + 26:
                problems.append(f"{uuid[:8]}/{puuid[:8]}: .page слишком короткий")
                entries_ok = False
                continue
            if pg[-58:-26] != phash:
                problems.append(f"{uuid[:8]}/{puuid[:8]}: page_hash не совпал")
                entries_ok = False
            if pg[-26:] != SIG:
                problems.append(f"{uuid[:8]}/{puuid[:8]}: нет подписи S-Pen SDK")
                entries_ok = False
            else:
                pages_ok += 1
        if not entries_ok:
            continue

    # лишние папки wdoc без записи в NoteDB
    orphans = []
    if os.path.isdir(wdoc):
        known = {n[0] for n in notes}
        for name in os.listdir(wdoc):
            if os.path.isdir(os.path.join(wdoc, name)) and name not in known:
                orphans.append(name)

    print("\n== Files ==")
    print("notes verified OK:", notes_ok, "/", len(notes))
    print("pages verified OK:", pages_ok)
    print("orphan wdoc folders:", len(orphans), orphans[:5])

    shutil.rmtree(tmpdir, ignore_errors=True)

    if problems:
        print("\n== PROBLEMS ==")
        for p in problems[:50]:
            print(" -", p)
        return 1
    print("\nRESULT: ALL OK — данные Samsung Notes целы, хэши и подписи совпадают.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
