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

import json
import logging
import os
import subprocess
import threading
import time

_PSH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "create-note.ps1")
_LOCK = threading.Lock()

MAX_TEXT = 8000


def _powershell(script: str, *args) -> subprocess.CompletedProcess:
    argv = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]
    return subprocess.run(argv, capture_output=True, text=True, timeout=60)


def _get_corewindow_hwnd() -> int:
    """HWND окна Samsung Notes (Windows.UI.Core.CoreWindow)."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    target = [0]

    user32.GetClassNameW.restype = wintypes.LPCTSTR
    user32.GetWindowTextW.restype = wintypes.LPCTSTR

    EnumWindows = user32.EnumWindows
    proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def cb(hwnd, lp):
        buf = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, buf, 256)
        if buf.value != "Windows.UI.Core.CoreWindow":
            return True
        user32.GetWindowTextW(hwnd, buf, 256)
        if buf.value == "Samsung Notes" and user32.IsWindowVisible(hwnd):
            target[0] = hwnd
            return False
        return True

    EnumWindows(proc, None)
    return target[0]


def _launch_app() -> None:
    script = (
        "$app = Get-StartApps | Where-Object { $_.Name -like '*Samsung Notes*' } "
        "| Select-Object -First 1; "
        "if ($app) { Start-Process ('shell:appsFolder\\' + $app.AppID); Write-Output 'LAUNCHED' } "
        "else { Write-Output 'NOTFOUND' }"
    )
    r = _powershell(script)
    if "NOTFOUND" in (r.stdout or ""):
        raise RuntimeError("Samsung Notes не найден в системе")


def _wait_window(timeout=45) -> int:
    deadline = time.time() + timeout
    while time.time() < deadline:
        hwnd = _get_corewindow_hwnd()
        if hwnd:
            return hwnd
        time.sleep(0.7)
    raise RuntimeError("окно Samsung Notes не появилось")


def detect_folder_wish(index) -> str | None:
    """Стаб для будущего выбора папки. Пока все создаются в корень (Все заметки)."""
    return None


def create_note(body: dict) -> dict:
    title = (body.get("title") or "").strip()
    text = (body.get("body") or "").rstrip()
    if not title and not text:
        return {"ok": False, "error": "пустая заметка"}

    payload = (title + "\n" + text + "\n").strip() if title else text.strip()
    if len(payload) > MAX_TEXT:
        return {"ok": False, "error": f"слишком длинный текст (>{MAX_TEXT})"}

    acquired = _LOCK.acquire(timeout=2.0)
    if not acquired:
        return {"ok": False, "error": "другая запись уже выполняется"}
    try:
        hwnd = _get_corewindow_hwnd()
        if not hwnd:
            _launch_app()
            hwnd = _wait_window()
        argv = [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", _PSH,
            "-TargetHwnd", str(hwnd),
            "-Text", payload,
        ]
        r = subprocess.run(argv, capture_output=True, text=True, timeout=180,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        out = (r.stdout or "").strip()
        if r.returncode != 0 or "OK" not in out:
            err = (r.stderr or out or "неизвестная ошибка")[:400]
            logging.error("create failed: %s", err)
            return {"ok": False, "error": err}
        time.sleep(2.5)
        return {"ok": True}
    finally:
        _LOCK.release()
