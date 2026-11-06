# -*- coding: utf-8 -*-
from __future__ import annotations
import difflib
import datetime
import json
import os
import shutil
import subprocess
import sys
from hxcore.paths import root_dir

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKUP_ROOT = os.path.join(ROOT, "logs", "backup")
_BACKUP_TARGETS = {}

def _safe(path):
    root = os.path.realpath(root_dir())
    lexical = os.path.abspath(path if os.path.isabs(path) else os.path.join(root, path))
    value = os.path.realpath(lexical)
    if lexical != value or os.path.islink(lexical):
        return None
    try:
        if os.path.commonpath((root, value)) != root:
            return None
    except ValueError:
        return None
    return value

def _backup_rel(target):
    root = os.path.realpath(root_dir())
    rel = os.path.relpath(target, root)
    if rel.startswith("..") or os.path.isabs(rel):
        return os.path.join("external", "drive_" + (os.path.splitdrive(target)[0].replace(":", "") or "unknown"), os.path.basename(target))
    return rel

def make_diff(old_text, new_text, path="file"):
    # 用无行尾的 splitlines 生成，再统一用 \n 连接：
    # 否则“文件末尾无换行”会把 "-last" 与 "+last" 拼成同一行，parse 直接失效。
    old = str(old_text).splitlines()
    new = str(new_text).splitlines()
    body = list(difflib.unified_diff(old, new, fromfile=path, tofile=path, lineterm=""))
    if not body:
        return ""
    return "\n".join(body) + "\n"

def parse(text):
    lines = str(text).splitlines()
    hunks = []
    i = 0
    while i < len(lines):
        if not lines[i].startswith("@@"):
            i += 1
            continue
        header = lines[i]
        try:
            marker = header.split("@@", 2)[1].strip().split()
            oldpart, newpart = marker[0], marker[1]
            def nums(part):
                raw = part[1:]
                vals = raw.split(",", 1)
                return int(vals[0]), int(vals[1]) if len(vals) == 2 else 1
            old_start, old_len = nums(oldpart)
            new_start, new_len = nums(newpart)
        except Exception:
            return []
        i += 1
        body = []
        while i < len(lines) and not lines[i].startswith("@@"):
            if lines[i].startswith(("--- ", "+++ ")):
                break
            if lines[i] == "\\ No newline at end of file":
                i += 1
                continue
            if lines[i] and lines[i][0] in " +-":
                body.append(lines[i])
            else:
                return []
            i += 1
        hunks.append({"old_start": old_start, "old_len": old_len,
                      "new_start": new_start, "new_len": new_len, "lines": body})
    return hunks

def _patch_path(patch_text):
    for line in str(patch_text).splitlines():
        if line.startswith("--- "):
            name = line[4:].split("\t", 1)[0].strip()
            return name[2:] if name.startswith(("a/", "b/")) else name
    return ""

def _apply_hunks(original, hunks):
    current = list(original)
    delta = 0
    for h in hunks:
        pos = max(0, h["old_start"] - 1 + delta)
        expected_raw = [x[1:] for x in h["lines"] if x.startswith((" ", "-"))]
        actual = current[pos:pos + len(expected_raw)]
        expected = []
        for index, value in enumerate(expected_raw):
            ending = actual[index][len(actual[index].rstrip("\r\n")):] if index < len(actual) else ""
            expected.append(value + ending)
        if actual != expected:
            return None
        endings = [value[len(value.rstrip("\r\n")):] for value in actual if value.endswith(("\n", "\r"))]
        ending = endings[0] if endings else ""
        replacement = [x[1:] + ending for x in h["lines"] if x.startswith((" ", "+"))]
        current[pos:pos + len(expected)] = replacement
        delta += len(replacement) - len(expected)
    return current

def _log_rollback(detail, files, round_tag=None):
    """Record a rollback event without allowing logging failures to escape."""
    try:
        tag = round_tag or os.environ.get("HYMNIX_ROUND") or "R7"
        script = os.path.join(ROOT, "tools", "logbook.py")
        subprocess.run([sys.executable, script, "--agent", "diffx", "--kind", "rollback",
                        "--summary", "diff 应用前备份原文件", "--detail", detail,
                        "--files", files, "--result", "ok", "--round", str(tag)],
                       cwd=ROOT, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def apply(path, patch_text, *, backup=True, max_bytes=50*1024*1024, chunk_hunks=500, round_tag=None):
    """Apply a UTF-8 unified patch atomically, optionally in hunk chunks."""
    empty = {"ok": False, "applied": 0, "files": [], "backup": "", "error": ""}
    try:
        patch_bytes = len(str(patch_text).encode("utf-8"))
        if patch_bytes > max_bytes:
            result = dict(empty); result["error"] = "patch_too_large"; return result
        if chunk_hunks < 1:
            chunk_hunks = 1
    except (TypeError, ValueError, UnicodeError):
        result = dict(empty); result["error"] = "patch_too_large"; return result
    target = _safe(path)
    if target is None:
        result = dict(empty); result["error"] = "out_of_scope"; return result
    hunks = parse(patch_text)
    if not hunks:
        result = dict(empty); result["error"] = "empty_patch"; return result
    if not os.path.isfile(target):
        result = dict(empty); result["error"] = "not_found"; return result
    try:
        with open(target, "rb") as handle:
            raw = handle.read()
        if b"\x00" in raw:
            result = dict(empty); result["error"] = "binary_file"; return result
        original = raw.decode("utf-8").splitlines(True)
    except (OSError, UnicodeDecodeError):
        result = dict(empty); result["error"] = "binary_file"; return result
    updated = list(original)
    prior_delta = 0
    for start in range(0, len(hunks), chunk_hunks):
        segment = []
        for hunk in hunks[start:start + chunk_hunks]:
            adjusted = dict(hunk)
            adjusted["old_start"] = hunk["old_start"] + prior_delta
            segment.append(adjusted)
        candidate = _apply_hunks(updated, segment)
        if candidate is None:
            result = dict(empty); result["error"] = "context_mismatch"; return result
        updated = candidate
        prior_delta += sum(sum(1 for line in h["lines"] if line.startswith((" ", "+"))) -
                           sum(1 for line in h["lines"] if line.startswith((" ", "-")))
                           for h in segment)
    if original and not original[-1].endswith(("\n", "\r")) and updated and updated[-1].endswith("\n"):
        updated[-1] = updated[-1][:-1]
    backup_path = ""
    try:
        if backup:
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            folder = os.path.join(BACKUP_ROOT, stamp)
            os.makedirs(folder, exist_ok=True)
            rel = _backup_rel(target)
            backup_path = os.path.join(folder, rel)
            if os.path.commonpath((os.path.realpath(folder), os.path.realpath(backup_path))) != os.path.realpath(folder):
                result = dict(empty); result["error"] = "out_of_scope"; return result
            os.makedirs(os.path.dirname(backup_path), exist_ok=True)
            shutil.copy2(target, backup_path)
            patch_name = _patch_path(patch_text) or os.path.relpath(target, ROOT)
            detail = "patch=%s; backup=%s" % (patch_name, os.path.relpath(backup_path, ROOT))
            _log_rollback(detail, rel, round_tag=round_tag)
            _BACKUP_TARGETS[os.path.abspath(backup_path)] = target
        with open(target, "w", encoding="utf-8", newline="") as handle:
            handle.write("".join(updated))
    except OSError as exc:
        result = dict(empty); result["error"] = str(exc); return result
    return {"ok": True, "applied": len(hunks), "files": [os.path.relpath(target, ROOT)],
            "backup": backup_path, "error": "", "chunks": (len(hunks) + chunk_hunks - 1) // chunk_hunks,
            "bytes": patch_bytes}

def revert(backup):
    source = _safe(backup)
    if source is None or not os.path.isfile(source):
        return {"ok": False, "restored": "", "error": "not_found"}
    target = _BACKUP_TARGETS.get(os.path.abspath(source))
    if target is None:
        rel = os.path.relpath(source, BACKUP_ROOT)
        target = _safe(rel)
    if target is None:
        return {"ok": False, "restored": "", "error": "out_of_scope"}
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(source, target)
        return {"ok": True, "restored": os.path.relpath(target, ROOT), "error": ""}
    except Exception as exc:
        return {"ok": False, "restored": "", "error": str(exc)}

def preview(patch_text, *, max_hunks=2000):
    """Return patch counts, truncating parsed hunks at max_hunks."""
    try:
        limit = max(0, int(max_hunks))
    except (TypeError, ValueError):
        limit = 2000
    all_hunks = parse(patch_text)
    hunks = all_hunks[:limit]
    added = sum(1 for h in hunks for line in h["lines"] if line.startswith("+"))
    removed = sum(1 for h in hunks for line in h["lines"] if line.startswith("-"))
    result = {"files": [_patch_path(patch_text)] if hunks and _patch_path(patch_text) else [],
              "hunks": len(hunks), "added": added, "removed": removed}
    if len(all_hunks) > limit:
        result["truncated"] = True
    return result
