# -*- coding: utf-8 -*-
"""Локальный агент-мост между Samsung Notes (Windows) и браузерным расширением.

HTTP-сервер на 127.0.0.1, только stdlib. Запуск:  py main.py  (или pythonw).
"""

import json
import logging
import os
import secrets
import subprocess
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sbn import SbnIndex, find_localstate, state_dir  # noqa: E402

AGENT_VERSION = "1.0.0"
PORT_RANGE = range(8712, 8720)
POLL_INTERVAL = 2.0

state = {"index": None, "token": "", "port": 0, "writeback": False}
STATE_FILE = os.path.join(state_dir(), "state.json")


def load_writeback_flag():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return bool(json.load(f).get("writeback"))
    except (OSError, ValueError):
        return False


def save_writeback_flag(on: bool):
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    data["writeback"] = bool(on)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f)


def log_setup():
    d = state_dir()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(os.path.join(d, "agent.log"), encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


def load_or_create_token() -> str:
    d = state_dir()
    p = os.path.join(d, "token.txt")
    if os.path.isfile(p):
        with open(p, "r", encoding="utf-8") as f:
            tok = f.read().strip()
            if tok:
                return tok
    tok = secrets.token_hex(24)
    with open(p, "w", encoding="utf-8") as f:
        f.write(tok)
    return tok


def notes_app_running() -> bool:
    try:
        r = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq SamsungNotes.exe"],
            capture_output=True, text=True, timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return "SamsungNotes.exe" in (r.stdout or "")
    except Exception:
        return False


def cors(origin, handler):
    if origin:
        handler.send_header("Access-Control-Allow-Origin", origin)
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
    handler.send_header("Access-Control-Allow-Private-Network", "true")
    handler.send_header("Vary", "Origin")


def pick_port() -> int:
    import socket
    for port in PORT_RANGE:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("Нет свободного порта в диапазоне 8712-8719")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ---------- инфраструктура ----------

    def log_message(self, fmt, *args):
        logging.info("%s - %s", self.address_string(), fmt % args)

    def _json(self, code: int, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        cors(self.headers.get("Origin"), self)
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _origin_cors(self):
        cors(self.headers.get("Origin"), self)

    def _authorized(self) -> bool:
        auth = self.headers.get("Authorization", "")
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("token", [""])
        return (auth == f"Bearer {state['token']}" or
                (q[0] and q[0] == state["token"]))

    # ---------- методы ----------

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self._origin_cors()
        self.end_headers()

    def do_GET(self):
        if not self._authorized():
            self._json(401, {"error": "unauthorized"})
            return
        parsed = urllib.parse.urlparse(self.path)
        try:
            if self._settings_endpoints(parsed):
                return
        except Exception as e:
            logging.exception("GET failed")
            self._json(500, {"error": str(e)})
            return
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        idx: SbnIndex = state["index"]
        try:
            if path == "/health":
                self._json(200, {
                    "ok": True,
                    "version": AGENT_VERSION,
                    "notes": len(idx.notes),
                    "last_indexed": idx.last_indexed,
                    "app_running": notes_app_running(),
                    "writeback_enabled": bool(state["writeback"]),
                })
                return
            if path == "/notes":
                self._json(200, {
                    "notes": idx.list_notes(
                        query=(qs.get("query") or [""])[0],
                        folder=(qs.get("folder") or [""])[0],
                        limit=int((qs.get("limit") or ["200"])[0]),
                        include_trash=False,
                    )})
                return
            if path == "/folders":
                self._json(200, {"folders": idx.folders})
                return
            if path.startswith("/note/"):
                uuid = urllib.parse.unquote(path[len("/note/"):])
                note = idx.get_note(uuid)
                if note is None:
                    self._json(404, {"error": "not found"})
                else:
                    self._json(200, {"note": note})
                return
            if path.startswith("/media/"):
                parts = path.split("/")
                if len(parts) == 4:
                    uuid, name = urllib.parse.unquote(parts[2]), urllib.parse.unquote(parts[3])
                    fp = idx.media_path(uuid, name)
                    if fp:
                        with open(fp, "rb") as f:
                            data = f.read()
                        self.send_response(200)
                        self.send_header("Content-Type",
                                         "application/octet-stream")
                        self.send_header("Content-Length", str(len(data)))
                        self._origin_cors()
                        self.end_headers()
                        try:
                            self.wfile.write(data)
                        except BrokenPipeError:
                            pass
                        return
                self._json(404, {"error": "not found"})
                return
            self._json(404, {"error": "not found"})
        except Exception as e:
            logging.exception("GET failed")
            self._json(500, {"error": str(e)})

    def do_POST(self):
        if not self._authorized():
            self._json(401, {"error": "unauthorized"})
            return
        parsed = urllib.parse.urlparse(self.path)
        if self._settings_endpoints(parsed) and self.command == "POST":
            return
        if parsed.path not in ("/notes/create",):
            self._json(404, {"error": "not found"})
            return
        if not state["writeback"]:
            self._json(403, {"error": "write-back отключён (включите в настройках)"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"error": "bad json"})
            return
        # writeback импортируется лениво, чтобы чисто-читательский путь не зависел от него
        from writeback import create_note
        self._json(200, create_note(body))

    def _settings_endpoints(self, path_parsed):
        """GET/POST /settings — флаг write-back, синхронизируемый с расширением."""
        if path_parsed.path == "/settings" and self.command == "POST":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                self._json(400, {"error": "bad json"})
                return True
            if "writeback" in body:
                state["writeback"] = bool(body["writeback"])
                save_writeback_flag(state["writeback"])
                logging.info("writeback flag: %s", state["writeback"])
                self._json(200, {"ok": True, "writeback": state["writeback"]})
                return True
        if path_parsed.path == "/settings" and self.command == "GET":
            self._json(200, {"writeback": bool(state["writeback"])})
            return True
        return False


def watcher():
    idx = state["index"]
    while True:
        try:
            changed = idx.refresh()
            if changed:
                logging.info("index refreshed: %d notes", len(idx.notes))
        except Exception:
            logging.exception("watcher refresh failed")
        threading.Event().wait(POLL_INTERVAL)


def main():
    log_setup()
    ls = find_localstate()
    if not ls:
        logging.error("Samsung Notes LocalState не найден")
        sys.exit(1)
    logging.info("LocalState: %s", ls)
    state["token"] = load_or_create_token()
    state["writeback"] = load_writeback_flag()
    state["index"] = SbnIndex(ls)
    state["index"].refresh(force=True)
    logging.info("initial index: %d notes", len(state["index"].notes))
    threading.Thread(target=watcher, daemon=True).start()
    port = pick_port()
    state["port"] = port
    with open(os.path.join(state_dir(), "port.txt"), "w", encoding="utf-8") as f:
        f.write(str(port))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    logging.info("listening on 127.0.0.1:%d", port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
