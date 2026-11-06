# -*- coding: utf-8 -*-
"""Local-only unified provider and usage view. Credentials are never read."""
from __future__ import annotations

import datetime
import json
import os
import socket
import time
import ipaddress
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
import urllib.error
import urllib.request
from pathlib import Path

_DEFAULTS = [
    {"id": "deepseek", "name": "DeepSeek", "kind": "cloud", "base_url": "https://api.deepseek.com", "models": ["deepseek-chat", "deepseek-reasoner"]},
    {"id": "openai", "name": "OpenAI", "kind": "cloud", "base_url": "https://api.openai.com/v1", "models": ["gpt-4o", "gpt-4o-mini"]},
    {"id": "gemini", "name": "Gemini", "kind": "cloud", "base_url": "https://generativelanguage.googleapis.com", "models": ["gemini-2.0-flash"]},
    {"id": "ollama", "name": "Ollama", "kind": "local", "base_url": "http://127.0.0.1:11434", "models": []},
]
_MODEL_PROVIDER = {"deepseek-chat": "deepseek", "deepseek-reasoner": "deepseek", "gpt-4o": "openai", "gpt-4o-mini": "openai", "gemini-2.0-flash": "gemini", "qwen3:8b": "ollama"}


def _root() -> str:
    try:
        from hxcore.paths import root_dir
        return str(root_dir())
    except Exception:
        return str(Path(__file__).resolve().parents[2])


def _config_path() -> str:
    return os.path.join(_root(), "config", "cloudhub.json")


def _config() -> dict:
    try:
        with open(_config_path(), "r", encoding="utf-8") as fh:
            value = json.load(fh)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def providers() -> list[dict]:
    try:
        cfg = _config()
        configured_rows = cfg.get("providers", [])
        if isinstance(configured_rows, dict):
            configured_rows = [dict(v, id=k) for k, v in configured_rows.items() if isinstance(v, dict)]
        overrides = {str(p.get("id")): p for p in configured_rows if isinstance(p, dict) and p.get("id")}
        result = []
        for base in _DEFAULTS:
            row = dict(base)
            override = overrides.pop(base["id"], None)
            source = "builtin"
            if override is not None:
                source = "config"
                row.update({k: override[k] for k in ("name", "kind", "base_url", "models") if k in override})
                env_name = str(override.get("api_key_env") or "")
                configured = bool(env_name and env_name in os.environ) or row["kind"] == "local"
            else:
                configured = row["kind"] == "local"
            row["models"] = [str(m) for m in row.get("models", []) if isinstance(m, (str, int, float))]
            row.update({"configured": bool(configured), "source": source})
            result.append(row)
        for pid, override in overrides.items():
            row = {"id": pid, "name": str(override.get("name") or pid), "kind": "local" if override.get("kind") == "local" else "cloud", "base_url": str(override.get("base_url") or ""), "models": [str(m) for m in override.get("models", []) if isinstance(m, (str, int, float))], "configured": bool((override.get("api_key_env") and str(override.get("api_key_env")) in os.environ) or override.get("kind") == "local"), "source": "config"}
            result.append(row)
        return result
    except Exception:
        return []


def usage_summary(days: int = 7) -> dict:
    try:
        days = max(0, int(days))
    except Exception:
        days = 7
    zero = {"calls": 0, "usd": 0.0, "cny": 0.0}
    try:
        from hxcore import tokens
        summary = tokens.summary(days)
        by_model = summary.get("by_model", {}) if isinstance(summary, dict) else {}
        cfg = _config()
        mapping = dict(_MODEL_PROVIDER)
        custom = cfg.get("model_providers", {})
        if isinstance(custom, dict):
            mapping.update({str(k): str(v) for k, v in custom.items()})
        grouped = {}
        for model, values in by_model.items():
            provider = mapping.get(str(model), "other")
            row = grouped.setdefault(provider, {"provider": provider, "calls": 0, "prompt": 0, "completion": 0, "usd": 0.0, "cny": 0.0})
            row["calls"] += int(values.get("calls", 0))
            row["prompt"] += int(values.get("prompt", 0))
            row["completion"] += int(values.get("completion", 0))
            row["usd"] += float(values.get("usd", 0.0))
            row["cny"] += float(values.get("usd", 0.0)) * 7.2
        rows = sorted(grouped.values(), key=lambda r: r["provider"])
        for row in rows:
            row["usd"] = round(row["usd"], 10)
            row["cny"] = round(row["cny"], 10)
        total = {"calls": sum(r["calls"] for r in rows), "usd": round(sum(r["usd"] for r in rows), 10), "cny": round(sum(r["cny"] for r in rows), 10)}
        return {"ok": True, "rows": rows, "total": total, "days": days}
    except Exception:
        return {"ok": False, "rows": [], "total": zero, "days": days}


def health(provider_id: str | None = None, timeout: float = 3, allow_network: bool = False) -> dict:
    try:
        chosen = [p for p in providers() if provider_id is None or p["id"] == str(provider_id)]
        if not allow_network:
            return {"ok": True, "results": [{"id": p["id"], "reachable": None, "latency_ms": 0.0, "error": "network_disabled"} for p in chosen], "network": False}
        results = []
        for p in chosen:
            if p["kind"] != "local":
                results.append({"id": p["id"], "reachable": None, "latency_ms": 0.0, "error": "probe_not_implemented"})
                continue
            try:
                from urllib.parse import urlparse
                parsed = urlparse(p["base_url"])
                start = time.monotonic()
                with socket.create_connection((parsed.hostname, parsed.port or 80), timeout=max(0.1, float(timeout))):
                    pass
                results.append({"id": p["id"], "reachable": True, "latency_ms": round((time.monotonic() - start) * 1000, 2), "error": ""})
            except Exception as exc:
                results.append({"id": p["id"], "reachable": False, "latency_ms": 0.0, "error": str(exc)[:200]})
        return {"ok": True, "results": results, "network": True}
    except Exception:
        return {"ok": False, "results": [], "network": bool(allow_network)}


def export_summary(path: str | None = None) -> dict:
    target_hint = str(path or "")
    try:
        from hxcore.paths import logs_dir, root_dir
        base = os.path.realpath(os.fspath(root_dir()))
        if not path:
            date = datetime.date.today().strftime("%Y%m%d")
            target = os.path.realpath(os.path.join(logs_dir(), "cloudhub", "summary-" + date + ".json"))
        else:
            candidate = os.fspath(path)
            if "\x00" in candidate or len(candidate) > 260:
                return {"ok": False, "error": "out_of_scope", "path": target_hint}
            target = os.path.realpath(candidate)
        try:
            inside = os.path.commonpath([base, target]) == base
        except Exception:
            inside = False
        if not inside:
            return {"ok": False, "error": "out_of_scope", "path": target}
        os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
        payload = {"providers": providers(), "usage": usage_summary(), "health": health()}
        temp = target + ".tmp"
        with open(temp, "w", encoding="utf-8", newline="") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(temp, target)
        return {"ok": True, "path": target}
    except Exception:
        return {"ok": False, "error": "write_failed", "path": target_hint}

# not implemented yet: account sign-in, credential editing, and secret lifecycle require a human-designed secure flow.

def probe(provider_id=None, timeout=8, allow_network=False):
    """Probe provider roots without credentials or retaining response bodies."""
    checked = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        rows = [p for p in providers() if provider_id is None or p.get("id") == str(provider_id)]
        if not allow_network:
            return {"ok": False, "error": "network_disabled"}
        def run_one(p):
            item = {"id": str(p.get("id") or ""), "name": str(p.get("name") or p.get("id") or ""), "latency_ms": 0.0, "status": "error", "error": ""}
            base = str(p.get("base_url") or "").rstrip("/")
            if not base:
                item["error"] = "missing_base_url"; return item
            try:
                u = urlparse(base); host = u.hostname
                if not host: raise ValueError("missing_host")
                import socket
                infos = socket.getaddrinfo(host, u.port or (443 if u.scheme == "https" else 80), type=socket.SOCK_STREAM)
                if not infos or any(not ipaddress.ip_address(i[4][0]).is_global for i in infos):
                    item["status"] = "blocked_address"; item["error"] = "blocked_address"; return item
            except Exception as exc:
                item["error"] = str(exc)[:200]; item["status"] = "blocked_address" if "blocked" in item["error"] else "error"; return item
            started = time.monotonic()
            try:
                req = urllib.request.Request(base + "/", method="HEAD")
                with urllib.request.urlopen(req, timeout=max(0.1, float(timeout))) as response: status = int(getattr(response, "status", response.getcode()))
                item["latency_ms"] = round((time.monotonic() - started) * 1000.0, 2); item["status"] = "ok" if 200 <= status < 500 else "error"; item["error"] = "" if item["status"] == "ok" else "http_%d" % status
            except urllib.error.HTTPError as exc:
                item["latency_ms"] = round((time.monotonic() - started) * 1000.0, 2); item["status"] = "ok" if 400 <= int(exc.code) < 500 else "error"; item["error"] = "http_%d" % int(exc.code)
            except Exception as exc: item["latency_ms"] = round((time.monotonic() - started) * 1000.0, 2); item["error"] = str(exc)[:200]
            return item
        with ThreadPoolExecutor(max_workers=min(4, max(1, len(rows)))) as pool: result = list(pool.map(run_one, rows))
        return {"ok": bool(result) and all(x["status"] == "ok" for x in result), "providers": result, "checked_at": checked}
    except Exception as exc:
        return {"ok": False, "providers": [], "checked_at": checked, "error": str(exc)[:200]}


def _usage_row(value):
    value = value if isinstance(value, dict) else {}
    return {"calls": int(value.get("calls", 0) or 0), "prompt": int(value.get("prompt", value.get("prompt_tokens", 0)) or 0),
            "completion": int(value.get("completion", value.get("completion_tokens", 0)) or 0)}


def reconcile(days=7):
    try:
        days = max(0, int(days))
    except Exception:
        days = 7
    gateway = None
    gateway_error = "gateway_source_unavailable"
    try:
        from hxcore import gwbench
        source = getattr(gwbench, "usage_reconcile", None)
        if callable(source):
            try:
                raw = source(days=days)
            except TypeError:
                raw = source()
            if isinstance(raw, dict) and raw.get("ok", True) and "__error__" not in raw:
                candidate = raw.get("gateway") or raw.get("summary") or raw
                if isinstance(candidate, dict):
                    gateway = _usage_row(candidate.get("gateway") if isinstance(candidate.get("gateway"), dict) else candidate)
    except Exception as exc:
        gateway_error = str(exc)[:200] or gateway_error
    tokens = None
    tokens_error = "tokens_source_unavailable"
    try:
        from hxcore import tokens
        raw = tokens.summary(days)
        if isinstance(raw, dict):
            token_data = raw
            tokens = _usage_row(token_data)
            by_model = token_data.get("by_model")
            if isinstance(by_model, dict):
                model_rows = []
                for model, value in by_model.items():
                    row = _usage_row(value); row["model"] = str(model); model_rows.append(row)
                by_model = model_rows
            elif not isinstance(by_model, list):
                by_model = []
            tokens_error = ""
        else:
            tokens = None
    except Exception as exc:
        tokens_error = str(exc)[:200] or tokens_error
    if gateway is None or tokens is None:
        missing = []
        if gateway is None: missing.append("gateway_source_unavailable")
        if tokens is None: missing.append("tokens_source_unavailable")
        return {"ok": False, "error": "; ".join(missing), "gateway": gateway, "tokens": tokens, "delta": None, "by_model": []}
    delta = {k: gateway[k] - tokens[k] for k in ("calls", "prompt", "completion")}
    return {"ok": True, "gateway": gateway, "tokens": tokens, "delta": delta, "by_model": by_model}