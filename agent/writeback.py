# -*- coding: utf-8 -*-
"""Экспериментальная запись новых заметок в Samsung Notes.

Архитектура (безопасная по построению):
    мы НЕ трогаем файлы Samsung вообще. Заметку создаёт само приложение:
    агент фокусирует его окно, нажимает официальную кнопку «Создать заметку»,
    печатает текст и даёт приложению самому сохранить и засинхронизировать.
    Формат данных гарантируется Samsung Notes (никакой ручной сборки).

Ограничения:
    - работает только в интерактивной сессии пользователя (как и само приложение);
    - хост window должен существовать (приложение запускается автоматически);
    - текст до 8000 символов (ограничение по скорости посимвольного ввода).
"""

import logging
import os
import subprocess
import threading
import time

_PSH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "create-note.ps1")
_LOCK = threading.Lock()

MAX_TEXT = 8000


def _notes_process_running() -> bool:
    try:
        r = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq SamsungNotes.exe"],
            capture_output=True, text=True, timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return "SamsungNotes.exe" in (r.stdout or "")
    except Exception:
        return False


def _notes_pids() -> set:
    """PID процессов SamsungNotes.exe (через tasklist /FO CSV)."""
    try:
        r = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq SamsungNotes.exe", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        pids = set()
        for line in (r.stdout or "").splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) >= 2 and parts[0].lower() == "samsungnotes.exe":
                try:
                    pids.add(int(parts[1]))
                except ValueError:
                    pass
        return pids
    except Exception:
        return set()


def _get_notes_hwnds() -> list:
    """Список HWND-кандидатов окна Samsung Notes, в порядке приоритета.

    Важно: фильтруем CoreWindow по PID процесса SamsungNotes.exe — иначе
    можно поймать постороннее окно с таким же заголовком (например, окно чата).
    ApplicationFrameWindow (оболочка UWP) проверяется по заголовку.
    """
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    pids = _notes_pids()
    candidates = []  # (priority, hwnd)

    EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [EnumProc, wintypes.LPARAM]
    GA_ROOT = 2

    @EnumProc
    def cb(hwnd, lp):
        buf = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, buf, 256)
        cls = buf.value
        if cls not in ("Windows.UI.Core.CoreWindow", "ApplicationFrameWindow"):
            return True
        user32.GetWindowTextW(hwnd, buf, 256)
        if buf.value != "Samsung Notes":
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        vis = bool(user32.IsWindowVisible(hwnd))
        icon = bool(user32.IsIconic(hwnd))
        if cls == "Windows.UI.Core.CoreWindow":
            if pid.value not in pids:
                return True  # чужой процесс с тем же заголовком
            # Windows отказывается менять z-order дочернего CoreWindow —
            # поднимать нужно корневое top-level окно (frame)
            root = user32.GetAncestor(hwnd, GA_ROOT)
            target = root if root else hwnd
            pr = 4 if vis else 6
        else:
            target = hwnd
            pr = 0 if vis else 2
        if icon:
            pr += 8
        candidates.append((pr, target))
        return True

    user32.EnumWindows(cb, 0)
    seen = set()
    ordered = []
    for _, hwnd in sorted(candidates, key=lambda x: x[0]):
        if hwnd in seen:
            continue
        seen.add(hwnd)
        ordered.append(hwnd)
    return ordered


def _get_notes_hwnd() -> int:
    cands = _get_notes_hwnds()
    return cands[0] if cands else 0


def _launch_app() -> None:
    script = (
        "$app = Get-StartApps | Where-Object { $_.Name -like '*Samsung Notes*' } "
        "| Select-Object -First 1; "
        "if ($app) { Start-Process ('shell:appsFolder\\' + $app.AppID); Write-Output 'LAUNCHED' } "
        "else { Write-Output 'NOTFOUND' }"
    )
    argv = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]
    r = subprocess.run(argv, capture_output=True, text=True, timeout=60)
    if "NOTFOUND" in (r.stdout or ""):
        raise RuntimeError("приложение Samsung Notes не найдено в системе")


def _wait_window(timeout=45) -> int:
    deadline = time.time() + timeout
    while time.time() < deadline:
        hwnd = _get_notes_hwnd()
        if hwnd:
            return hwnd
        time.sleep(0.7)
    raise RuntimeError("окно Samsung Notes не появилось")


def detect_folder_wish(index) -> str | None:
    """Стаб для будущего выбора папки. Пока все создаются в корень (Все заметки)."""
    return None


def create_note(body: dict, index=None) -> dict:
    title = (body.get("title") or "").strip()
    text = (body.get("body") or "").rstrip()
    if not title and not text:
        return {"ok": False, "error": "пустая заметка"}

    payload = (title + "\n" + text + "\n").strip() if title else text.strip()
    if len(payload) > MAX_TEXT:
        return {"ok": False, "error": f"слишком длинный текст (>{MAX_TEXT})"}

    known_uuids = set(index.by_uuid.keys()) if (index and hasattr(index, "by_uuid")) else None

    acquired = _LOCK.acquire(timeout=2.0)
    if not acquired:
        return {"ok": False, "error": "другая запись уже выполняется"}
    try:
        candidates = _get_notes_hwnds()
        if not candidates:
            if not _notes_process_running():
                _launch_app()
            candidates = [_wait_window()]
        last_err = ""
        result = None
        for hwnd in candidates[:3]:
            argv = [
                "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", _PSH,
                "-TargetHwnd", str(hwnd),
                "-Text", payload,
            ]
            try:
                r = subprocess.run(argv, capture_output=True, text=True, timeout=120,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except subprocess.TimeoutExpired:
                logging.error("create-note.ps1 timeout on hwnd=%s", hwnd)
                last_err = ("Samsung Notes не ответил за 2 минуты. "
                            "Откройте приложение и повторите.")
                continue
            out = (r.stdout or "").strip()
            if r.returncode == 0 and "OK" in out:
                result = {"ok": True, "hwnd": hwnd}
                break
            last_err = (r.stderr or out or "неизвестная ошибка")[:400]
            logging.warning("create attempt failed on hwnd=%s: %s", hwnd, last_err[:200])
            if "CreateNoteButton not found" not in last_err and \
               "editor did not open" not in last_err:
                break  # ошибка иного рода — дальше пробовать бессмысленно
        if result is None:
            logging.error("create failed: %s", last_err)
            return {"ok": False, "error": last_err}
        time.sleep(2.5)
        # пробуем опознать новую заметку в свежем индексе
        new_uuid = None
        if index is not None and known_uuids is not None:
            try:
                index.refresh(force=True)
                first_line = payload.split("\n", 1)[0].strip().lower()
                now_ms = int(time.time() * 1000)
                for uuid in set(index.by_uuid.keys()) - known_uuids:
                    n = index.by_uuid[uuid]
                    if n["modified_at"] >= now_ms - 120_000:
                        new_uuid = uuid
                        if first_line and n["title"].lower().startswith(first_line[:60]):
                            break
            except Exception:
                logging.exception("post-create reindex failed")
        return {"ok": True, "uuid": new_uuid}
    finally:
        _LOCK.release()

