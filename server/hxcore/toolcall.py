# -*- coding: utf-8 -*-
"""Tool invocation timeline with optional subscribers."""
from __future__ import annotations
import threading, time, uuid
from typing import Any

_lock = threading.RLock()
_events: list[dict] = []
_subscribers: list = []
_MAX = 2000

def _mirror(event: dict) -> None:
    try:
        from hxcore import logindex
        logindex.record("tools", "call", event)
    except Exception:
        pass

def begin(tool: str, args: dict, origin: str = "ui") -> str:
    cid = uuid.uuid4().hex
    event = {"phase":"begin", "id":cid, "tool":str(tool), "args":args if isinstance(args, dict) else {}, "origin":origin, "t0":time.time()}
    with _lock:
        _events.append(dict(event))
        if len(_events) > _MAX: del _events[:-_MAX]
        subscribers = list(_subscribers)
    _mirror(event)
    for fn in subscribers:
        try: fn(dict(event))
        except Exception: pass
    return cid

def end(cid: str, ok: bool, result=None, error: str = "", ms: float | None = None) -> None:
    t1=time.time()
    with _lock:
        found = next((e for e in reversed(_events) if e.get("id")==cid and e.get("phase")=="begin"), None)
        t0 = found.get("t0", t1) if found else t1
        event={"phase":"end","id":cid,"tool":found.get("tool","") if found else "","args":found.get("args",{}) if found else {},"origin":found.get("origin", "ui") if found else "ui","t0":t0,"t1":t1,"ms":float(ms if ms is not None else max(0,(t1-t0)*1000)),"ok":bool(ok),"result":result,"error":str(error or "")}
        _events.append(event)
        if len(_events) > _MAX: del _events[:-_MAX]
        subscribers=list(_subscribers)
    _mirror(event)
    for fn in subscribers:
        try: fn(dict(event))
        except Exception: pass

def timeline(limit: int = 200) -> list[dict]:
    try: limit=max(0,min(int(limit),_MAX))
    except Exception: limit=200
    with _lock: return [dict(e) for e in _events[-limit:]]

def subscribe(fn) -> None:
    if not callable(fn): return
    with _lock:
        if fn not in _subscribers: _subscribers.append(fn)
