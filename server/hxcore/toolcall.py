# -*- coding: utf-8 -*-
"""Tool invocation timeline with optional subscribers."""
from __future__ import annotations
import copy
import math
import re
import threading, time, uuid
from typing import Any

_lock = threading.RLock()
_events: list[dict] = []
_subscribers: list = []
_MAX = 2000
_MAX_ITEMS = 32
_MAX_DEPTH = 4
_REDACTED = "[REDACTED]"
_TRUNCATED = "[TRUNCATED]"
_SAFE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,63}$")
_SENSITIVE_KEY = re.compile(r"(?:key|token|secret|password|passwd|credential|auth|cookie|session|private)", re.I)

def _label(value: Any) -> str:
    if isinstance(value, str) and len(value) <= 80 and _SAFE_KEY.fullmatch(value):
        return value
    return _REDACTED

def _redact(value: Any, depth: int = 0, seen: set[int] | None = None) -> Any:
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value if value.bit_length() <= 64 else _TRUNCATED
    if isinstance(value, float):
        return value if math.isfinite(value) else _REDACTED
    if depth >= _MAX_DEPTH:
        return _TRUNCATED
    if isinstance(value, (dict, list, tuple)):
        if seen is None:
            seen = set()
        if id(value) in seen:
            return _TRUNCATED
        seen.add(id(value))
        try:
            if isinstance(value, dict):
                output = {}
                for key, item in list(value.items())[:_MAX_ITEMS]:
                    safe_key = _label(key)
                    if safe_key == _REDACTED:
                        safe_key = "[REDACTED_KEY]"
                    if safe_key in output:
                        continue
                    output[safe_key] = _REDACTED if _SENSITIVE_KEY.search(safe_key) else _redact(item, depth + 1, seen)
                if len(value) > _MAX_ITEMS:
                    output[_TRUNCATED] = len(value) - _MAX_ITEMS
                return output
            items = [_redact(item, depth + 1, seen) for item in value[:_MAX_ITEMS]]
            if len(value) > _MAX_ITEMS:
                items.append(_TRUNCATED)
            return items
        finally:
            seen.remove(id(value))
    # Free-form values can embed credentials even when their field names look safe.
    return _REDACTED

def _mirror(event: dict) -> None:
    try:
        from hxcore import logindex
        logindex.record("tools", "call", event)
    except Exception:
        pass

def begin(tool: str, args: dict, origin: str = "ui") -> str:
    cid = uuid.uuid4().hex
    now = time.time()
    event = {"phase":"begin", "id":cid, "tool":_label(tool), "args":_redact(args) if isinstance(args, dict) else {}, "origin":_label(origin), "t0":now, "ts":now}
    with _lock:
        _events.append(copy.deepcopy(event))
        if len(_events) > _MAX: del _events[:-_MAX]
        subscribers = list(_subscribers)
    _mirror(copy.deepcopy(event))
    for fn in subscribers:
        try: fn(copy.deepcopy(event))
        except Exception: pass
    return cid

def end(cid: str, ok: bool, result=None, error: str = "", ms: float | None = None) -> None:
    t1=time.time()
    with _lock:
        found = next((e for e in reversed(_events) if e.get("id")==cid and e.get("phase")=="begin"), None)
        t0 = found.get("t0", t1) if found else t1
        event={"phase":"end","id":cid,"tool":found.get("tool","") if found else "","args":found.get("args",{}) if found else {},"origin":found.get("origin", "ui") if found else "ui","t0":t0,"t1":t1,"ts":t1,"ms":float(ms if ms is not None else max(0,(t1-t0)*1000)),"ok":bool(ok),"result":_redact(result),"error":_REDACTED if error else ""}
        _events.append(copy.deepcopy(event))
        if len(_events) > _MAX: del _events[:-_MAX]
        subscribers=list(_subscribers)
    _mirror(copy.deepcopy(event))
    for fn in subscribers:
        try: fn(copy.deepcopy(event))
        except Exception: pass

def timeline(limit: int = 200) -> list[dict]:
    try: limit=max(0,min(int(limit),_MAX))
    except Exception: limit=200
    with _lock: return [copy.deepcopy(e) for e in _events[-limit:]] if limit else []

def subscribe(fn) -> None:
    if not callable(fn): return
    with _lock:
        if fn not in _subscribers: _subscribers.append(fn)

def unsubscribe(fn) -> None:
    """Release an observer when its page is destroyed."""
    with _lock:
        if fn in _subscribers: _subscribers.remove(fn)
