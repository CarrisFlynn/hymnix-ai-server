# -*- coding: utf-8 -*-
"""全局异常捕获、崩溃报告与会话恢复。"""
from __future__ import annotations

import faulthandler
import json
import os
import sys
import threading
import time
import traceback
from typing import Any, Callable

from hxcore.paths import atomic_write_json, ensure_dir, logs_dir, now_iso, read_json

_APP_NAME = "Hymnix"
_ROOT = None
_ON_REPORT: Callable[[str, dict], Any] | None = None
_ROOT_WIDGET = None
_LAST_PAGE = ""
_LAST_PAGE_TS = 0.0
_INSTALLED = False
_FAULT_FILE = None


def _dirs() -> tuple[str, str]:
    base = os.path.join(_ROOT or logs_dir(), "logs") if _ROOT else logs_dir()
    # root parameter is an application root, while logs_dir() already honors overrides.
    if _ROOT:
        base = os.path.join(_ROOT, "logs")
    crash_dir = ensure_dir(os.path.join(base, "crash"))
    ensure_dir(os.path.join(base, "state"))
    return base, crash_dir


def _state_path() -> str:
    base, _ = _dirs()
    return os.path.join(base, "state", "session.json")


def _write_state(data: dict) -> None:
    try:
        atomic_write_json(_state_path(), data)
    except Exception:
        pass


def _load_state() -> dict:
    try:
        value = read_json(_state_path(), {})
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _tail() -> list[str]:
    try:
        base, _ = _dirs()
        candidates = []
        for name in os.listdir(base):
            path = os.path.join(base, name)
            if os.path.isfile(path) and (name.endswith(".log") or name.endswith(".jsonl")):
                candidates.append(path)
        lines: list[str] = []
        for path in sorted(candidates, key=lambda p: os.path.getmtime(p), reverse=True)[:8]:
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    lines.extend(fh.readlines()[-40:])
            except Exception:
                continue
        return [line.rstrip("\n") for line in lines[-40:]]
    except Exception:
        return []


def _prune() -> None:
    try:
        _, directory = _dirs()
        files = sorted((os.path.join(directory, n) for n in os.listdir(directory)
                        if n.startswith("crash-") and n.endswith(".json")),
                       key=lambda p: os.path.getmtime(p), reverse=True)
        for path in files[30:]:
            for target in (path, path[:-5] + ".txt"):
                try:
                    os.remove(target)
                except Exception:
                    pass
    except Exception:
        pass


def report_exception(exc: BaseException, where: str = "main") -> str | None:
    """写入 JSON 与可读文本报告，并安全触发回调。"""
    try:
        _, directory = _dirs()
        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime())
        base = os.path.join(directory, f"crash-{stamp}-{os.getpid()}")
        # Avoid collisions when two threads report within one second.
        if os.path.exists(base + ".json"):
            suffix = 2
            while os.path.exists(f"{base}_{suffix}.json"):
                suffix += 1
            base = f"{base}_{suffix}"
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        info = {
            "app": _APP_NAME, "version": "1.0.0", "python": sys.version,
            "pid": os.getpid(), "where": where, "page": _LAST_PAGE,
            "timestamp": now_iso(), "traceback": tb, "log_tail": _tail(),
        }
        if not atomic_write_json(base + ".json", info):
            return None
        try:
            with open(base + ".txt", "w", encoding="utf-8") as fh:
                fh.write(f"{_APP_NAME} crash report\n")
                fh.write(f"Python: {sys.version}\nPID: {os.getpid()}\nPage: {_LAST_PAGE}\n")
                fh.write(f"Where: {where}\n\n{tb}\nRecent logs:\n")
                fh.write("\n".join(info["log_tail"]))
        except Exception:
            pass
        _prune()
        try:
            if _ON_REPORT:
                _ON_REPORT(base + ".json", info)
        except Exception:
            pass
        return base + ".json"
    except Exception:
        return None


def _hook(exc_type, exc_value, exc_tb) -> None:
    try:
        exc = exc_value if isinstance(exc_value, BaseException) else Exception(str(exc_value))
        report_exception(exc, "main")
    except Exception:
        pass


def _thread_hook(args) -> None:
    try:
        exc = args.exc_value if isinstance(args.exc_value, BaseException) else Exception(str(args.exc_value))
        report_exception(exc, f"thread:{getattr(args, 'thread', None) and args.thread.name or 'unknown'}")
    except Exception:
        pass


def _tk_hook(exc_type, exc_value, exc_tb) -> None:
    try:
        exc = exc_value if isinstance(exc_value, BaseException) else Exception(str(exc_value))
        report_exception(exc, "tkinter")
    except Exception:
        pass


def install(app_name: str = "Hymnix", root=None, on_report=None) -> None:
    """安装全局钩子；任何环境错误均被吞掉。"""
    global _APP_NAME, _ROOT, _ON_REPORT, _ROOT_WIDGET, _INSTALLED, _FAULT_FILE
    try:
        if _INSTALLED:
            return
        _APP_NAME = str(app_name or "Hymnix")
        _ROOT_WIDGET = root
        _ON_REPORT = on_report if callable(on_report) else None
        if root is not None:
            try:
                root.report_callback_exception = _tk_hook
            except Exception:
                pass
        sys.excepthook = _hook
        if hasattr(threading, "excepthook"):
            threading.excepthook = _thread_hook
        _, directory = _dirs()
        _FAULT_FILE = open(os.path.join(directory, "faulthandler.log"), "a", encoding="utf-8")
        try:
            faulthandler.enable(_FAULT_FILE)
        except Exception:
            pass
        if not _INSTALLED:
            state = _load_state()
            state.update({"started": now_iso(), "last_page": state.get("last_page", ""),
                          "clean_exit": False, "crashed": False, "version": "1.0.0"})
            _write_state(state)
            _INSTALLED = True
    except Exception:
        pass


def list_reports(limit: int = 20) -> list[dict]:
    try:
        _, directory = _dirs()
        paths = sorted((os.path.join(directory, n) for n in os.listdir(directory)
                        if n.startswith("crash-") and n.endswith(".json")),
                       key=lambda p: os.path.getmtime(p), reverse=True)
        result = []
        for path in paths[:max(0, int(limit))]:
            data = read_json(path, {})
            if isinstance(data, dict):
                data = dict(data)
                data["path"] = path
                result.append(data)
        return result
    except Exception:
        return []


def last_session() -> dict:
    try:
        value = _load_state()
        return {"started": value.get("started", ""), "last_page": value.get("last_page", ""),
                "clean_exit": bool(value.get("clean_exit", False)),
                "crashed": bool(value.get("crashed", False)),
                "version": value.get("version", "1.0.0")}
    except Exception:
        return {"started": "", "last_page": "", "clean_exit": False, "crashed": False, "version": "1.0.0"}


def boot_guard() -> dict:
    try:
        previous = last_session()
        recovered = bool(previous.get("started")) and not bool(previous.get("clean_exit"))
        result = dict(previous)
        result["crashed"] = recovered or bool(previous.get("crashed", False))
        result["recovered"] = recovered
        state = dict(result)
        state.update({"started": now_iso(), "clean_exit": False, "crashed": False})
        _write_state(state)
        return result
    except Exception:
        return {"started": "", "last_page": "", "clean_exit": False, "crashed": False,
                "version": "1.0.0", "recovered": False}


def mark_page(name: str) -> None:
    global _LAST_PAGE, _LAST_PAGE_TS
    try:
        _LAST_PAGE = str(name or "")
        now = time.monotonic()
        if now - _LAST_PAGE_TS >= 0.5:
            state = _load_state()
            state.update({"last_page": _LAST_PAGE, "clean_exit": False, "version": "1.0.0"})
            _write_state(state)
            _LAST_PAGE_TS = now
    except Exception:
        pass


def mark_exit() -> None:
    try:
        state = _load_state()
        state.update({"clean_exit": True, "crashed": False, "last_page": _LAST_PAGE or state.get("last_page", ""),
                      "version": "1.0.0"})
        _write_state(state)
        if _FAULT_FILE is not None:
            try:
                _FAULT_FILE.flush()
                _FAULT_FILE.close()
            except Exception:
                pass
    except Exception:
        pass
