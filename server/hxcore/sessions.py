# -*- coding: utf-8 -*-
"""Exception-safe listing and management for JSONL chat sessions."""
from __future__ import annotations

import datetime
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path


def _logs_dir() -> str:
    try:
        from hxcore.paths import logs_dir
        return str(logs_dir())
    except Exception:
        return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "logs")


def root() -> str:
    try:
        return os.path.join(_logs_dir(), "chats")
    except Exception:
        return os.path.join("logs", "chats")


def _safe_id(value: str) -> str:
    value = str(value or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value):
        return ""
    return value


def _read_records(path: str):
    rows = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for raw in fh:
                try:
                    row = json.loads(raw)
                    if isinstance(row, dict) and row.get("session_id"):
                        rows.append(row)
                except Exception:
                    continue
    except Exception:
        pass
    return rows


def _titles() -> dict:
    try:
        with open(os.path.join(root(), "sessions.json"), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def list_sessions(limit: int = 100, query: str = "") -> list[dict]:
    found = []
    try:
        folder = root()
        if not os.path.isdir(folder):
            return []
        overrides = _titles()
        needle = str(query or "").casefold()
        for name in os.listdir(folder):
            if not name.endswith(".jsonl"):
                continue
            sid = name[:-6]
            if not _safe_id(sid):
                continue
            path = os.path.join(folder, name)
            rows = _read_records(path)
            if not rows:
                continue
            rows.sort(key=lambda row: str(row.get("ts") or ""))
            user_rows = [row for row in rows if str(row.get("role") or "").lower() == "user"]
            first_text = str(user_rows[0].get("text") or "") if user_rows else "(未命名)"
            title = str(overrides.get(sid) or first_text[:40] or "(未命名)")
            if needle and needle not in title.casefold() and not any(needle in str(row.get("text") or "").casefold() for row in rows):
                continue
            try:
                size = os.path.getsize(path)
            except Exception:
                size = 0
            found.append({"id": sid, "title": title, "count": len(rows), "first_ts": str(rows[0].get("ts") or ""), "last_ts": str(rows[-1].get("ts") or ""), "bytes": size})
        found.sort(key=lambda item: item["last_ts"], reverse=True)
        return found[:max(0, min(500, int(limit)))]
    except Exception:
        return []


def messages(session_id: str, limit: int = 500, query: str = "") -> list[dict]:
    try:
        sid = _safe_id(session_id)
        if not sid:
            return []
        path = os.path.join(root(), sid + ".jsonl")
        rows = _read_records(path)
        needle = str(query or "").casefold()
        result = []
        for row in rows:
            text = str(row.get("text") or "")
            if needle and needle not in text.casefold():
                continue
            result.append({"ts": str(row.get("ts") or ""), "role": str(row.get("role") or ""), "text": text[:4000], "model": str(row.get("model") or "")})
        result.sort(key=lambda item: item["ts"])
        return result[:max(0, min(5000, int(limit)))]
    except Exception:
        return []


def create(title: str = "") -> dict:
    try:
        stamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        return {"ok": True, "id": stamp + "-" + secrets.token_hex(2)}
    except Exception:
        return {"ok": False, "id": ""}


def rename(session_id: str, title: str) -> dict:
    try:
        sid = _safe_id(session_id)
        if not sid or not os.path.isfile(os.path.join(root(), sid + ".jsonl")):
            return {"ok": False, "error": "not_found"}
        value = str(title or "").strip()
        if not value:
            return {"ok": False, "error": "bad_title"}
        folder = root()
        os.makedirs(folder, exist_ok=True)
        overrides = _titles()
        overrides[sid] = value[:200]
        temp = os.path.join(folder, "sessions.json.tmp")
        with open(temp, "w", encoding="utf-8", newline="") as fh:
            json.dump(overrides, fh, ensure_ascii=False, indent=2)
        os.replace(temp, os.path.join(folder, "sessions.json"))
        return {"ok": True, "error": ""}
    except Exception as exc:
        return {"ok": False, "error": str(exc) or "io_error"}


def delete(session_id: str) -> dict:
    try:
        sid = _safe_id(session_id)
        if not sid:
            return {"ok": False, "backup": ""}
        folder = root()
        if not os.path.isdir(folder):
            return {"ok": False, "backup": ""}
        sources = []
        for name in os.listdir(folder):
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(folder, name)
            try:
                with open(path, "rb") as fh:
                    raw_lines = fh.readlines()
            except Exception:
                continue
            if any(_line_session_id(line) == sid for line in raw_lines):
                sources.append((path, name, raw_lines))
        if not sources:
            return {"ok": False, "backup": ""}

        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_dir = os.path.join(_logs_dir(), "backup", stamp)
        os.makedirs(backup_dir, exist_ok=True)
        backups = []
        for path, name, _ in sources:
            backup = os.path.join(backup_dir, "deleted-" + sid + "-" + name)
            shutil.copy2(path, backup)
            backups.append(backup)

        staged = []
        try:
            for (path, name, raw_lines), backup in zip(sources, backups):
                temp = path + ".tmp"
                with open(temp, "wb") as fh:
                    fh.writelines(line for line in raw_lines if _line_session_id(line) != sid)
                staged.append((temp, path))
            for temp, path in staged:
                os.replace(temp, path)
        except Exception:
            for temp, _ in staged:
                try:
                    if os.path.exists(temp):
                        os.remove(temp)
                except Exception:
                    pass
            for backup, (path, _, _) in zip(backups, sources):
                try:
                    shutil.copy2(backup, path)
                except Exception:
                    pass
            raise

        overrides = _titles()
        if sid in overrides:
            overrides.pop(sid, None)
            try:
                with open(os.path.join(folder, "sessions.json"), "w", encoding="utf-8") as fh:
                    json.dump(overrides, fh, ensure_ascii=False, indent=2)
            except Exception:
                pass
        try:
            repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            logbook = os.path.join(repo, "tools", "logbook.py")
            if os.path.isfile(logbook):
                subprocess.run([sys.executable, logbook, "--agent", "sessions", "--kind", "rollback", "--summary", "备份并删除会话", "--detail", "backup=" + backup_dir, "--files", ";".join(os.path.relpath(path, repo).replace(os.sep, "/") for path, _, _ in sources), "--result", "ok", "--round", "R5"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)
        except Exception:
            pass
        return {"ok": True, "backup": backups[0] if len(backups) == 1 else backup_dir}
    except Exception as exc:
        return {"ok": False, "backup": "", "error": str(exc) or "io_error"}


def _line_session_id(raw: bytes) -> str:
    try:
        row = json.loads(raw.decode("utf-8"))
        if isinstance(row, dict):
            return str(row.get("session_id") or "")
    except Exception:
        pass
    return ""


def stats() -> dict:
    try:
        items = list_sessions(500)
        return {"sessions": len(items), "messages": sum(item["count"] for item in items), "bytes": sum(item["bytes"] for item in items), "dir": root()}
    except Exception:
        return {"sessions": 0, "messages": 0, "bytes": 0, "dir": root()}


def sessions():
    return list_sessions()