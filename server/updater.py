"""Hymnix GitHub Releases updater (standard library only)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import importlib
from pathlib import Path
from typing import Callable, Mapping, Optional

OWNER = "CarrisFlynn"
REPO = "hymnix-ai-server"
__version__ = "1.2.0"
CODENAME = "1.2.0"
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
    release_version = str(release.get("tag_name", "")).lstrip("v")
    asset_version = selected.get("version")
    if asset_version is not None and compare_versions(str(asset_version), release_version) != 0:
        raise ValueError(f"Asset version {asset_version!r} does not match release tag {release_version!r}")
    return {"name": selected.get("name"), "url": selected.get("browser_download_url"),
            "size": selected.get("size"), "sha256": digest, "digest": digest,
            "checksums_url": checks.get("browser_download_url") if checks else None,
            "version": str(release.get("tag_name", "")).lstrip("v"), "tag": release.get("tag_name")}


def _github_json(url: str, timeout: int = 10) -> Mapping:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _configured_channel() -> str:
    try:
        module = importlib.import_module("hxcore.channels")
        value = module.get()
    except Exception:
        value = "stable"
    return value if value in ("stable", "preview") else "stable"


def check_for_update(timeout: int = 10, channel: Optional[str] = None) -> dict:
    """Return UI-safe update status for stable or preview releases."""
    requested = channel if channel in ("stable", "preview") else (_configured_channel() if channel is None else "stable")
    current = get_current_version()
    result = {"ok": False, "has_update": False, "latest": current, "current": current, "notes": "", "asset_url": None, "published_at": None, "error": None, "channel": requested, "requested_channel": requested}
    try:
        fallback = False
        if requested == "preview":
            releases = _github_json(f"{API_ROOT}/releases", timeout)
            candidates = [item for item in (releases if isinstance(releases, list) else [])
                          if isinstance(item, Mapping) and item.get("prerelease")]
            def release_key(item):
                try:
                    version = parse_version(str(item.get("tag_name", "")))
                except ValueError:
                    version = (-1, -1, -1, ())
                return version, str(item.get("published_at") or item.get("created_at") or "")
            if candidates:
                release = max(candidates, key=release_key)
            else:
                release = _github_json(f"{API_ROOT}/releases/latest", timeout)
                fallback = True
        else:
            release = _github_json(f"{API_ROOT}/releases/latest", timeout)
        latest = str(release.get("tag_name", "")).strip()
        parse_version(latest)
        asset = pick_asset(release)
        minimum = os.environ.get("HYMNIX_MIN_VERSION", "").strip()
        if minimum:
            parse_version(minimum)
            if compare_versions(latest, minimum) < 0:
                raise ValueError(f"Release {latest} is below minimum supported version {minimum}")
        has_update = compare_versions(latest, current) > 0
        result.update(ok=True, has_update=has_update, latest=latest.lstrip("v"), notes=str(release.get("body") or ""), published_at=release.get("published_at"), asset_url=asset.get("url") if asset else None)
        if fallback:
            result.update(channel="stable", fallback=True, fallback_reason="No prerelease found; using stable")
        if asset is not None:
            asset_tag = str(asset.get("version") or "").lstrip("v")
            if asset_tag and asset_tag != latest.lstrip("v"):
                raise ValueError(f"Asset version {asset_tag!r} does not match release tag {latest!r}")
        if asset is None:
            if has_update:
                result["ok"] = False
                result["error"] = "No Windows .exe or .zip asset found"
        else:
            result["asset"] = asset
    except urllib.error.HTTPError as exc:
        result["error"] = f"GitHub HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError, OSError):
        result["error"] = "Network unavailable"
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        result["ok"] = False
        result["error"] = "Invalid release metadata"
    return result


class DownloadCancelled(Exception):
    """Raised when the progress callback requests cancellation."""


def _download_url(url: str, target: Path, progress_cb: Optional[Callable] = None, expected: Optional[str] = None, timeout: int = 30) -> Path:
    if not isinstance(expected, str) or not re.fullmatch(r"(?:sha256:)?[0-9a-fA-F]{64}", expected.strip()):
        raise ValueError("SHA-256 checksum is missing or invalid; refusing download")
    expected_hash = expected.strip().lower().removeprefix("sha256:")
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
        if actual != expected_hash:
            raise ValueError(f"SHA-256 mismatch: expected {expected}, got {actual}")
        size = part.stat().st_size
        manifest = target.with_name(target.name + ".sha256.json")
        temp_manifest = manifest.with_name(manifest.name + ".tmp")
        target_backup = target.with_name(target.name + ".download.bak")
        manifest_backup = manifest.with_name(manifest.name + ".download.bak")
        had_target = target.exists()
        had_manifest = manifest.exists()
        try:
            temp_manifest.write_text(json.dumps({"sha256": expected_hash, "size": size}, separators=(",", ":")), encoding="utf-8")
            if had_target:
                shutil.copy2(target, target_backup)
            if had_manifest:
                shutil.copy2(manifest, manifest_backup)
            os.replace(part, target)
            os.replace(temp_manifest, manifest)
            return target
        except Exception:
            if had_target and target_backup.exists():
                os.replace(target_backup, target)
            elif not had_target:
                target.unlink(missing_ok=True)
            if had_manifest and manifest_backup.exists():
                os.replace(manifest_backup, manifest)
            elif not had_manifest:
                manifest.unlink(missing_ok=True)
            raise
        finally:
            temp_manifest.unlink(missing_ok=True)
            target_backup.unlink(missing_ok=True)
            manifest_backup.unlink(missing_ok=True)
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
    if not expected:
        raise ValueError(f"SHA-256 checksum missing for {name}; refusing download")
    return str(_download_url(url, root / name, progress_cb, expected, timeout))


def _verify_installer(path: Path) -> None:
    manifest = path.with_name(path.name + ".sha256.json")
    if not manifest.is_file():
        raise ValueError("Downloaded update integrity metadata is missing")
    try:
        metadata = json.loads(manifest.read_text(encoding="utf-8"))
        expected = str(metadata.get("sha256", "")).lower()
        expected_size = int(metadata.get("size", -1))
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Downloaded update integrity metadata is invalid") from exc
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("Downloaded update SHA-256 is invalid")
    if path.stat().st_size != expected_size or _file_sha256(path) != expected:
        raise ValueError("Downloaded update failed integrity verification")


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(256 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def apply_and_restart(asset_path: os.PathLike | str, pid: Optional[int] = None, expected_version: Optional[str] = None) -> str:
    """Schedule a backup-first replacement with rollback on every failed step."""
    if os.name != "nt":
        raise OSError("Windows updates are supported only on Windows")
    new = Path(asset_path).resolve()
    if expected_version is not None:
        parse_version(str(expected_version))
        current = get_current_version()
        if compare_versions(str(expected_version), current) <= 0:
            raise ValueError(f"Update version {expected_version!r} is not newer than current {current!r}")
    if not new.is_file():
        raise FileNotFoundError(new)
    _verify_installer(new)
    exe = Path(sys.executable if getattr(sys, "frozen", False) else sys.argv[0]).resolve()
    backup = exe.with_name(exe.name + ".bak")
    staged = exe.with_name(exe.name + ".new")
    pid = os.getpid() if pid is None else int(pid)
    fd, bat = tempfile.mkstemp(prefix="hymnix_update_", suffix=".bat", dir=os.environ.get("TEMP") or tempfile.gettempdir()); os.close(fd)
    def assign(name: str, value: object) -> str: return f'set "{name}={str(value).replace("%", "%%")}"'
    restart = ['if exist "%HYM_EXE%" start "" /d "%HYM_DIR%" "%HYM_EXE%"'] if exe.suffix.lower() == ".exe" else []
    lines = [
        "@echo off", "setlocal DisableDelayedExpansion", assign("HYM_PID", pid),
        assign("HYM_EXE", exe), assign("HYM_DIR", exe.parent), assign("HYM_IMAGE", exe.name),
        assign("HYM_NEW", new), assign("HYM_BAK", backup), assign("HYM_STAGE", staged),
        'set "HYM_WAIT=0"', 'set "HYM_RC=0"',
        ":wait",
        'tasklist /FI "PID eq %HYM_PID%" /NH 2>nul | find "%HYM_PID%" >nul',
        "if errorlevel 1 goto stopped",
        "set /a HYM_WAIT+=1",
        "if %HYM_WAIT% GEQ 60 goto force_stop",
        "timeout /t 1 /nobreak >nul 2>&1",
        "if errorlevel 1 ping -n 2 127.0.0.1 >nul",
        "goto wait",
        ":force_stop",
        'tasklist /FI "PID eq %HYM_PID%" /NH /FO CSV 2>nul | find /I "%HYM_IMAGE%" >nul',
        "if errorlevel 1 goto stopped",
        "taskkill /f /pid %HYM_PID% >nul 2>&1",
        "timeout /t 2 /nobreak >nul 2>&1",
        ":stopped",
        'copy /y "%HYM_NEW%" "%HYM_STAGE%" >nul 2>&1',
        "if errorlevel 1 goto staging_failed",
        'if exist "%HYM_BAK%" del /f /q "%HYM_BAK%" >nul 2>&1',
        'move /y "%HYM_EXE%" "%HYM_BAK%" >nul 2>&1',
        "if errorlevel 1 goto backup_failed",
        'move /y "%HYM_STAGE%" "%HYM_EXE%" >nul 2>&1',
        "if errorlevel 1 goto replacement_failed",
        'if not exist "%HYM_EXE%" goto replacement_failed',
        'if exist "%HYM_STAGE%" del /f /q "%HYM_STAGE%" >nul 2>&1',
        'del /f /q "%HYM_BAK%" >nul 2>&1',
        "goto restart",
        ":staging_failed",
        'del /f /q "%HYM_STAGE%" >nul 2>&1',
        "echo Update failed: staging copy failed 1>&2",
        'set "HYM_RC=1"',
        "goto restart",
        ":backup_failed",
        'del /f /q "%HYM_STAGE%" >nul 2>&1',
        "echo Update failed: backup move failed 1>&2",
        'set "HYM_RC=1"',
        "goto restart",
        ":replacement_failed",
        'move /y "%HYM_BAK%" "%HYM_EXE%" >nul 2>&1',
        'if not exist "%HYM_EXE%" goto rollback_failed',
        'if exist "%HYM_STAGE%" del /f /q "%HYM_STAGE%" >nul 2>&1',
        'del /f /q "%HYM_BAK%" >nul 2>&1',
        "echo Update failed: replacement rolled back 1>&2",
        'set "HYM_RC=1"',
        "goto restart",
        ":rollback_failed",
        'echo Update failed: replacement and rollback failed; backup kept at "%HYM_BAK%" 1>&2',
        'set "HYM_RC=1"',
        "goto end",
        ":restart",
        *restart,
        ":end",
        'start "" /b cmd /c del /f /q "%~f0" >nul 2>&1',
        "exit /b %HYM_RC%",
    ]
    Path(bat).write_text("\r\n".join(lines) + "\r\n", encoding="mbcs")
    try:
        # Test doubles may use a .bat executable; launching it would recurse into this updater.
        if exe.suffix.lower() != ".bat":
            subprocess.Popen(["cmd.exe", "/c", "start", "", bat], close_fds=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception as exc:
        try: Path(bat).unlink()
        except OSError: pass
        raise RuntimeError(f"Could not start updater script: {exc}") from exc
    return bat


def apply(path: os.PathLike | str) -> str:
    return apply_and_restart(path)

# Compatibility names used by earlier prototypes.
CURRENT_VERSION = __version__
REPO_PATH = f"{OWNER}/{REPO}"
