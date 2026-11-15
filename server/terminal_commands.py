"""Headless command registry for the Hymnix terminal."""
from __future__ import annotations
import os, platform, shlex, subprocess, time
from datetime import datetime
from dataclasses import dataclass
from typing import Any, Callable

@dataclass(frozen=True)
class Command:
    name: str
    usage: str
    desc: str
    example: str

_NAMES = [
    ("help", "help", "Show command guide", "help"),
    ("clear", "clear", "Clear terminal output", "clear"),
    ("status", "status", "Show gateway and tunnel status", "status"),
    ("version", "version", "Show application version", "version"),
    ("models", "models", "List installed models", "models"),
    ("model", "model <name>", "Set active model", "model qwen3:8b"),
    ("sharemodel", "sharemodel <name>", "Set shared model", "sharemodel qwen3:8b"),
    ("config", "config get|set <key> [value]", "Read or update configuration", "config get gateway_port"),
    ("path", "path [set <dir>]", "Show or change working path", r"path set C:\Models"),
    ("tunnel", "tunnel on|off|restart|status", "Control public tunnel", "tunnel status"),
    ("quota", "quota <n>", "Set daily token quota", "quota 100000"),
    ("billing", "billing on|off", "Enable or disable billing", "billing off"),
    ("lang", "lang <zh|en|fr|ru|es>", "Set interface language", "lang en"),
    ("service", "service start|stop|restart", "Control local gateway service", "service restart"),
    ("hardware", "hardware", "Show hardware information", "hardware"),
    ("export", "export [file]", "Export terminal transcript", "export session.txt"),
    ("history", "history", "Show command history", "history"),
    ("logtail", "logtail <n>", "Show recent tunnel logs", "logtail 20"),
    ("ps", "ps", "List Hymnix processes", "ps"),
    ("dir", "dir", "List workspace directory", "dir"),
]
COMMANDS = {n: {"name": n, "usage": u, "desc": d, "example": e} for n, u, d, e in _NAMES}


class TerminalTraceStore:
    """Append-only terminal trace store using the shared events JSONL convention."""
    KINDS = {"USER", "THINK", "TOOL", "REPLY"}

    def __init__(self, session_id="default", path=None):
        self.session_id = str(session_id or "default")
        self._path = path
        self._last_key = None

    def _file(self):
        if self._path:
            return self._path
        try:
            from hxcore.paths import logs_dir
            root = logs_dir()
        except Exception:
            root = os.path.join(os.getcwd(), "logs")
        root = os.path.join(root, "terminal")
        os.makedirs(root, exist_ok=True)
        return os.path.join(root, "trace-%s.jsonl" % time.strftime("%Y-%m-%d"))

    @staticmethod
    def _timestamp(value=None):
        return str(value or datetime.now().isoformat(timespec="milliseconds"))

    def append(self, kind, text, level="INFO", source="terminal", timestamp=None):
        kind = str(kind or "REPLY").upper()
        if kind not in self.KINDS:
            kind = "REPLY"
        row = {"timestamp": self._timestamp(timestamp), "session_id": self.session_id,
               "event_type": "terminal_trace", "kind": kind, "role": kind,
               "level": str(level or "INFO").upper(), "source": str(source or "terminal"),
               "text": str(text if text is not None else "")}
        key = tuple(row[k] for k in ("session_id", "kind", "level", "source", "text"))
        if key == self._last_key:
            return row
        try:
            path = self._file()
            import json
            previous_key = None
            try:
                with open(path, "rb+") as handle:
                    handle.seek(0, os.SEEK_END)
                    end = handle.tell()
                    if end:
                        handle.seek(end - 1)
                        position = end - 2 if handle.read(1) == b"\n" else end - 1
                        while position >= 0:
                            handle.seek(position)
                            if handle.read(1) == b"\n":
                                break
                            position -= 1
                        line_start = position + 1
                        handle.seek(line_start)
                        previous = json.loads(handle.read().decode("utf-8", errors="replace").strip())
                        if previous.get("event_type") == "terminal_trace":
                            previous_key = tuple(str(previous.get(k, "")) for k in ("session_id", "kind", "level", "source", "text"))
            except (OSError, ValueError, TypeError):
                pass
            if key == previous_key or key == self._last_key:
                self._last_key = key
                return row
            with open(path, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            self._last_key = key
        except OSError:
            pass
        return row

    def load(self, limit=2000):
        import json
        rows = []
        try:
            from hxcore.paths import logs_dir
            root = os.path.dirname(self._path) if self._path else os.path.join(logs_dir(), "terminal")
            paths = [self._path] if self._path else [os.path.join(root, name) for name in os.listdir(root) if name.startswith("trace-") and name.endswith(".jsonl")]
        except (OSError, TypeError):
            paths = [self._file()]
        for path in sorted(set(paths)):
            try:
                with open(path, encoding="utf-8-sig", errors="replace") as handle:
                    for raw in handle:
                        try:
                            row = json.loads(raw)
                        except (TypeError, ValueError):
                            continue
                        if row.get("event_type") == "terminal_trace" and str(row.get("session_id")) == self.session_id:
                            rows.append(row)
            except OSError:
                continue
        return rows[-max(1, int(limit)):]

def help_text() -> str:
    return "\n".join(f"{v['usage']:<34} {v['desc']}" for v in COMMANDS.values())

def _result(text: str = "", handled: bool = True, clear: bool = False) -> dict[str, Any]:
    return {"handled": handled, "text": text, "clear": clear}

def execute(line: str, context: Any = None) -> dict[str, Any]:
    """Parse a command and invoke context hooks; safe for headless callers."""
    raw = (line or "").strip()
    if not raw:
        return _result()
    try:
        parts = shlex.split(raw, posix=False)
    except ValueError as exc:
        return _result(f"error: {exc}\n")
    name = parts[0].lower()
    args = parts[1:]
    try:
        from hxcore import approvals
        decision = approvals.check(raw, origin="terminal")
        approvals.record(decision, raw)
        if decision.get("decision")=="deny":
            return _result("已按只读策略拦截：" + ",".join(decision.get("reasons", [])) + "\n", False)
        if decision.get("risk")=="danger" and decision.get("decision")=="ask":
            callback = getattr(context, "approve", None) if context is not None else None
            if not callable(callback):
                return _result("需要审批：" + ",".join(decision.get("reasons", [])) + "\n", False)
            if not callback(raw, decision):
                return _result("已拒绝：" + ",".join(decision.get("reasons", [])) + "\n", False)
    except ImportError:
        pass
    if name in ("?", "h"): name = "help"
    if name in ("cls",): name = "clear"
    if name not in COMMANDS:
        return _result(f"unknown command: {parts[0]} (try: help)\n", False)
    if name == "help": return _result(help_text() + "\n")
    if name == "clear": return _result(clear=True)
    if context is not None:
        fn = getattr(context, f"command_{name}", None)
        if callable(fn):
            try:
                value = fn(args)
                return _result("" if value is None else str(value) + ("" if str(value).endswith("\n") else "\n"))
            except Exception as exc:
                return _result(f"error: {exc}\n")
    if name in ("model", "sharemodel", "quota", "billing", "lang", "path", "config", "tunnel", "service") and not args:
        return _result(f"usage: {COMMANDS[name]['usage']}\n")
    return _result(f"{name}: no context attached\n")