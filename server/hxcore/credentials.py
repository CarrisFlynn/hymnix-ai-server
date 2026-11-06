# -*- coding: utf-8 -*-
"""Read-only credential helpers for git and environment secrets."""
from __future__ import annotations

import os
import shutil
import subprocess
import threading
from typing import Any, Callable


def _mask(value: Any) -> str:
    try:
        text = "" if value is None else str(value)
        if not text:
            return ""
        if len(text) <= 4:
            return "****"
        return text[:2] + "****" + text[-2:]
    except Exception:
        return ""


def available() -> dict:
    """Return availability of git credential support and environment reads."""
    try:
        git_ok = shutil.which("git") is not None
    except Exception:
        git_ok = False
    try:
        env_ok = isinstance(os.environ, dict) or hasattr(os.environ, "get")
    except Exception:
        env_ok = False
    return {"git": bool(git_ok), "env": bool(env_ok)}


def git_credential(host: str, *, protocol: str = "https", timeout: float = 5, _runner: Callable[..., Any] | None = None) -> dict:
    """Fill a git credential without persisting or exposing its secret."""
    result = {"ok": False, "username": "", "secret_masked": "", "has_secret": False, "error": None}
    try:
        if not isinstance(host, str) or not host.strip():
            result["error"] = "invalid_host"
            return result
        if not isinstance(protocol, str) or not protocol.strip():
            result["error"] = "invalid_protocol"
            return result
        if timeout is None or float(timeout) <= 0:
            result["error"] = "invalid_timeout"
            return result
        payload = ("protocol=" + protocol.strip() + "\nhost=" + host.strip() + "\n\n").encode("utf-8")
        runner = _runner or subprocess.run
        outcome = {}

        def invoke_runner():
            try:
                try:
                    outcome["value"] = runner(["git", "credential", "fill"], input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=float(timeout), check=False)
                except TypeError:
                    outcome["value"] = runner(["git", "credential", "fill"], input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            except BaseException as exc:
                outcome["exception"] = exc

        worker = threading.Thread(target=invoke_runner, daemon=True)
        worker.start()
        worker.join(float(timeout))
        if worker.is_alive():
            result["error"] = "timeout"
            return result
        if "exception" in outcome:
            raise outcome["exception"]
        completed = outcome.get("value")
        if completed is None:
            result["error"] = "runner_error"
            return result
        raw = completed.stdout
        if isinstance(raw, bytes):
            text = raw.decode("utf-8", errors="strict")
        else:
            text = str(raw or "")
        values = {}
        for line in text.splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                values[key.strip().lower()] = value
        username = values.get("username", "")
        secret = values.get("password", "")
        if not username and not secret:
            result["error"] = "no_credential"
            return result
        if username and not secret:
            result.update(username=username, error="partial_credential")
            return result
        result.update(ok=True, username=username, secret_masked=_mask(secret), has_secret=True)
        return result
    except subprocess.TimeoutExpired:
        result["error"] = "timeout"
        return result
    except FileNotFoundError:
        result["error"] = "git_not_found"
        return result
    except UnicodeError:
        result["error"] = "decode_error"
        return result
    except Exception as exc:
        result["error"] = type(exc).__name__
        return result


def env_secret(name: str) -> dict:
    """Read and mask one environment secret without exposing its value."""
    result = {"ok": False, "set": False, "masked": ""}
    try:
        if not isinstance(name, str) or not name:
            return result
        value = os.environ.get(name)
        result.update(ok=True, set=value is not None and value != "", masked=_mask(value) if value else "")
        return result
    except Exception:
        return result


def selftest() -> bool:
    """Run non-network checks for the public credential helpers."""
    try:
        assert set(available()) == {"git", "env"}
        assert env_secret("__HXCORE_CREDENTIALS_MISSING__")["ok"] is True
        fake = lambda *args, **kwargs: type("Completed", (), {"stdout": b"protocol=https\nhost=x\nusername=alice\npassword=secret1234\n", "stderr": b"", "returncode": 0})()
        got = git_credential("example.test", _runner=fake)
        assert got["ok"] and got["username"] == "alice" and got["has_secret"]
        assert got["secret_masked"] == "se****34"
        return True
    except Exception:
        return False


if __name__ == "__main__":
    print("SELFTEST OK" if selftest() else "SELFTEST FAIL")
