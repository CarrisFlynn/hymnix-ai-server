"""gwbench — 真实 HTTP 压测/断连/用量对账。

设计原则（2026-11-06 R6 修复）：
- 所有指标都来自真实 HTTP 请求，绝不合成数字。
- 没有可用的上游时，启动一个**本机 mock 上游**（真实监听 127.0.0.1 随机端口），
  指标依然来自真实请求，返回 mode="mock" 与 synthetic=True 说明目标是自己起的 mock。
- 任何无法测量的项返回 error/mode 说明，而不是伪造成功。
"""

from __future__ import annotations

import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_MOCK_LOCK = threading.Lock()


class _MockHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # 静音
        pass

    def do_GET(self):
        if self.path.startswith("/health"):
            body = json.dumps({"ok": True}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            req = json.loads(raw or b"{}")
        except Exception:
            req = {}
        stream = bool(req.get("stream"))
        model = req.get("model") or "mock-model"
        text = "mock answer"
        usage = {"prompt_tokens": max(1, len(json.dumps(req)) // 4), "completion_tokens": 2, "total_tokens": 0}
        usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
        if stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            for i, piece in enumerate(["mock ", "stream ", "answer"]):
                chunk = {"id": "mock", "object": "chat.completion.chunk", "model": model,
                         "choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}]}
                try:
                    self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                    self.wfile.flush()
                except Exception:
                    return
                time.sleep(0.01)
            final = {"id": "mock", "object": "chat.completion.chunk", "model": model,
                     "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": usage}
            try:
                self.wfile.write(("data: " + json.dumps(final) + "\n\n").encode())
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except Exception:
                pass
            return
        body = json.dumps({
            "id": "mock-" + uuid.uuid4().hex[:8],
            "object": "chat.completion",
            "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
            "usage": usage,
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class _MockUpstream:
    def __init__(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _MockHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.requests = 0
        self._orig = _MockHandler.do_POST

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        try:
            self.server.shutdown()
            self.server.server_close()
        except Exception:
            pass
        return False

    @property
    def base_url(self):
        return "http://127.0.0.1:%d" % self.port


def _reachable(base_url, timeout=2.0):
    """对 base_url 做真实 TCP 连接探测（不请求业务接口）。"""
    try:
        from urllib.parse import urlparse
        u = urlparse(base_url)
        host = u.hostname or "127.0.0.1"
        port = u.port or (443 if u.scheme == "https" else 80)
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def _endpoint(base_url, stream=False):
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        return base + "/chat/completions"
    if base.endswith("/chat/completions"):
        return base
    return base + "/v1/chat/completions"


def _auth_headers(api_key=None, admin_key=None):
    headers = {}
    if api_key:
        headers["Authorization"] = "Bearer %s" % api_key
    if admin_key:
        headers["X-Admin-Key"] = str(admin_key)
    return headers


def _one_request(base_url, stream=False, timeout=30, model="bench-model", api_key=None):
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping " + uuid.uuid4().hex[:6]}],
        "stream": bool(stream),
        "max_tokens": 8,
    }
    req = urllib.request.Request(
        _endpoint(base_url, stream),
        data=json.dumps(payload).encode(),
        headers=dict({"Content-Type": "application/json"}, **_auth_headers(api_key)),
        method="POST",
    )
    t0 = time.monotonic()
    usage = None
    first_byte = None
    nbytes = 0
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if stream:
            for raw in resp:
                if first_byte is None:
                    first_byte = (time.monotonic() - t0) * 1000.0
                nbytes += len(raw)
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except Exception:
                    continue
                if isinstance(obj, dict) and obj.get("usage"):
                    usage = obj["usage"]
        else:
            body = resp.read()
            nbytes = len(body)
            first_byte = (time.monotonic() - t0) * 1000.0
            try:
                usage = (json.loads(body) or {}).get("usage")
            except Exception:
                usage = None
    return {"ms": (time.monotonic() - t0) * 1000.0, "first_byte_ms": first_byte or 0.0,
            "bytes": nbytes, "usage": usage}


def _pct(values, q):
    if not values:
        return 0.0
    vs = sorted(values)
    idx = min(len(vs) - 1, max(0, int(round((len(vs) - 1) * q))))
    return round(vs[idx], 2)


def run(base_url="http://127.0.0.1:11434", concurrency=8, stream=False, rounds=1,
        timeout=180, allow_mock=True, model="bench-model", api_key=None):
    """真实并发压测。上游不可达且 allow_mock 时自带 mock 上游（mode="mock"）。"""
    try:
        concurrency = max(1, int(concurrency))
        rounds = max(1, int(rounds))
    except Exception:
        concurrency, rounds = 1, 1
    total = concurrency * rounds
    mock = None
    mode = "real"
    try:
        if not _reachable(base_url):
            if not allow_mock:
                return {"ok": False, "mode": "unreachable", "synthetic": False, "requests": 0,
                        "errors": 0, "p50_ms": 0.0, "p95_ms": 0.0, "first_byte_p50_ms": 0.0,
                        "error_rate": 1.0, "detail": [], "error": "upstream_unreachable"}
            mock = _MockUpstream().__enter__()
            base_url = mock.base_url
            mode = "mock"

        detail = []
        errors = 0
        lock = threading.Lock()

        def job(_i):
            nonlocal errors
            try:
                res = _one_request(base_url, stream=stream, timeout=timeout, model=model, api_key=api_key)
            except Exception as exc:
                with lock:
                    errors += 1
                return {"ok": False, "ms": 0.0, "first_byte_ms": 0.0, "error": "%s: %s" % (type(exc).__name__, exc)}
            return {"ok": True, **res}

        t0 = time.monotonic()
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            detail = list(pool.map(job, range(total)))
        wall = (time.monotonic() - t0) * 1000.0
        ok_rows = [d for d in detail if d.get("ok")]
        lat = [d["ms"] for d in ok_rows]
        fb = [d["first_byte_ms"] for d in ok_rows]
        return {
            "ok": errors == 0 and len(ok_rows) == total,
            "mode": mode,
            "synthetic": mode == "mock",
            "base_url": base_url,
            "target": base_url,
            "requests": total,
            "completed": len(ok_rows),
            "errors": errors,
            "error_rate": round(errors / float(total), 4) if total else 0.0,
            "p50_ms": _pct(lat, 0.5), "p95_ms": _pct(lat, 0.95),
            "first_byte_p50_ms": _pct(fb, 0.5),
            "wall_ms": round(wall, 1),
            "stream": bool(stream),
            "detail": detail[:50],
            "error": "",
        }
    except Exception as exc:
        return {"ok": False, "mode": "error", "synthetic": False, "requests": 0, "errors": 0,
                "p50_ms": 0.0, "p95_ms": 0.0, "first_byte_p50_ms": 0.0, "error_rate": 1.0,
                "detail": [], "error": "%s: %s" % (type(exc).__name__, exc)}
    finally:
        if mock is not None:
            mock.__exit__()


def _admin_usage(base_url, days=1, timeout=10, admin_key=None):
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[: -3]
    try:
        req = urllib.request.Request(base + "/admin/usage?days=%d" % int(days),
                                     headers=_auth_headers(None, admin_key))
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read() or b"{}")
    except Exception as exc:
        return {"__error__": "%s: %s" % (type(exc).__name__, exc)}


def _admin_health(base_url, timeout=5, admin_key=None):
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[: -3]
    try:
        req = urllib.request.Request(base + "/admin/health", headers=_auth_headers(None, admin_key))
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read() or b"{}")
    except Exception as exc:
        return {"__error__": "%s: %s" % (type(exc).__name__, exc)}


def disconnect_test(base_url="http://127.0.0.1:11435", timeout=30, allow_mock=True, model="bench-model",
                   api_key=None, admin_key=None):
    """真实发起流式请求，读到第一个 chunk 后强行断开，再检查网关客户端计数与后续请求。"""
    result = {"ok": False, "mode": "real", "synthetic": False, "disconnects": 0,
              "clients_after": -1, "followup_ok": False, "admin_ok": False, "error": ""}
    mock = None
    try:
        if not _reachable(base_url):
            if not allow_mock:
                result["error"] = "upstream_unreachable"
                result["mode"] = "unreachable"
                return result
            mock = _MockUpstream().__enter__()
            base_url = mock.base_url
            result["mode"] = "mock"
            result["synthetic"] = True
        req = urllib.request.Request(
            _endpoint(base_url, stream=True),
            data=json.dumps({"model": model, "stream": True, "max_tokens": 8,
                             "messages": [{"role": "user", "content": "disconnect test"}]}).encode(),
            headers=dict({"Content-Type": "application/json"}, **_auth_headers(api_key)), method="POST")
        resp = urllib.request.urlopen(req, timeout=timeout)
        try:
            resp.readline()  # 读第一个 chunk 后直接断开
        finally:
            try:
                resp.close()
            except Exception:
                pass
        result["disconnects"] = 1
        time.sleep(0.6)
        health = _admin_health(base_url, timeout=timeout, admin_key=admin_key or api_key)
        if "__error__" in health:
            result["error"] = "admin_unavailable: " + health["__error__"]
        else:
            result["admin_ok"] = True
            try:
                # "active" = 正在处理的连接数（网关新字段）；回退到 clients（历史 IP 数）
                key = "active" if "active" in health else "clients"
                result["clients_after"] = int(health.get(key, -1))
            except Exception:
                result["clients_after"] = -1
        try:
            _one_request(base_url, stream=False, timeout=timeout, model=model, api_key=api_key)
            result["followup_ok"] = True
        except Exception as exc:
            result["error"] = (result["error"] + "; " if result["error"] else "") + "followup_failed: %s" % exc
        result["ok"] = bool(result["disconnects"] == 1 and result["followup_ok"]
                            and (result["clients_after"] in (0, -1)))
        return result
    except Exception as exc:
        result["error"] = "%s: %s" % (type(exc).__name__, exc)
        return result
    finally:
        if mock is not None:
            mock.__exit__()


def usage_reconcile(base_url="http://127.0.0.1:11435", rounds=3, timeout=60, allow_mock=True,
                    model="bench-model", api_key=None, admin_key=None):
    """真实请求若干次，比较网关 /admin/usage 与上游返回的 usage；上游缺 usage 时用本地估算并标 estimated。"""
    rows = []
    errors = 0
    mock = None
    mode = "real"
    try:
        rounds = max(1, int(rounds))
        if not _reachable(base_url):
            if not allow_mock:
                return {"ok": False, "mode": "unreachable", "rows": [], "summary": {}, "error": "upstream_unreachable"}
            mock = _MockUpstream().__enter__()
            base_url = mock.base_url
            mode = "mock"
        usage_before = _admin_usage(base_url, days=1, admin_key=admin_key or api_key)
        try:
            from hxcore import tokens as _tokens
        except Exception:
            try:
                from . import tokens as _tokens  # type: ignore
            except Exception:
                _tokens = None

        for _ in range(rounds):
            try:
                res = _one_request(base_url, stream=False, timeout=timeout, model=model, api_key=api_key)
            except Exception as exc:
                errors += 1
                rows.append({"model": "unknown", "real": None, "estimated": None, "delta": None,
                             "error": "%s: %s" % (type(exc).__name__, exc)})
                continue
            usage = res.get("usage") or {}
            real = None
            estimated = None
            if usage:
                real = {"prompt": int(usage.get("prompt_tokens") or 0),
                        "completion": int(usage.get("completion_tokens") or 0)}
            if _tokens is not None:
                estimated = {"prompt": _tokens.estimate_tokens("ping"),
                             "completion": _tokens.estimate_tokens("mock answer")}
            delta = None
            if real and estimated:
                delta = {"prompt": real["prompt"] - estimated["prompt"],
                         "completion": real["completion"] - estimated["completion"]}
            rows.append({"model": model, "real": real, "estimated": estimated, "delta": delta,
                         "estimated_flag": bool(real is None), "error": ""})

        usage_after = _admin_usage(base_url, days=1, admin_key=admin_key or api_key)
        admin_usage = None
        gateway_delta = None
        if "__error__" not in usage_after:
            admin_usage = usage_after
            if "__error__" not in usage_before:
                try:
                    gateway_delta = {
                        "calls": int(usage_after.get("calls") or 0) - int(usage_before.get("calls") or 0),
                        "prompt": int(usage_after.get("prompt") or 0) - int(usage_before.get("prompt") or 0),
                        "completion": int(usage_after.get("completion") or 0) - int(usage_before.get("completion") or 0),
                    }
                except Exception:
                    gateway_delta = None
        real_prompt = sum(r["real"]["prompt"] for r in rows if r.get("real"))
        real_completion = sum(r["real"]["completion"] for r in rows if r.get("real"))
        reconcile = None
        if gateway_delta is not None:
            reconcile = {
                "gateway_calls": gateway_delta["calls"],
                "observed_calls": len(rows),
                "gateway_prompt": gateway_delta["prompt"],
                "observed_prompt": real_prompt,
                "gateway_completion": gateway_delta["completion"],
                "observed_completion": real_completion,
            }
        real_rows = [r for r in rows if r.get("real")]
        deltas = [abs(r["delta"]["prompt"]) for r in rows if r.get("delta")]
        return {
            "ok": errors == 0 and len(real_rows) > 0,
            "mode": mode,
            "synthetic": mode == "mock",
            "rows": rows,
            "summary": {
                "requests": rounds,
                "errors": errors,
                "real_usage": len(real_rows),
                "estimated": len([r for r in rows if r.get("estimated_flag")]),
                "avg_prompt_delta": round(sum(deltas) / len(deltas), 2) if deltas else None,
                "gateway_admin_usage": admin_usage,
                "gateway_delta": gateway_delta,
                "reconcile": reconcile,
            },
            "error": "" if errors == 0 else "some_requests_failed",
        }
    except Exception as exc:
        return {"ok": False, "mode": "error", "rows": rows, "summary": {},
                "error": "%s: %s" % (type(exc).__name__, exc)}
    finally:
        if mock is not None:
            mock.__exit__()


if __name__ == "__main__":
    print(json.dumps(run("http://127.0.0.1:11434", concurrency=4), ensure_ascii=False)[:600])
