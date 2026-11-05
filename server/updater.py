"""Hymnix GitHub Releases updater (standard library only)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Mapping, Optional

OWNER = "CarrisFlynn"
REPO = "hymnix-ai-server"
__version__ = "1.1.0"
CODENAME = "1.1.0"
API_ROOT = f"https://api.github.com/repos/{OWNER}/{REPO}"
USER_AGENT = f"Hymnix-Updater/{__version__}"
_VERSION_RE = re.compile(r"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")


def _install_dir() -> Path:
    return Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent


def get_current_version() -> str:
    """Read VERSION beside the executable/source; fall back to module __version__."""
    try:
        value = (_install_dir() / "VERSION").read_text(encoding="utf-8").strip()
        if value:
            parse_version(value)
            return value.lstrip("v")
    except (OSError, ValueError):
        pass
    return __version__.lstrip("v")


def parse_version(value: str) -> tuple[int, int, int, tuple[tuple[int, object], ...]]:
    match = _VERSION_RE.fullmatch(str(value).strip())
    if not match:
        raise ValueError(f"Invalid semantic version: {value!r}")
    pre = match.group(4)
    identifiers: tuple[tuple[int, object], ...] = ()
    if pre:
        parts = pre.split(".")
        if any(not p or (p.isdigit() and len(p) > 1 and p.startswith("0")) for p in parts):
            raise ValueError(f"Invalid prerelease: {pre!r}")
        identifiers = tuple((0, int(p)) if p.isdigit() else (1, p) for p in parts)
    return int(match.group(1)), int(match.group(2)), int(match.group(3)), identifiers


def compare_versions(left: str, right: str) -> int:
    a, b = parse_version(left), parse_version(right)
    if a[:3] != b[:3]:
        return (a[:3] > b[:3]) - (a[:3] < b[:3])
    ap, bp = a[3], b[3]
    if not ap or not bp:
        return 0 if not ap and not bp else (1 if not ap else -1)
    for x, y in zip(ap, bp):
        if x != y:
            # numeric identifiers precede textual identifiers
            return (x > y) - (x < y)
    return (len(ap) > len(bp)) - (len(ap) < len(bp))


def parse_checksums(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r"^([0-9a-fA-F]{64})\s+[* ]?(.+?)\s*$", line.strip())
        if match:
            result[Path(match.group(2).strip()).name] = match.group(1).lower()
    return result


def _digest(asset: Mapping) -> Optional[str]:
    value = asset.get("digest")
    if isinstance(value, str):
        match = re.fullmatch(r"sha256:([0-9a-fA-F]{64})", value)
        if match:
            return match.group(1).lower()
    return None


def pick_asset(release: Mapping, patterns: Optional[object] = None) -> Optional[dict]:
    """Select a Windows exe/zip, preferring executable installers and recording metadata."""
    assets = [a for a in (release.get("assets") or []) if isinstance(a, Mapping)]
    candidates = [a for a in assets if Path(str(a.get("name", ""))).suffix.lower() in (".exe", ".zip")]
    if not candidates:
        return None
    def score(a: Mapping) -> tuple[int, int, int, int]:
        name = str(a.get("name", "")).lower()
        # Prefer the server executable (this app) over the bundled desktop client.
        kind = 0 if "server" in name else (2 if "client" in name else 1)
        return (0 if name.endswith(".exe") else 1, kind,
                0 if ("win" in name or "windows" in name) else 1, len(name))
    selected = sorted(candidates, key=score)[0]
    checks = next((a for a in assets if str(a.get("name", "")).lower().endswith((".sha256", ".sha256sum")) or "checksum" in str(a.get("name", "")).lower()), None)
    digest = _digest(selected)
    return {"name": selected.get("name"), "url": selected.get("browser_download_url"),
            "size": selected.get("size"), "sha256": digest, "digest": digest,
            "checksums_url": checks.get("browser_download_url") if checks else None,
            "version": str(release.get("tag_name", "")).lstrip("v"), "tag": release.get("tag_name")}


def _github_json(url: str, timeout: int = 10) -> Mapping:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def check_for_update(timeout: int = 10) -> dict:
    """Return UI-safe update status; network and HTTP failures never escape."""
    current = get_current_version()
    result = {"ok": False, "latest": current, "current": current, "notes": "", "asset_url": None, "published_at": None, "error": None}
    try:
        release = _github_json(f"{API_ROOT}/releases/latest", timeout)
        latest = str(release.get("tag_name", "")).strip()
        parse_version(latest)
        asset = pick_asset(release)
        result.update(ok=compare_versions(latest, current) > 0, latest=latest.lstrip("v"), notes=str(release.get("body") or ""), published_at=release.get("published_at"), asset_url=asset.get("url") if asset else None)
        if not asset:
            result["error"] = "No Windows .exe or .zip asset found"
        else:
            result["asset"] = asset
    except urllib.error.HTTPError as exc:
        result["error"] = f"GitHub HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError, OSError):
        result["error"] = "Network unavailable"
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        result["error"] = "Invalid release metadata"
    return result


class DownloadCancelled(Exception):
    """Raised when the progress callback requests cancellation."""


def _download_url(url: str, target: Path, progress_cb: Optional[Callable] = None, expected: Optional[str] = None, timeout: int = 30) -> Path:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream"})
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    digest = hashlib.sha256(); written = 0
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response, part.open("wb") as stream:
            total = int(response.headers.get("Content-Length") or 0)
            while True:
                chunk = response.read(256 * 1024)
                if not chunk:
                    break
                stream.write(chunk); digest.update(chunk); written += len(chunk)
                if progress_cb:
                    value = progress_cb(written, total)
                    if value is False:
                        raise DownloadCancelled()
        actual = digest.hexdigest()
        if expected and actual != expected.lower().removeprefix("sha256:"):
            raise ValueError(f"SHA-256 mismatch: expected {expected}, got {actual}")
        os.replace(part, target)
        return target
    finally:
        if part.exists():
            try: part.unlink()
            except OSError: pass


def download(asset: Mapping, progress_cb: Optional[Callable] = None, timeout: int = 30) -> str:
    """Download an asset to %LOCALAPPDATA%/Hymnix/updates and verify SHA-256."""
    url = str(asset.get("url") or asset.get("asset_url") or "")
    if not url:
        raise ValueError("asset URL is missing")
    root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "Hymnix" / "updates"
    name = Path(urllib.parse.urlparse(url).path).name or str(asset.get("name") or "update.bin")
    expected = asset.get("sha256") or asset.get("digest")
    checks_url = asset.get("checksums_url")
    if checks_url and not expected:
        text = _github_json(str(checks_url), timeout) if str(checks_url).endswith(".json") else None
        if text is not None: expected = text.get(name)
        else:
            req = urllib.request.Request(str(checks_url), headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as response: expected = parse_checksums(response.read().decode("utf-8", "replace")).get(name)
    return str(_download_url(url, root / name, progress_cb, expected, timeout))


def apply_and_restart(asset_path: os.PathLike | str, pid: Optional[int] = None) -> str:
    """Schedule replacement after this process exits; returns the batch path."""
    if os.name != "nt":
        raise OSError("Windows updates are supported only on Windows")
    new = Path(asset_path).resolve()
    if not new.is_file(): raise FileNotFoundError(new)
    exe = Path(sys.executable if getattr(sys, "frozen", False) else sys.argv[0]).resolve()
    pid = os.getpid() if pid is None else int(pid)
    fd, bat = tempfile.mkstemp(prefix="hymnix_update_", suffix=".bat", dir=os.environ.get("TEMP") or tempfile.gettempdir()); os.close(fd)
    def quote(path: Path) -> str: return '"' + str(path).replace("%", "%%") + '"'
    lines = ["@echo off", "setlocal", f"set HYM_PID={pid}", f"set HYM_EXE={quote(exe)}", f"set HYM_NEW={quote(new)}", ":wait", 'tasklist /FI \"PID eq %HYM_PID%\" /NH | find \"%HYM_PID%\" >nul', "if not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait)", "move /y %HYM_NEW% %HYM_EXE% >nul", "if errorlevel 1 exit /b 1", 'start \"\" %HYM_EXE%', "del /f /q %~f0 >nul 2>&1"]
    Path(bat).write_text("\r\n".join(lines) + "\r\n", encoding="mbcs")
    subprocess.Popen(["cmd.exe", "/c", "start", "", bat], close_fds=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return bat


def apply(path: os.PathLike | str) -> str:
    return apply_and_restart(path)

# Compatibility names used by earlier prototypes.
CURRENT_VERSION = __version__
REPO_PATH = f"{OWNER}/{REPO}"
