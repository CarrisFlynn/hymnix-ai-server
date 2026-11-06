# -*- coding: utf-8 -*-
"""Offline update channel selection and local manifest checks."""
import datetime
import json
import os
import re
import shutil


def _root():
    try:
        from hxcore.paths import root_dir
        return str(root_dir())
    except Exception:
        return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _data():
    try:
        from hxcore.paths import data_dir
        return str(data_dir())
    except Exception:
        return _root()


def _logs():
    try:
        from hxcore.paths import logs_dir
        return str(logs_dir())
    except Exception:
        return os.path.join(_root(), "logs")


def _path():
    return os.path.join(_data(), "config", "update-channel.json")


def get():
    try:
        with open(_path(), encoding="utf-8") as fh:
            value = json.load(fh)
        name = value.get("channel", "stable") if isinstance(value, dict) else "stable"
        return name if name in ("stable", "preview") else "stable"
    except Exception:
        return "stable"


def set(name):
    try:
        if name not in ("stable", "preview"):
            return {"ok": False, "error": "invalid_channel"}
        path = _path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        value = {}
        try:
            with open(path, encoding="utf-8") as fh:
                value = json.load(fh)
            if not isinstance(value, dict):
                value = {}
        except Exception:
            pass
        if os.path.isfile(path):
            backup = os.path.join(_data(), "backup", datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
            os.makedirs(backup, exist_ok=True)
            shutil.copy2(path, os.path.join(backup, "update-channel.json"))
        value["channel"] = name
        temp = path + ".tmp"
        with open(temp, "w", encoding="utf-8", newline="") as fh:
            json.dump(value, fh, ensure_ascii=False, indent=2)
        os.replace(temp, path)
        return {"ok": True, "channel": name}
    except Exception as exc:
        return {"ok": False, "error": str(exc) or "io_error"}


def _version_source():
    env = str(os.environ.get("HYMNIX_VERSION") or "").strip()
    if env:
        return env, "HYMNIX_VERSION"
    for path in (os.path.join(_root(), "VERSION"), os.path.join(_root(), "version")):
        try:
            with open(path, encoding="utf-8") as fh:
                value = fh.read().strip()
            if value:
                return value, "VERSION"
        except Exception:
            pass
    try:
        import hxcore
        value = str(getattr(hxcore, "__version__", "") or "").strip()
        if value:
            return value, "hxcore.__version__"
    except Exception:
        pass
    return "0.0.0", "fallback"


def available():
    version, source = _version_source()
    return {"ok": True, "channel": get(), "version": version, "version_source": source, "offline": True}


def check_local():
    try:
        channel = get()
        path = os.path.join(_logs(), "update", "manifest-%s.json" % channel)
        if not os.path.isfile(path):
            return {"ok": False, "error": "manifest_missing", "channel": channel}
        with open(path, encoding="utf-8") as fh:
            value = json.load(fh)
        if not isinstance(value, dict):
            return {"ok": False, "error": "manifest_invalid", "channel": channel}
        current = available()
        manifest_version = str(value.get("version", "")).strip()
        return {"ok": True, "channel": channel, "version": manifest_version, "current_version": current["version"], "version_source": current["version_source"], "offer": should_offer(manifest_version), "notes": value.get("notes", ""), "files": value.get("files", [])}
    except Exception as exc:
        return {"ok": False, "error": str(exc) or "read_failed"}


def _parse(value):
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?", str(value).strip())
    if not match:
        return None
    major, minor, patch, pre = match.groups()
    parts = [] if pre is None else pre.split(".")
    return (int(major), int(minor), int(patch), parts)


def _compare(left, right):
    a, b = _parse(left), _parse(right)
    if a is None or b is None:
        return None
    if a[:3] != b[:3]:
        return -1 if a[:3] < b[:3] else 1
    ap, bp = a[3], b[3]
    if not ap and not bp:
        return 0
    if not ap:
        return 1
    if not bp:
        return -1
    for x, y in zip(ap, bp):
        if x == y:
            continue
        xn, yn = x.isdigit(), y.isdigit()
        if xn and yn:
            return -1 if int(x) < int(y) else 1
        if xn != yn:
            return -1 if xn else 1
        return -1 if x < y else 1
    return -1 if len(ap) < len(bp) else (1 if len(ap) > len(bp) else 0)


def should_offer(semver):
    try:
        return _compare(semver, available().get("version", "0.0.0")) == 1
    except Exception:
        return False
