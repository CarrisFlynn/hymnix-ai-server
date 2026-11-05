"""Headless command registry for the Hymnix terminal."""
from __future__ import annotations
import os, platform, shlex, subprocess, time
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
]
COMMANDS = {n: {"name": n, "usage": u, "desc": d, "example": e} for n, u, d, e in _NAMES}

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
