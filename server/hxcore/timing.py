# -*- coding: utf-8 -*-
"""Low-overhead startup timing marks and reports."""
from __future__ import annotations

import atexit
import json
import os
import threading
import time

from hxcore.paths import ensure_dir, logs_dir, now_iso

_T0 = time.perf_counter()
_LOCK = threading.Lock()
_MARKS = {"import": 0.0}
_ENABLED = False
_ATEXIT_REGISTERED = False


def mark(name: str) -> float:
    try:
        value = (time.perf_counter() - _T0) * 1000.0
        with _LOCK:
            _MARKS[str(name)] = value
        return value
    except Exception:
        return 0.0


def marks() -> dict:
    try:
        with _LOCK:
            return dict(_MARKS)
    except Exception:
        return {}


def install(enabled: bool | None = None) -> None:
    global _ENABLED, _ATEXIT_REGISTERED
    try:
        _ENABLED = bool(os.environ.get("HX_TIMING") == "1" if enabled is None else enabled)
        if _ENABLED and not _ATEXIT_REGISTERED:
            atexit.register(report)
            _ATEXIT_REGISTERED = True
    except Exception:
        _ENABLED = False


def ready(path: str | None = None) -> None:
    try:
        mark("first_frame")
        target = path or os.environ.get("HX_READY_MARK")
        if target:
            ensure_dir(os.path.dirname(os.path.abspath(target)))
            with open(target, "w", encoding="utf-8") as stream:
                stream.write("%.3f" % marks().get("first_frame", 0.0))
    except Exception:
        pass


def report(path: str | None = None) -> str:
    try:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        folder = path or os.path.join(logs_dir(), "perf")
        if path and os.path.splitext(path)[1].lower() == ".json":
            json_path = path
            folder = os.path.dirname(os.path.abspath(path))
        else:
            ensure_dir(folder)
            json_path = os.path.join(folder, "startup-" + stamp + ".json")
        payload = {"kind": "startup", "ts": now_iso(), "marks_ms": marks()}
        ensure_dir(folder)
        with open(json_path, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
        with open(os.path.splitext(json_path)[0] + ".txt", "w", encoding="utf-8") as stream:
            stream.write("Hymnix startup timing\n")
            for key, value in sorted(payload["marks_ms"].items(), key=lambda item: item[1]):
                stream.write("%s: %.3f ms\n" % (key, value))
        return json_path
    except Exception:
        return ""
