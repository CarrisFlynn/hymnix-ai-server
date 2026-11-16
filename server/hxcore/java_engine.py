"""Optional Java sidecar lifecycle adapter with a silent preflight fallback.

Call from a worker thread. Once a Java request is sent, failures are surfaced rather
than replayed through Python because delivery may be ambiguous.
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass
from enum import Enum
from pathlib import Path


_JAR_RELATIVE_PATH = Path("engine-java") / "build" / "hymnix-engine.jar"


def _resolve_jar_path(jar_path=None):
    """Resolve the sidecar payload for source and frozen application layouts."""
    if jar_path is not None:
        candidate = Path(jar_path)
        return candidate if candidate.is_absolute() else None
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass) / _JAR_RELATIVE_PATH
    return Path(__file__).resolve().parents[2] / _JAR_RELATIVE_PATH



class JavaPreflightStatus(str, Enum):
    DISABLED = "disabled"
    MISSING_JAR = "missing_jar"
    MISSING_RUNTIME = "missing_runtime"
    WRONG_MAJOR = "wrong_major"
    READY = "ready"


@dataclass(frozen=True)
class JavaPreflightResult:
    status: JavaPreflightStatus
    java_bin: str | None = None
    java_major: int | None = None


def resolve_java_bin(explicit=None):
    """Select Java in the documented order without using the CWD."""
    if explicit:
        candidate = Path(explicit)
        return str(candidate) if candidate.is_absolute() else None
    executable = "java.exe" if os.name == "nt" else "java"
    if getattr(sys, "frozen", False) or getattr(sys, "_MEIPASS", None):
        candidate = Path(sys.executable).resolve().parent / "runtime" / "java" / "bin" / executable
        if candidate.is_file():
            return str(candidate)
    java_home = os.environ.get("JAVA_HOME", "").strip()
    executable = "java.exe" if os.name == "nt" else "java"
    if java_home:
        candidate = Path(java_home) / "bin" / executable
        if candidate.is_file():
            return str(candidate)
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        entry = entry.strip()
        if not entry:
            continue
        directory = Path(entry)
        if not directory.is_absolute():
            continue
        candidate = directory / executable
        if candidate.is_file():
            return str(candidate)
    return None


def _java_major(version_text):
    match = re.search(r'version\s+\"(?:1\.)?(\d+)(?:[.+-]|\")', version_text, re.IGNORECASE)
    return int(match.group(1)) if match else None


def preflight_java(*, enabled, jar_path, java_bin=None):
    if not enabled:
        return JavaPreflightResult(JavaPreflightStatus.DISABLED)
    jar = Path(jar_path) if jar_path is not None else None
    if jar is None or not jar.is_absolute() or not jar.is_file():
        return JavaPreflightResult(JavaPreflightStatus.MISSING_JAR)
    resolved = resolve_java_bin(java_bin)
    if not resolved:
        return JavaPreflightResult(JavaPreflightStatus.MISSING_RUNTIME)
    try:
        probe = subprocess.run(
            [resolved, "-version"], capture_output=True, text=True, timeout=3, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return JavaPreflightResult(JavaPreflightStatus.MISSING_RUNTIME, java_bin=resolved)
    if probe.returncode != 0:
        return JavaPreflightResult(JavaPreflightStatus.MISSING_RUNTIME, java_bin=resolved)
    version_text = (probe.stdout or "") + "\n" + (probe.stderr or "")
    major = _java_major(version_text)
    if major != 25:
        return JavaPreflightResult(JavaPreflightStatus.WRONG_MAJOR, java_bin=resolved, java_major=major)
    return JavaPreflightResult(JavaPreflightStatus.READY, java_bin=resolved, java_major=major)


class JavaEngineError(RuntimeError):
    pass


class JavaEngineAdapter:
    """Start and call the loopback Java sidecar when explicitly requested."""

    def __init__(self, *, jar_path=None, java_bin=None, upstream=None, base_url=None,
                 process_factory=None, request_timeout=3.0, stream_timeout=300.0):
        self.mode = os.environ.get("HYMNIX_ENGINE", "python").strip().lower()
        if self.mode not in {"python", "java"}:
            self.mode = "python"
        self.jar_path = _resolve_jar_path(jar_path)
        self.java_bin = java_bin
        self.upstream = upstream or os.environ.get("HYMNIX_ENGINE_UPSTREAM", "http://127.0.0.1:11434")
        self.upstream_api_key = os.environ.get("HYMNIX_ENGINE_UPSTREAM_API_KEY", "")
        self.base_url = base_url.rstrip("/") if base_url else None
        self.process_factory = process_factory or subprocess.Popen
        self.request_timeout = float(request_timeout)
        self.stream_timeout = float(stream_timeout)
        self.process = None
        self._drain_thread = None
        self._lock = threading.RLock()
        self.last_preflight = None

    def preflight(self):
        result = preflight_java(enabled=self.mode == "java", jar_path=self.jar_path, java_bin=self.java_bin)
        self.last_preflight = result
        return result

    @property
    def enabled(self):
        return self.mode == "java" and (
            self.base_url is not None or (self.jar_path is not None and self.jar_path.is_file())
        )

    def _free_port(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    def _drain(self, stream):
        try:
            for _line in iter(stream.readline, ""):
                pass
        except Exception:
            pass

    def start(self):
        if self.mode != "java":
            self.last_preflight = JavaPreflightResult(JavaPreflightStatus.DISABLED)
            return False
        if self.base_url is not None:
            return self._healthy()
        result = self.preflight()
        if result.status is not JavaPreflightStatus.READY:
            return False
        with self._lock:
            if self.process is not None:
                if self.process.poll() is None:
                    return bool(self.base_url and self._healthy())
                self.process = None
                self.base_url = None
            elif self.base_url and self._healthy():
                return True
            port = self._free_port()
            command = [result.java_bin, "-jar", str(self.jar_path), str(port), self.upstream]
            try:
                process_env = os.environ.copy()
                if self.upstream_api_key.strip():
                    process_env["HYMNIX_ENGINE_UPSTREAM_API_KEY"] = self.upstream_api_key
                else:
                    process_env.pop("HYMNIX_ENGINE_UPSTREAM_API_KEY", None)
                self.process = self.process_factory(command, stdout=subprocess.PIPE,
                                                    stderr=subprocess.STDOUT, text=True, env=process_env,
                                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except Exception:
                self.process = None
                return False
            if self.process.stdout is not None:
                self._drain_thread = threading.Thread(target=self._drain, args=(self.process.stdout,), daemon=True)
                self._drain_thread.start()
            self.base_url = "http://127.0.0.1:%d" % port
        deadline = time.monotonic() + self.request_timeout
        while time.monotonic() < deadline:
            if self._healthy():
                return True
            if self.process is not None and self.process.poll() is not None:
                break
            time.sleep(0.05)
        self.close()
        return False

    def _healthy(self):
        if not self.base_url:
            return False
        try:
            with urllib.request.urlopen(self.base_url + "/healthz", timeout=self.request_timeout) as response:
                return response.status == 200 and b'"status":"ok"' in response.read(4096)
        except Exception:
            return False

    def request(self, payload, python_request, on_chunk=None, cancel_event=None):
        """Proxy one request, closing the stream on cancellation without replay."""
        if cancel_event is not None and cancel_event.is_set():
            raise JavaEngineError("Java request cancelled before dispatch; not replayed")
        if self.mode != "java" or not self.start():
            if cancel_event is not None and cancel_event.is_set():
                raise JavaEngineError("Java request cancelled before Python fallback; not replayed")
            return python_request(payload)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(self.base_url + "/v1/chat/completions", data=body,
                                         headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
        try:
            response = urllib.request.urlopen(request, timeout=self.stream_timeout)
        except Exception as exc:
            raise JavaEngineError("Java request failed before response; not replayed") from exc
        cancel_monitor = None
        monitor_stop = threading.Event()
        if cancel_event is not None:
            def close_on_cancel():
                while not monitor_stop.wait(0.05):
                    if cancel_event.is_set():
                        response.close()
                        return
            cancel_monitor = threading.Thread(target=close_on_cancel, daemon=True)
            cancel_monitor.start()
        try:
            status = response.status
            content_type = response.headers.get("Content-Type", "")
            chunks = []
            try:
                reader = getattr(response, "read1", response.read)
                while True:
                    if cancel_event is not None and cancel_event.is_set():
                        raise JavaEngineError("Java request cancelled while streaming; not replayed")
                    chunk = reader(4096)
                    if not chunk:
                        break
                    if on_chunk is None:
                        chunks.append(chunk)
                    else:
                        on_chunk(chunk)
            except JavaEngineError:
                raise
            except Exception as exc:
                if cancel_event is not None and cancel_event.is_set():
                    raise JavaEngineError("Java request cancelled while streaming; not replayed") from exc
                raise JavaEngineError("Java response interrupted; not replayed") from exc
            if cancel_event is not None and cancel_event.is_set():
                raise JavaEngineError("Java request cancelled while streaming; not replayed")
            return status, content_type, b"".join(chunks) if on_chunk is None else None
        finally:
            monitor_stop.set()
            response.close()
            if cancel_monitor is not None:
                cancel_monitor.join(timeout=0.2)

    def close(self):
        with self._lock:
            process, self.process = self.process, None
            if process is not None:
                self.base_url = None
        if process is not None:
            try:
                process.terminate()
                process.wait(timeout=1.0)
            except Exception:
                try:
                    process.kill()
                    process.wait(timeout=1.0)
                except Exception:
                    pass


__all__ = [
    "JavaEngineAdapter", "JavaEngineError",
    "JavaPreflightStatus", "JavaPreflightResult",
    "resolve_java_bin", "preflight_java",
]
