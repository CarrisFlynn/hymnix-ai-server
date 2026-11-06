# -*- coding: utf-8 -*-
"""
Hymnix Gateway - 本地大模型远程接入网关
- 鉴权代理：把 Ollama(127.0.0.1:11434) 以带密钥的形式开放给客户端
- 对话留痕：完整记录每一次 chat 请求的输入消息与回复
- 连接监控：记录客户端来源 IP、活跃时间、请求量，提供 /admin 网页与 API
仅使用 Python 标准库，无第三方依赖。
"""
import base64
import hashlib
import hmac
import http.client
import json
import secrets
import os
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_BUNDLE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
_EXE_DIR = (os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, "frozen", False)
            else os.path.dirname(os.path.abspath(__file__)))
BASE_DIR = os.environ.get("HYMNIX_DATA_DIR") or os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Hymnix")
if not os.path.isdir(BASE_DIR):
    os.makedirs(BASE_DIR, exist_ok=True)
CONFIG_PATH = os.path.join(BASE_DIR, "gateway_config.json")
LOG_DIR = os.path.join(BASE_DIR, "logs")
VERSION = "1.2.0"

DEFAULT_CONFIG = {
    "listen_host": "0.0.0.0",
    "listen_port": 11435,
    "upstream_host": "127.0.0.1",
    "upstream_port": 11434,
    "api_key": "",
    "admin_key": "",
    "max_body_mb": 32,
    "online_timeout_s": 120,
    "keep_log_days": 30,
    "model_aliases": {},
    "default_model": "",
    "inject_time": True,
    "compat_mode": "auto",
    "prompt_char_limit": 26000,
    "idle_unload_seconds": 60,
    "idle_check_seconds": 15,
    "enable_note_injection": False,
    "power_price": 0.6,
    "base_power_w": 40,
    "timezone": "Asia/Shanghai",
    "note": "客户端用 api_key 连接；你（管理员）用 admin_key 看监控"
}

os.makedirs(LOG_DIR, exist_ok=True)


LAST_ACTIVITY = [time.time()]
CLIENT_LOCKS = {}
CLIENT_LOCK_LAST_USED = {}
CLIENT_LOCK_LIMIT = 512
_CLIENT_LOCK_FALLBACK = threading.Lock()
# Streaming safeguards: keep the client connection alive without hanging forever.
SSE_FIRST_BYTE_TIMEOUT = 30.0
SSE_HEARTBEAT_INTERVAL = 15.0
UPSTREAM_RETRIES = 2


def _trim_messages(msgs, limit_chars):
    if not isinstance(msgs, list) or len(msgs) <= 2:
        return msgs
    system_msgs = [m for m in msgs if m.get("role") == "system"]
    rest = [m for m in msgs if m.get("role") != "system"]
    sys_chars = sum(len(str(m.get("content") or "")) for m in system_msgs)
    budget = max(4000, limit_chars - sys_chars)
    total = sum(len(str(m.get("content") or "")) for m in rest)
    if total <= budget:
        return msgs
    kept, used = [], 0
    for m in reversed(rest):
        ln = len(str(m.get("content") or ""))
        if kept and used + ln > budget:
            break
        kept.append(m)
        used += ln
    kept.reverse()
    note = {"role": "system", "content": "【注意】为保证上下文长度，更早的部分对话已被截断。"}
    return system_msgs + [note] + kept


def _tools_to_text(tools):
    lines = []
    for t in tools or []:
        fn = (t.get("function") or {}) if isinstance(t, dict) else {}
        name = fn.get("name") or ""
        desc = (fn.get("description") or "").strip()
        params = fn.get("parameters") or {}
        keys = ", ".join((params.get("properties") or {}).keys()) if isinstance(params, dict) else ""
        lines.append("- %s%s%s" % (name, ("：" + desc[:120]) if desc else "", ("（参数：%s）" % keys) if keys else ""))
    return "\n".join(lines)


# 运行时设置（由服务端 UI 的「终端」页实时同步）
RUNTIME = {"share_model": "", "billing_enabled": True, "daily_quota_tokens": 0}
_IP_USAGE = {}


def _today_str():
    return time.strftime("%Y-%m-%d")


def _quota_used(ip):
    with LOCK:
        rec = _IP_USAGE.get(ip) or {}
        if rec.get("day") != _today_str():
            return 0
        return int(rec.get("tokens") or 0)


def _quota_add(ip, tokens):
    try:
        with LOCK:
            day = _today_str()
            rec = _IP_USAGE.get(ip)
            if not rec or rec.get("day") != day:
                rec = {"day": day, "tokens": 0}
            rec["tokens"] = int(rec.get("tokens") or 0) + max(0, int(tokens or 0))
            _IP_USAGE[ip] = rec
    except Exception:
        pass


def _quota_block(ip):
    q = int(RUNTIME.get("daily_quota_tokens") or 0)
    return q > 0 and _quota_used(ip) >= q


def _resolve_model(payload):
    """返回 (requested, real_model)。不做任何"强制到某个模型"的行为。"""
    requested = str((payload or {}).get("model") or "").strip()
    if not requested:
        requested = str(RUNTIME.get("share_model") or "").strip()
    if not requested:
        requested = str(CFG.get("default_model") or "").strip()
    aliases = CFG.get("model_aliases") or {}
    real = aliases.get(requested, requested)
    return requested, str(real or "").strip()


def _client_profile(ua, payload, path):
    u = (ua or "").lower()
    has_tools = bool((payload or {}).get("tools"))
    if has_tools and any(k in u for k in ("urllib", "python-requests", "okhttp", "go-http", "curl")):
        return "agent_tools"      # LifeKeeper / 自建 Agent 一类
    if "chrome" in u or "mozilla" in u:
        return "browser"
    return "generic"


def _profile_keep_alive(profile):
    if profile == "agent_tools":
        return "%ds" % int(CFG.get("keep_alive_agent", 300) or 300)
    return "%ds" % int(CFG.get("idle_unload_seconds", 60) or 60)


def _pick_compat_mode(payload, ua, path):
    mode = str(CFG.get("compat_mode", "auto") or "auto").lower()
    if mode != "auto":
        return mode
    # auto：一律标准 OpenAI tool_calls（agent 类客户端两种都吃，标准更稳）
    return "openai"


def _tools_budget(payload):
    try:
        tools = payload.get("tools") or []
        chars = len(json.dumps(tools, ensure_ascii=False))
        return len(tools), chars
    except Exception:
        return 0, 0


def _apply_compat(payload, ua, path):
    if not isinstance(payload, dict):
        return payload, "skip"
    mode = _pick_compat_mode(payload, ua, path)
    tools = payload.get("tools") or []
    if mode in ("text_tools", "plain"):
        if tools and mode == "text_tools":
            instr = ("\n\n【工具调用·文本兼容模式】本轮不要使用结构化 tool_calls。"
                     "如果需要调用工具，只输出一行 JSON："
                     '{"name":"工具名","arguments":{...}}。可用工具：\n' + _tools_to_text(tools))
            msgs = list(payload.get("messages") or [])
            msgs.append({"role": "system", "content": instr})
            payload["messages"] = msgs
        payload.pop("tools", None)
    if mode == "json_only":
        payload["stream"] = False
    lim = int(CFG.get("prompt_char_limit", 0) or 0)
    if lim > 0 and isinstance(payload.get("messages"), list):
        payload["messages"] = _trim_messages(payload["messages"], lim)
    n_tools, tool_chars = _tools_budget(payload)
    warn_at = int(CFG.get("tools_warn_chars", 40000) or 40000)
    if tool_chars > warn_at:
        log_event("tools_budget", count=n_tools, chars=tool_chars)
    log_event("compat", mode=mode, tools=n_tools, tool_chars=tool_chars)
    return payload, mode


def _client_lock(ip):
    with LOCK:
        lk = CLIENT_LOCKS.get(ip)
        if lk is None:
            # Evict only idle locks; never remove a lock another request may hold.
            if len(CLIENT_LOCKS) >= CLIENT_LOCK_LIMIT:
                candidates = [(ts, key) for key, ts in CLIENT_LOCK_LAST_USED.items()
                              if not CLIENT_LOCKS[key].locked() and key != ip]
                if candidates:
                    _, old_key = min(candidates)
                    CLIENT_LOCKS.pop(old_key, None)
                    CLIENT_LOCK_LAST_USED.pop(old_key, None)
                else:
                    CLIENT_LOCK_LAST_USED[ip] = time.monotonic()
                    return _CLIENT_LOCK_FALLBACK
            lk = threading.Lock()
            CLIENT_LOCKS[ip] = lk
        CLIENT_LOCK_LAST_USED[ip] = time.monotonic()
        return lk


def _idle_unloader():
    import urllib.request as _u
    while True:
        try:
            time.sleep(max(5, int(CFG.get("idle_check_seconds", 15) or 15)))
            idle = float(CFG.get("idle_unload_seconds", 60) or 0)
            if idle <= 0:
                continue
            if time.time() - LAST_ACTIVITY[0] < idle:
                continue
            try:
                with _u.urlopen("http://%s:%d/api/ps" % (UP_HOST, UP_PORT), timeout=5) as r:
                    data = json.loads(r.read().decode("utf-8", "ignore"))
            except Exception:
                continue
            for m in data.get("models") or []:
                name = m.get("name") or m.get("model")
                if not name:
                    continue
                try:
                    body = json.dumps({"model": name, "keep_alive": 0, "prompt": ""}).encode("utf-8")
                    req = _u.Request("http://%s:%d/api/generate" % (UP_HOST, UP_PORT), data=body,
                                     headers={"Content-Type": "application/json"})
                    _u.urlopen(req, timeout=15).read()
                    log_event("model_unloaded", model=name)
                except Exception:
                    pass
        except Exception:
            pass


def _take_notes(ip):
    """取走发给这个 IP 的服务器留言（以及广播留言）"""
    msgs = []
    try:
        with LOCK:
            msgs = list(INBOX.pop(ip, []))
            allq = INBOX.get("all", [])
            if allq:
                msgs += list(allq)
                INBOX["all"] = []
    except Exception:
        pass
    return msgs


def _gpu_snapshot():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,power.draw",
                              "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=3,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        line = (out.stdout or "").strip().splitlines()[0]
        parts = [x.strip() for x in line.split(",")]
        return {"util": float(parts[0]), "mem_mb": float(parts[1]), "power_w": float(parts[2])}
    except Exception:
        return None


def _gpu_metrics(s0, s1, seconds):
    if not s0 and not s1:
        return None
    a = s0 or s1
    b = s1 or s0
    try:
        util = (a["util"] + b["util"]) / 2.0
        mem = max(a["mem_mb"], b["mem_mb"])
        power = (a["power_w"] + b["power_w"]) / 2.0 + float(CFG.get("base_power_w", 40))
        sec = max(float(seconds or 0), 0.001)
        wh = power * sec / 3600.0
        price = float(CFG.get("power_price", 0.6))
        return {"gpu_util": round(util, 1), "vram_mb": int(mem), "power_w": round(power, 1),
                "energy_wh": round(wh, 5), "cost_yuan": round(wh / 1000.0 * price, 7),
                "gpu_seconds": round(sec, 2), "tok_per_s": round((s0 and 0) or 0, 1)}
    except Exception:
        return None


def _time_note():
    now = datetime.now()
    week = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][now.weekday()]
    return "\n\n【当前时间】%s %s（北京时间）" % (now.strftime("%Y-%m-%d %H:%M"), week)


def _inject_time(messages):
    try:
        if not isinstance(messages, list) or not messages:
            return messages
        msgs = [dict(m) for m in messages]
        for m in msgs:
            if m.get("role") == "system":
                m["content"] = str(m.get("content") or "") + _time_note()
                return msgs
        msgs.insert(0, {"role": "system", "content": "你是 AI 助手。" + _time_note()})
        return msgs
    except Exception:
        return messages


def _ensure_keys(cfg):
    """首次运行生成随机密钥并写回配置文件"""
    changed = False
    if not str(cfg.get("api_key") or "").strip():
        cfg["api_key"] = "Hymnix" + secrets.token_urlsafe(24)
        changed = True
    if not str(cfg.get("admin_key") or "").strip():
        cfg["admin_key"] = "HymnixAdmin-" + secrets.token_hex(6)
        changed = True
    if changed:
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
    return cfg


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception as e:
            print("配置读取失败，使用默认配置:", e)
    return _ensure_keys(cfg)


CFG = load_config()
API_KEY = str(CFG["api_key"])
ADMIN_KEY = str(CFG["admin_key"])
UP_HOST = CFG["upstream_host"]
UP_PORT = int(CFG["upstream_port"])
MAX_BODY = int(CFG["max_body_mb"]) * 1024 * 1024
ONLINE_TIMEOUT = int(CFG["online_timeout_s"])

START_TS = time.time()
LOCK = threading.RLock()
CLIENTS = {}                                  # ip -> session dict
RECENT = deque(maxlen=500)                    # 最近对话（内存）
ERROR_RECENT = deque(maxlen=200)             # 最近上游错误（环形缓冲）
STATS = {"requests": 0, "conversations": 0, "errors": 0, "auth_fail": 0,
         "started_at": datetime.now().isoformat(timespec="seconds")}

INBOX = {}          # 目标IP/全部 -> [消息]
BANS = {}          # ip -> (ban_until_ts, reason)
FAILS = {}         # ip -> [ts, ...]
BAN_THRESHOLD = 8   # 10 分钟内失败 8 次
BAN_WINDOW = 600
BAN_SECONDS = 1800
TUNNEL_FILE = os.path.join(BASE_DIR, "tunnel_url.txt")


def read_tunnel_url():
    try:
        with open(TUNNEL_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def banned(ip):
    with LOCK:
        rec = BANS.get(ip)
        if not rec:
            return None
        if time.time() < rec[0]:
            return rec
        BANS.pop(ip, None)
        return None


def note_auth_failure(ip):
    with LOCK:
        now = time.time()
        arr = [t for t in FAILS.get(ip, []) if now - t < BAN_WINDOW]
        arr.append(now)
        FAILS[ip] = arr
        if len(arr) >= BAN_THRESHOLD:
            BANS[ip] = (now + BAN_SECONDS, "auth failures")
            log_event("ip_banned", ip=ip, seconds=BAN_SECONDS)


def _now_iso():
    return datetime.now().isoformat(timespec="seconds")


def _today():
    return datetime.now().strftime("%Y%m%d")




# ==================== 用量统计 ====================
_USAGE_STORE = None


def _usage_store():
    global _USAGE_STORE
    if _USAGE_STORE is None:
        try:
            import usage as _usage_mod
            _USAGE_STORE = _usage_mod.UsageStore()
        except Exception:
            _USAGE_STORE = False
    return _USAGE_STORE if _USAGE_STORE is not False else None


def _estimate_missing_usage(rec):
    """Fill absent upstream usage without affecting the proxy response path."""
    try:
        prompt = rec.get("prompt_tokens")
        completion = rec.get("reply_tokens")
        if prompt and completion:
            return
        from hxcore import tokens
        if not prompt:
            messages = rec.get("messages") or []
            prompt = int(tokens.count_messages(messages))
        if not completion:
            reply = str(rec.get("reply") or "")
            thinking = str(rec.get("thinking") or "")
            completion = int(tokens.estimate_tokens(reply + thinking))
        rec["prompt_tokens"] = max(1, int(prompt or 0))
        rec["reply_tokens"] = max(1, int(completion or 0))
        rec["estimated"] = True
    except Exception:
        pass


def _record_token_usage(rec):
    try:
        from hxcore import tokens
        tokens.record(rec.get("model") or "", int(rec.get("prompt_tokens") or 0),
                     int(rec.get("reply_tokens") or 0), source="gateway")
    except Exception:
        pass

def append_log(filename, record):
    try:
        path = os.path.join(LOG_DIR, filename)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        traceback.print_exc()
    try:
        from hxcore import logindex
        logindex.record("gateway", str(filename), record)
    except Exception:
        pass


def log_event(kind, **kw):
    kw.update({"t": _now_iso(), "kind": kind})
    append_log("events-%s.jsonl" % _today(), kw)


def _normalize_upstream_error(exc=None, status=None, raw="", upstream_url=""):
    """Return stable OpenAI-compatible error and retain a bounded diagnostic."""
    text = str(raw or exc or "upstream error")
    low = text.lower()
    if status in (401, 403):
        code, out_status = "upstream_auth", 502
    elif status == 404:
        code, out_status = "upstream_not_found", 404
    elif status == 429:
        code, out_status = "upstream_rate_limit", 429
    elif status is not None and int(status) >= 500:
        code, out_status = "upstream_bad_gateway", 502
    elif isinstance(exc, (socket.timeout, TimeoutError)) or "timed out" in low or "timeout" in low:
        code, out_status = "upstream_timeout", 504
    elif isinstance(exc, (ConnectionRefusedError, ConnectionResetError, socket.gaierror)) or any(x in low for x in ("refused", "name or service", "nodename", "getaddrinfo")):
        code, out_status = "upstream_unreachable", 502
    else:
        code, out_status = "upstream_bad_gateway", 502
    item = {"ts": _now_iso(), "code": code, "status": out_status,
            "upstream_url": str(upstream_url or ""), "message": text[:300]}
    with LOCK:
        ERROR_RECENT.append(item)
        STATS["last_error"] = text[:300]
        STATS["errors"] = STATS.get("errors", 0) + 1
    log_event("upstream_error_normalized", **item)
    return out_status, {"error": {"code": code, "message": text[:300], "type": "upstream_error"}}


def _error_response(exc=None, status=None, raw="", upstream_url=""):
    out_status, body = _normalize_upstream_error(exc, status, raw, upstream_url)
    return out_status, body


def log_conversation(rec):
    append_log("conversations-%s.jsonl" % _today(), rec)


def active_clients():
    """当前正在处理的连接数（持有 CLIENT_LOCKS 的 IP 个数），用于断连回归判断。"""
    with LOCK:
        return sum(1 for lk in CLIENT_LOCKS.values() if lk.locked())


def touch_client(ip, ua, model=None, ok=True):
    with LOCK:
        now = time.time()
        c = CLIENTS.get(ip)
        if c is None:
            c = {"ip": ip, "first_seen": now, "requests": 0, "conversations": 0,
                 "ua": ua, "online": True}
            CLIENTS[ip] = c
            log_event("client_connect", ip=ip, ua=ua)
        c["last_seen"] = now
        c["requests"] += 1
        c["ua"] = ua or c.get("ua", "")
        if model:
            c["last_model"] = model
        return c


def clients_snapshot():
    with LOCK:
        now = time.time()
        out = []
        for c in CLIENTS.values():
            out.append({
                "ip": c["ip"],
                "ua": (c.get("ua") or "")[:120],
                "first_seen": datetime.fromtimestamp(c["first_seen"]).strftime("%m-%d %H:%M:%S"),
                "last_seen": datetime.fromtimestamp(c["last_seen"]).strftime("%m-%d %H:%M:%S"),
                "online": (now - c["last_seen"]) <= ONLINE_TIMEOUT,
                "requests": c["requests"],
                "conversations": c.get("conversations", 0),
                "last_model": c.get("last_model", ""),
                "last_prompt": c.get("last_prompt", ""),
                "last_reply": c.get("last_reply", ""),
            })
        out.sort(key=lambda x: x["last_seen"], reverse=True)
        return out


def _open_upstream(method, target, body=None, headers=None, timeout=900):
    """Open an upstream request with bounded retries before client output."""
    last = None
    for attempt in range(UPSTREAM_RETRIES + 1):
        conn = http.client.HTTPConnection(UP_HOST, UP_PORT, timeout=timeout)
        try:
            conn.request(method, target, body=body, headers=headers or {})
            return conn, conn.getresponse()
        except Exception as exc:
            last = exc
            try:
                conn.close()
            except Exception:
                pass
            if attempt < UPSTREAM_RETRIES:
                time.sleep(0.15 * (2 ** attempt))
    raise last or OSError("upstream unavailable")


def upstream_json(path, timeout=3):
    try:
        conn = http.client.HTTPConnection(UP_HOST, UP_PORT, timeout=timeout)
        conn.request("GET", path)
        resp = conn.getresponse()
        data = resp.read()
        return resp.status, json.loads(data.decode("utf-8", "ignore"))
    except Exception:
        return 0, None


def upstream_status():
    st, data = upstream_json("/api/version")
    online = st == 200
    models, loaded = [], []
    if online:
        st2, tags = upstream_json("/api/tags")
        if st2 == 200 and tags:
            models = [m.get("name") for m in tags.get("models", [])]
        st3, ps = upstream_json("/api/ps")
        if st3 == 200 and ps:
            loaded = [m.get("name") for m in ps.get("models", [])]
    return {"online": online,
            "version": (data or {}).get("version", "") if online else "",
            "models": models, "loaded": loaded}


ADMIN_HTML = os.path.join(BASE_DIR, "dashboard.html")
if not os.path.exists(ADMIN_HTML):
    ADMIN_HTML = os.path.join(_BUNDLE_DIR, "dashboard.html")


class Capture:
    """边转发边解析，把流式输出拼回完整回复"""
    def __init__(self, is_chat, stream, meta):
        self.is_chat = is_chat
        self.stream = stream
        self.meta = meta
        self.buf = b""
        self.raw = b""
        self.parts = []
        self.final = {}
        self.raw_bytes = 0
        self.error = None
        self.tools = []
        self.thinking = []

    def feed(self, chunk):
        self.raw_bytes += len(chunk)
        if not self.is_chat:
            return
        self.raw += chunk
        self.buf += chunk
        while b"\n" in self.buf:
            line, self.buf = self.buf.split(b"\n", 1)
            self._line(line)

    def _line(self, raw):
        line = raw.strip()
        if not line:
            return
        if line.startswith(b"data:"):
            line = line[5:].strip()
            if line == b"[DONE]":
                return
        try:
            obj = json.loads(line.decode("utf-8", "ignore"))
        except Exception:
            return
        if isinstance(obj, dict):
            if obj.get("error"):
                self.error = str(obj["error"])
            piece = None
            # Ollama 原生：{"message": {"content": ...}} 或 {"response": ...}
            msg = obj.get("message")
            if isinstance(msg, dict):
                piece = msg.get("content")
            if piece is None:
                piece = obj.get("response")
            # OpenAI 兼容：{"choices": [{"delta": {"content": ...}}]}
            choices = obj.get("choices")
            if isinstance(choices, list) and choices:
                ch = choices[0] or {}
                delta = ch.get("delta") or {}
                if piece is None:
                    piece = delta.get("content")
                if piece is None:
                    m2 = ch.get("message") or {}
                    piece = m2.get("content")
                if ch.get("finish_reason") is not None:
                    self.final["done_reason"] = ch.get("finish_reason")
            th = None
            if isinstance(msg, dict):
                th = msg.get("thinking")
            if th:
                self.thinking.append(th)
            if piece:
                self.parts.append(piece)
            tcs = None
            if isinstance(msg, dict):
                tcs = msg.get("tool_calls")
            if not tcs and isinstance(choices, list) and choices:
                ch0 = choices[0] or {}
                tcs = (ch0.get("delta") or {}).get("tool_calls") or (ch0.get("message") or {}).get("tool_calls")
            for tc in (tcs or []):
                fn = (tc or {}).get("function") or {}
                args = fn.get("arguments")
                if not isinstance(args, str):
                    args = json.dumps(args, ensure_ascii=False)
                self.tools.append({"name": fn.get("name", ""), "arguments": args})
            usage = obj.get("usage")
            if isinstance(usage, dict):
                self.final["prompt_eval_count"] = usage.get("prompt_tokens")
                self.final["eval_count"] = usage.get("completion_tokens")
            if obj.get("done"):
                done_info = dict(obj)
                done_info.update({k: v for k, v in self.final.items() if v is not None})
                self.final = done_info

    def finish(self):
        if not self.is_chat:
            return None
        if not self.parts and self.raw.strip():
            # 非流式：整包 JSON（Ollama 或 OpenAI 格式）
            try:
                obj = json.loads(self.raw.decode("utf-8", "ignore"))
                if isinstance(obj, dict):
                    if obj.get("error"):
                        self.error = str(obj["error"])
                    msg = obj.get("message") or {}
                    text0 = msg.get("content") if isinstance(msg, dict) else None
                    if text0 is None:
                        ch = (obj.get("choices") or [{}])[0] or {}
                        text0 = (ch.get("message") or {}).get("content")
                    if text0:
                        self.parts.append(text0)
                    usage = obj.get("usage") or {}
                    if usage:
                        self.final.setdefault("prompt_eval_count", usage.get("prompt_tokens"))
                        self.final.setdefault("eval_count", usage.get("completion_tokens"))
                    if obj.get("prompt_eval_count") is not None:
                        self.final.setdefault("prompt_eval_count", obj.get("prompt_eval_count"))
                        self.final.setdefault("eval_count", obj.get("eval_count"))
            except Exception:
                pass
        text = "".join(self.parts)
        rec = dict(self.meta)
        rec.update({
            "t": _now_iso(),
            "reply": text,
            "reply_chars": len(text),
            "prompt_tokens": self.final.get("prompt_eval_count"),
            "reply_tokens": self.final.get("eval_count"),
            "done_reason": self.final.get("done_reason"),
            "error": self.error,
            "status": self.meta.get("status", 200),
        })
        if self.tools:
            rec["tool_calls"] = self.tools
        if self.thinking:
            rec["thinking"] = "".join(self.thinking)[:20000]
        rec["elapsed_ms"] = int((time.time() - rec.pop("_t0", time.time())) * 1000)
        return rec


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "HymnixGateway/" + VERSION

    # ---------- 基础工具 ----------
    def log_message(self, fmt, *args):
        pass

    def _ip(self):
        # 经 Cloudflare 隧道时，真实来源在 CF-Connecting-IP / X-Forwarded-For 里
        if self.client_address[0] in ("127.0.0.1", "::1"):
            fwd = self.headers.get("CF-Connecting-IP", "").strip()
            if not fwd:
                xff = self.headers.get("X-Forwarded-For", "")
                fwd = xff.split(",")[0].strip() if xff else ""
            if fwd:
                return fwd
        return self.client_address[0]

    def _json(self, code, obj, extra_headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, X-API-Key, X-Admin-Key, Content-Type")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _key(self):
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return self.headers.get("X-API-Key", "").strip()

    def _admin_key(self):
        k = self.headers.get("X-Admin-Key", "").strip()
        if not k:
            q = urllib.parse.urlparse(self.path).query
            k = urllib.parse.parse_qs(q).get("key", [""])[0]
        return k

    def _read_body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0:
            return b""
        if n > MAX_BODY:
            raise ValueError("body too large")
        return self.rfile.read(n)

    # ---------- HTTP 动词 ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, X-API-Key, X-Admin-Key, Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            if path == "/admin/cleanup" and method == "POST":
                return self._admin_cleanup()
            if path == "/admin/send" and method == "POST":
                return self._inbox_send()
            if path == "/api/inbox":
                return self._inbox_fetch()
            if path == "/health":
                st = upstream_status()
                return self._json(200, {"ok": True, "gateway": VERSION,
                                        "tunnel": read_tunnel_url(),
                                        "ollama": st["online"],
                                        "models": len(st["models"]),
                                        "clients_online": sum(1 for c in clients_snapshot() if c["online"]),
                                        "uptime_s": int(time.time() - START_TS)})
            if path == "/admin" or path == "/admin/":
                return self._serve_dashboard()
            if path.startswith("/admin/"):
                return self._admin_api(path)
            return self._proxy(method, path, parsed.query)
        except BrokenPipeError:
            pass
        except Exception:
            traceback.print_exc()
            try:
                self._json(500, {"error": "gateway internal error"})
            except Exception:
                pass

    # ---------- 管理接口 ----------
    def _admin_ok(self):
        got = self._admin_key()
        if not got:
            return False
        return hmac.compare_digest(got.encode(), ADMIN_KEY.encode())

    def _serve_dashboard(self):
        if not self._admin_ok():
            html = ("<html><body style='font-family:sans-serif;background:#11151c;color:#ddd'>"
                    "<h2 style='padding:40px'>需要管理密钥</h2>"
                    "<p style='padding:0 40px'>请在地址后加 <code>?key=你的管理密钥</code> 打开本页。</p>"
                    "</body></html>")
            body = html.encode("utf-8")
            self.send_response(401)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            with open(ADMIN_HTML, "rb") as f:
                body = f.read()
        except Exception:
            body = b"<h1>dashboard.html missing</h1>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _admin_cleanup(self):
        if not self._admin_ok():
            return self._json(401, {"error": "admin key required"})
        try:
            body = self._read_body()
            f = json.loads(body.decode("utf-8", "ignore")) if body else {}
        except Exception:
            f = {}
        ip = (f.get("ip") or "").strip()
        kw = (f.get("keyword") or "").strip().lower()
        date = (f.get("date") or "").strip()
        apply = bool(f.get("apply"))
        if not ip and not kw and not date:
            return self._json(400, {"error": "至少要给一个筛选条件（ip / keyword / date）"})

        import glob as _glob
        files = sorted(_glob.glob(os.path.join(LOG_DIR, "conversations-*.jsonl")))
        if date and date != "all":
            files = [x for x in files if date in os.path.basename(x)]
        keep_all, removed = [], []
        for fpath in files:
            keep = []
            try:
                for line in open(fpath, encoding="utf-8", errors="ignore"):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        keep.append(line)
                        continue
                    hit = True
                    if ip and str(rec.get("ip", "")) != ip:
                        hit = False
                    if hit and kw:
                        blob = json.dumps({k: rec.get(k) for k in ("messages", "reply", "thinking", "tool_calls")},
                                          ensure_ascii=False).lower()
                        hit = kw in blob
                    if hit:
                        removed.append(rec)
                    else:
                        keep.append(line)
            except Exception:
                continue
            if apply and len(keep) != sum(1 for _ in open(fpath, encoding="utf-8", errors="ignore")):
                if removed:
                    with open(fpath, "w", encoding="utf-8") as fh:
                        for ln in keep:
                            fh.write(ln + "\n")
        result = {"matched": len(removed), "apply": apply}
        if apply and removed:
            arch_dir = os.path.join(LOG_DIR, "archive")
            os.makedirs(arch_dir, exist_ok=True)
            arch = os.path.join(arch_dir, "removed-%s.jsonl" % datetime.now().strftime("%Y%m%d-%H%M%S"))
            try:
                with open(arch, "w", encoding="utf-8") as fh:
                    for rec in removed:
                        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                result["archived"] = arch
            except Exception as e:
                result["archive_error"] = str(e)
            with LOCK:
                RECENT.clear()
            load_recent_history()
        return self._json(200, result)

    def _admin_api(self, path):
        if not self._admin_ok():
            with LOCK:
                STATS["auth_fail"] += 1
            log_event("admin_auth_fail", ip=self._ip(), path=path)
            return self._json(401, {"error": "admin key required"})

        if path == "/admin/usage":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                days = max(1, int(q.get("days", ["7"])[0] or 7))
            except Exception:
                days = 7
            try:
                from hxcore import tokens
                return self._json(200, tokens.summary(days=days))
            except Exception:
                return self._json(200, {"days": days, "calls": 0, "prompt": 0, "completion": 0, "total": 0, "usd": 0.0, "cny": 0.0, "by_model": {}, "by_day": {}})

        if path == "/admin/health":
            with LOCK:
                clients_count = len(CLIENTS)
                last_error = STATS.get("last_error", "")
            index_queue = 0
            try:
                from hxcore import logindex
                index_queue = int((logindex.stats() or {}).get("queue", 0) or 0)
            except Exception:
                pass
            return self._json(200, {"ok": True, "version": VERSION,
                                    "clients": clients_count,
                                    "active": active_clients(),
                                    "uptime_s": round(time.time() - START_TS, 3),
                                    "last_error": last_error,
                                    "index_queue": index_queue})

        if path == "/admin/errors":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                limit = max(1, min(200, int(q.get("limit", ["50"])[0] or 50)))
            except (TypeError, ValueError):
                limit = 50
            with LOCK:
                items = list(ERROR_RECENT)[-limit:][::-1]
            return self._json(200, items)

        if path == "/admin/status":
            st = upstream_status()
            with LOCK:
                clients = clients_snapshot()
                recent = list(RECENT)[-30:][::-1]
                stats = dict(STATS)
                stats["conversations_total"] = len(RECENT)
            return self._json(200, {
                "gateway": {"version": VERSION, "started": STATS["started_at"],
                            "uptime_s": int(time.time() - START_TS),
                            "listen": "%s:%s" % (CFG["listen_host"], CFG["listen_port"])},
                "ollama": st,
                "tunnel": read_tunnel_url(),
                "clients": clients,
                "online": sum(1 for c in clients if c["online"]),
                "stats": stats,
                "recent": [self._trim(r) for r in recent],
            })

        if path == "/admin/conversations":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            limit = min(int(q.get("limit", ["50"])[0] or 50), 200)
            since = q.get("since", [""])[0]
            with LOCK:
                items = list(RECENT)
            if since:
                try:
                    since_ts = float(since)
                    items = [r for r in items if r.get("_ts", 0) > since_ts]
                except ValueError:
                    pass
            items = items[-limit:][::-1]
            return self._json(200, {"count": len(items),
                                    "items": [self._trim(r) for r in items]})

        if path == "/admin/clients":
            return self._json(200, {"clients": clients_snapshot()})

        if path == "/admin/history":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            limit = min(int(q.get("limit", ["1000"])[0] or 1000), 5000)
            days = int(q.get("days", ["7"])[0] or 7)
            rows = []
            import glob as _glob
            files = sorted(_glob.glob(os.path.join(LOG_DIR, "conversations-*.jsonl")))[-days:]
            for f in files:
                try:
                    for line in open(f, encoding="utf-8", errors="ignore"):
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rows.append(json.loads(line))
                        except Exception:
                            continue
                except Exception:
                    continue
            rows = [r for r in rows if not r.get("_ts") or r["_ts"] >= 0]
            rows = rows[-limit:]
            return self._json(200, {"count": len(rows), "items": [self._trim(r) for r in rows]})

        return self._json(404, {"error": "unknown admin path"})

    @staticmethod
    def _trim(rec):
        r = {k: v for k, v in rec.items() if not k.startswith("_")}
        if "messages" in r and isinstance(r["messages"], list):
            r["message_count"] = len(r["messages"])
            r["messages"] = r["messages"]
        return r

    def _sse(self, obj):
        try:
            self.wfile.write(("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode("utf-8"))
            self.wfile.flush()
        except Exception:
            pass

    def _openai_tools(self, payload, ua):
        """同源串行化：同一客户端同时只处理一条，避免显存抖动"""
        ip = self._ip()
        lk = _client_lock(ip)
        if not lk.acquire(timeout=float(CFG.get("client_queue_timeout", 240) or 240)):
            return self._json(429, {"error": {
                "message": "该来源上一轮请求还在处理，请稍后重试",
                "code": "busy",
                "hint": "网关对同一来源串行处理，避免并发抢显存"}})
        try:
            return self._openai_tools_inner(payload, ua)
        finally:
            try:
                lk.release()
            except Exception:
                pass

    def _openai_tools_inner(self, payload, ua):
        """OpenAI 兼容 + tools 的补丁：内部转成 Ollama 原生 /api/chat，再把 tool_calls 转回标准格式"""
        ip = self._ip()
        if _quota_block(ip):
            return self._json(429, {"error": {
                "message": "已达到今日使用限额",
                "code": "quota_exceeded",
                "hint": "联系服务端管理员调整限额（终端页 quota 命令）"}})
        model, real_model = _resolve_model(payload)
        if not real_model:
            return self._json(400, {"error": {
                "message": "no model specified",
                "code": "model",
                "hint": "pass \"model\": <name>; list installed models with GET /api/tags"}})
        stream = bool(payload.get("stream", False))
        client = touch_client(ip, ua, model=model)
        with LOCK:
            STATS["requests"] += 1
        payload, compat_used2 = _apply_compat(payload, ua, "/v1/chat/completions")
        LAST_ACTIVITY[0] = time.time()
        msgs = list(payload.get("messages") or [])
        if CFG.get("inject_time", True):
            msgs = _inject_time(msgs)
        prof = _client_profile(ua, payload, "/v1/chat/completions")
        n_tools, tool_chars = _tools_budget(payload)
        prompt_chars = sum(len(str(m.get("content") or "")) for m in msgs)
        native = {"model": real_model, "messages": msgs,
                  "stream": stream, "keep_alive": _profile_keep_alive(prof)}
        if payload.get("tools"):
            native["tools"] = payload["tools"]
        opts = {}
        for k in ("temperature", "top_p", "top_k", "seed"):
            if payload.get(k) is not None:
                opts[k] = payload[k]
        if payload.get("max_tokens"):
            opts["num_predict"] = payload["max_tokens"]
        if opts:
            native["options"] = opts
        ctx_used = 16384
        if str(real_model).lower().startswith("qwen3"):
            native["think"] = False
            opts2 = native.setdefault("options", {})
            if isinstance(opts2, dict) and "num_ctx" not in opts2:
                need = tool_chars + prompt_chars
                if need > int(CFG.get("ctx_expand_threshold", 45000) or 45000):
                    opts2["num_ctx"] = int(CFG.get("ctx_expanded", 20480) or 20480)
                    ctx_used = opts2["num_ctx"]
                    log_event("ctx_expanded", need=need, num_ctx=ctx_used)
                else:
                    opts2["num_ctx"] = 16384
        body = json.dumps(native, ensure_ascii=False).encode("utf-8")
        t0 = time.time()
        notes2 = _take_notes(ip) if CFG.get("enable_note_injection", False) else []
        if notes2:
            txt2 = "；".join(str(m.get("text", "")) for m in notes2)
            msgs.append({"role": "system",
                         "content": "【服务器主人留言】%s\n请在本轮回复中自然地把这条留言转达给用户。" % txt2})
            log_event("note_injected", ip=ip, text=txt2[:200])
        s0 = _gpu_snapshot()
        meta = {"ip": ip, "ua": ua, "model": real_model, "model_requested": model,
                "injected_notes": [m.get("text", "") for m in notes2],
                "profile": prof, "tools_chars": tool_chars, "num_ctx": ctx_used,
                "compat": compat_used2,
                "path": "/v1/chat/completions[tools]",
                "stream": stream, "options": opts, "messages": payload.get("messages") or [],
                "tools": [((t.get("function") or {}).get("name")) for t in (payload.get("tools") or [])],
                "_t0": t0, "_ts": t0}
        try:
            conn, resp = _open_upstream("POST", "/api/chat", body=body,
                                       headers={"Content-Type": "application/json"}, timeout=900)
        except Exception as e:
            status, body_obj = _error_response(exc=e, upstream_url="/api/chat")
            return self._json(status, body_obj)

        if resp.status != 200:
            try:
                raw_error = resp.read(4096)
            finally:
                conn.close()
            status, body_obj = _error_response(status=resp.status,
                                               raw=raw_error.decode("utf-8", "ignore"),
                                               upstream_url="/api/chat")
            return self._json(status, body_obj)

        def conv_calls(tcs):
            out = []
            for i, tc in enumerate(tcs or []):
                fn = tc.get("function") or {}
                args = fn.get("arguments")
                if not isinstance(args, str):
                    args = json.dumps(args, ensure_ascii=False)
                out.append({"id": tc.get("id") or ("call_%d" % i), "type": "function",
                            "function": {"name": fn.get("name", ""), "arguments": args}})
            return out

        if not stream:
            try:
                raw = resp.read()
            finally:
                conn.close()
            try:
                d = json.loads(raw.decode("utf-8", "ignore"))
            except Exception:
                d = {}
            msg = d.get("message") or {}
            text = msg.get("content") or ""
            think_text = msg.get("thinking") or ""
            calls = conv_calls(msg.get("tool_calls"))
            resp_obj = {"id": "chatcmpl-%d" % int(time.time() * 1000),
                        "object": "chat.completion", "created": int(time.time()),
                        "model": real_model if "real_model" in dir() else model,
                        "choices": [{"index": 0,
                                     "message": {"role": "assistant", "content": text if text else ("" if not calls else None),
                                                 **({"tool_calls": calls} if calls else {})},
                                     "finish_reason": "tool_calls" if calls else "stop"}],
                        "usage": {"prompt_tokens": d.get("prompt_eval_count") or 0,
                                  "completion_tokens": d.get("eval_count") or 0}}
            resp_obj["usage"]["total_tokens"] = (resp_obj["usage"]["prompt_tokens"]
                                                 + resp_obj["usage"]["completion_tokens"])
            data = json.dumps(resp_obj, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)
            self.close_connection = True
            meta.update({"reply": text, "reply_chars": len(text),
                         "thinking": think_text[:20000],
                         "prompt_tokens": d.get("prompt_eval_count"),
                         "reply_tokens": d.get("eval_count"),
                         "tool_calls": [c["function"]["name"] for c in calls],
                         "gpu": _gpu_metrics(s0, _gpu_snapshot(), time.time() - t0),
                         "status": 200, "elapsed_ms": int((time.time() - t0) * 1000)})
            self._record_conversation(meta, client)
            return

        first_byte_deadline = time.monotonic() + SSE_FIRST_BYTE_TIMEOUT
        first_line = None
        try:
            sock = getattr(getattr(resp, "fp", None), "raw", None)
            sock = getattr(sock, "_sock", None)
            if sock is not None:
                sock.settimeout(min(1.0, SSE_FIRST_BYTE_TIMEOUT))
            while time.monotonic() < first_byte_deadline:
                try:
                    first_line = resp.readline()
                    if first_line:
                        break
                except socket.timeout:
                    continue
            if not first_line:
                raise TimeoutError("upstream first byte timeout")
        except (socket.timeout, TimeoutError) as exc:
            try:
                conn.close()
            except Exception:
                pass
            status, body_obj = _error_response(exc=exc, upstream_url="/api/chat")
            log_event("upstream_stream_timeout", ip=ip, error=str(exc))
            return self._json(status, body_obj)
        except Exception as exc:
            try:
                conn.close()
            except Exception:
                pass
            return self._json(502, {"error": {"message": "upstream stream failed: %s" % exc, "code": "upstream"}})

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        text_parts, calls, usage = [], [], {}
        think_parts = []
        sent_client_bytes = False
        last_heartbeat = time.monotonic()
        try:
            try:
                sock = getattr(getattr(resp, "fp", None), "raw", None)
                sock = getattr(sock, "_sock", None)
                if sock is not None:
                    sock.settimeout(1.0)
            except Exception:
                sock = None
            while True:
                try:
                    line = first_line
                    first_line = None
                    if line is None:
                        line = resp.readline()
                except socket.timeout:
                    now = time.monotonic()
                    if not text_parts and now >= first_byte_deadline:
                        raise TimeoutError("upstream first byte timeout")
                    if now - last_heartbeat >= SSE_HEARTBEAT_INTERVAL:
                        try:
                            self.wfile.write(b": keepalive\n\n")
                            self.wfile.flush()
                            sent_client_bytes = True
                            last_heartbeat = now
                        except (BrokenPipeError, ConnectionResetError):
                            raise
                    continue
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line.decode("utf-8", "ignore"))
                except Exception:
                    continue
                m = o.get("message") or {}
                if m.get("thinking"):
                    think_parts.append(m["thinking"])
                if m.get("content"):
                    text_parts.append(m["content"])
                    sent_client_bytes = True
                    self._sse({"id": "chatcmpl-stream", "object": "chat.completion.chunk",
                               "model": model,
                               "choices": [{"index": 0, "delta": {"content": m["content"]}}]})
                new_calls = conv_calls(m.get("tool_calls"))
                for k, c in enumerate(new_calls):
                    calls.append(c)
                    sent_client_bytes = True
                    self._sse({"id": "chatcmpl-stream", "object": "chat.completion.chunk",
                               "model": model,
                               "choices": [{"index": 0, "delta": {"tool_calls": [
                                   {"index": len(calls) - 1, "id": c["id"], "type": "function",
                                    "function": {"name": c["function"]["name"],
                                                 "arguments": c["function"]["arguments"]}}]}}]})
                if o.get("done"):
                    usage = {"prompt_tokens": o.get("prompt_eval_count") or 0,
                             "completion_tokens": o.get("eval_count") or 0}
                    usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
                    break
            self._sse({"id": "chatcmpl-stream", "object": "chat.completion.chunk", "model": model,
                       "choices": [{"index": 0, "delta": {},
                                    "finish_reason": "tool_calls" if calls else "stop"}],
                       "usage": usage})
            try:
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except Exception:
                pass
        except (BrokenPipeError, ConnectionResetError):
            log_event("client_disconnect", ip=ip, path="/v1/chat/completions")
        except Exception as exc:
            status, body_obj = _error_response(exc=exc, upstream_url="/api/chat")
            log_event("upstream_stream_error", ip=ip, error=str(exc), retryable=not sent_client_bytes)
            if sent_client_bytes:
                self._sse(body_obj)
                try:
                    self.wfile.write(b"data: [DONE]\n\n")
                    self.wfile.flush()
                except Exception:
                    pass
        finally:
            try:
                conn.close()
            except Exception:
                pass
            text = "".join(text_parts)
            meta.update({"reply": text, "reply_chars": len(text),
                         "thinking": "".join(think_parts)[:20000],
                         "prompt_tokens": usage.get("prompt_tokens"),
                         "reply_tokens": usage.get("completion_tokens"),
                         "tool_calls": [c["function"]["name"] for c in calls],
                         "status": 200, "elapsed_ms": int((time.time() - t0) * 1000)})
            self._record_conversation(meta, client)


    # ---------- 代理 ----------
    def _inbox_fetch(self):
        key = self._key()
        if not key or not hmac.compare_digest(key.encode(), API_KEY.encode()):
            return self._json(401, {"error": {"message": "api key 无效", "code": "credential",
                                             "hint": "检查 Authorization: Bearer 的密钥是否与网关一致"}})
        ip = self._ip()
        with LOCK:
            msgs = list(INBOX.get(ip, [])) + list(INBOX.get("all", []))
            INBOX[ip] = []
            INBOX["all"] = [m for m in INBOX.get("all", []) if m.get("to") != "broadcast_once"]
        return self._json(200, {"count": len(msgs), "messages": msgs})

    def _inbox_send(self):
        if not self._admin_ok():
            return self._json(401, {"error": "admin key required"})
        try:
            body = self._read_body()
            d = json.loads(body.decode("utf-8", "ignore")) if body else {}
        except Exception:
            d = {}
        text = str(d.get("text") or "").strip()
        target = str(d.get("target") or "all").strip()
        if not text:
            return self._json(400, {"error": "text required"})
        msg = {"id": int(time.time() * 1000), "text": text, "ts": _now_iso(), "target": target}
        with LOCK:
            INBOX.setdefault(target, []).append(msg)
        log_event("server_message", target=target, text=text[:200])
        return self._json(200, {"queued": 1, "target": target})

    def _proxy(self, method, path, query):
        ban = banned(self._ip())
        if ban:
            return self._json(429, {"error": "too many attempts, try again later"})
        key = self._key()
        if not key or not hmac.compare_digest(key.encode(), API_KEY.encode()):
            with LOCK:
                STATS["auth_fail"] += 1
            note_auth_failure(self._ip())
            log_event("auth_fail", ip=self._ip(), path=path,
                      key_hint=(key[:4] + "***") if key else "")
            return self._json(401, {"error": {"message": "api key 无效", "code": "credential",
                                             "hint": "检查 Authorization: Bearer 的密钥是否与网关一致"}})

        try:
            body = self._read_body()
        except ValueError:
            return self._json(413, {"error": "request body too large"})

        ip = self._ip()
        ua = self.headers.get("User-Agent", "")
        target = path + ("?" + query if query else "")
        if path in ("/api/chat", "/v1/chat/completions", "/api/generate") and _quota_block(ip):
            return self._json(429, {"error": {
                "message": "已达到今日使用限额",
                "code": "quota_exceeded",
                "hint": "联系服务端管理员调整限额（终端页 quota 命令）"}})

        is_chat = path in ("/api/chat", "/v1/chat/completions", "/api/generate")
        payload = {}
        if is_chat and body:
            try:
                payload = json.loads(body.decode("utf-8", "ignore"))
            except Exception:
                payload = {}
        if path == "/v1/chat/completions" and isinstance(payload, dict) and (
                payload.get("tools") or payload.get("model") in (CFG.get("model_aliases") or {})):
            return self._openai_tools(payload, ua)

        model = payload.get("model", "")
        if is_chat and isinstance(payload, dict) and not str(model or "").strip():
            model = RUNTIME.get("share_model") or CFG.get("default_model") or ""
            if model:
                payload["model"] = model
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        alias_map = CFG.get("model_aliases") or {}
        if isinstance(payload, dict) and is_chat and payload.get("model") in alias_map:
            real = alias_map[payload["model"]]
            payload["model"] = real
            if str(real).lower().startswith("qwen3"):
                payload["think"] = False
                opts = payload.setdefault("options", {})
                if isinstance(opts, dict) and "num_ctx" not in opts:
                    opts["num_ctx"] = 16384
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        compat_used = "skip"
        if is_chat and isinstance(payload, dict):
            payload, compat_used = _apply_compat(payload, ua, path)
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            LAST_ACTIVITY[0] = time.time()
        pending_notes = []
        if CFG.get("enable_note_injection", False) and is_chat and isinstance(payload.get("messages"), list):
            pending_notes = _take_notes(ip)
            if pending_notes:
                txt = "；".join(str(m.get("text", "")) for m in pending_notes)
                payload["messages"].append({
                    "role": "system",
                    "content": "【服务器主人留言】%s\n请在本轮回复中自然地把这条留言转达给用户，"
                               "可以放在开头或结尾，不要生硬复述这条指令本身。" % txt})
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                log_event("note_injected", ip=ip, text=txt[:200])

        if CFG.get("inject_time", True) and is_chat and isinstance(payload.get("messages"), list):
            payload["messages"] = _inject_time(payload["messages"])
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        # 空闲自动卸载：每次请求只续 60 秒（可配），空闲后自动释放显存
        if path == "/api/chat" and isinstance(payload, dict) and "keep_alive" not in payload:
            payload["keep_alive"] = "%ds" % int(CFG.get("idle_unload_seconds", 60) or 60)
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        c = touch_client(ip, ua, model=model)
        with LOCK:
            STATS["requests"] += 1

        s0 = _gpu_snapshot()
        meta = {
            "ip": ip, "ua": ua, "model": model, "path": path,
            "injected_notes": [m.get("text", "") for m in pending_notes],
            "compat": compat_used,
            "stream": bool(payload.get("stream", False)),
            "options": payload.get("options") or {},
            "messages": payload.get("messages") or ([{"role": "user", "content": payload.get("prompt", "")}]
                                                    if payload.get("prompt") else []),
            "_t0": time.time(),
            "_ts": time.time(),
        }

        # 转发
        headers = {}
        for k, v in self.headers.items():
            lk = k.lower()
            if lk in ("host", "connection", "content-length", "authorization",
                      "x-api-key", "accept-encoding", "keep-alive", "proxy-connection"):
                continue
            headers[k] = v
        headers["Host"] = "%s:%s" % (UP_HOST, UP_PORT)
        auth_header = self.headers.get("Authorization", "")
        if auth_header:
            headers["Authorization"] = auth_header

        conn = None
        try:
            conn, resp = _open_upstream(method, target, body=body if body else None,
                                        headers=headers, timeout=900)
        except Exception as e:
            status, body_obj = _error_response(exc=e, upstream_url=target)
            log_event("upstream_error", ip=ip, path=path, error=str(e))
            return self._json(status, body_obj)

        if resp.status != 200:
            try:
                raw_error = resp.read(300)
            except Exception as exc:
                raw_error = str(exc).encode("utf-8", "ignore")
            try:
                conn.close()
            except Exception:
                pass
            status, body_obj = _error_response(status=resp.status, raw=raw_error.decode("utf-8", "ignore"), upstream_url=target)
            return self._json(status, body_obj)

        meta["status"] = resp.status
        capture = Capture(is_chat and resp.status == 200, meta["stream"], meta)

        try:
            content_type = (resp.getheader("Content-Type", "") or "").lower()
            stream_requested = bool(meta.get("stream"))
            first_chunk = b""
            stream_mode = "text/event-stream" in content_type
            sent_client_bytes = False
            if stream_requested or stream_mode:
                first_chunk = resp.readline()
                stream_mode = stream_mode or first_chunk.lstrip().startswith(b"data:")
            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() in ("transfer-encoding", "connection", "content-length",
                                 "keep-alive", "content-encoding"):
                    continue
                self.send_header(k, v)
            self.send_header("Connection", "close")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.close_connection = True
            if stream_mode:
                pending = first_chunk
                last_heartbeat = time.monotonic()
                stream_terminal = False
                while True:
                    chunk = pending if pending else resp.readline()
                    pending = b""
                    if not chunk:
                        if not stream_terminal:
                            status, body_obj = _error_response(
                                exc=ConnectionResetError("upstream closed mid-stream"),
                                upstream_url=target)
                            self._sse(body_obj)
                            self.wfile.write(b"data: [DONE]\n\n")
                            self.wfile.flush()
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    sent_client_bytes = True
                    capture.feed(chunk)
                    if b"data: [DONE]" in chunk or b"finish_reason" in chunk:
                        stream_terminal = True
                    if time.monotonic() - last_heartbeat >= SSE_HEARTBEAT_INTERVAL:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                        last_heartbeat = time.monotonic()
            else:
                if first_chunk:
                    self.wfile.write(first_chunk)
                    self.wfile.flush()
                    capture.feed(first_chunk)
                while True:
                    chunk = resp.read(4096)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    capture.feed(chunk)
        except BrokenPipeError:
            log_event("client_disconnect", ip=ip, path=path)
        except Exception as exc:
            if stream_mode and sent_client_bytes:
                exc = ConnectionResetError("upstream closed mid-stream")
            status, body_obj = _error_response(exc=exc, upstream_url=target)
            log_event("upstream_stream_error", ip=ip, path=path, error=str(exc))
            if stream_mode:
                self._sse(body_obj)
                try:
                    self.wfile.write(b"data: [DONE]\n\n")
                    self.wfile.flush()
                except Exception:
                    pass
        finally:
            try:
                conn.close()
            except Exception:
                pass
            rec = capture.finish()
            if rec is not None:
                rec["gpu"] = _gpu_metrics(s0, _gpu_snapshot(), (rec.get("elapsed_ms") or 0) / 1000.0)
                self._record_conversation(rec, c)

    def _record_conversation(self, rec, client):
        # 日志瘦身：messages 每条 <=4000 字，thinking <=4000，reply <=8000
        try:
            msgs = rec.get("messages") or []
            slim = []
            for m in msgs[-80:]:
                c = str(m.get("content") or "")
                if len(c) > 4000:
                    c = c[:4000] + "…（截断）"
                slim.append({"role": m.get("role"), "content": c})
            rec["messages"] = slim
            if isinstance(rec.get("thinking"), str) and len(rec["thinking"]) > 4000:
                rec["thinking"] = rec["thinking"][:4000] + "…"
            if isinstance(rec.get("reply"), str) and len(rec["reply"]) > 8000:
                rec["reply"] = rec["reply"][:8000] + "…"
        except Exception:
            pass
        reply = rec.get("reply") or ""
        last_user = ""
        for m in reversed(rec.get("messages") or []):
            if m.get("role") == "user":
                last_user = m.get("content") or ""
                break
        rec["_ts"] = time.time()
        _estimate_missing_usage(rec)
        _record_token_usage(rec)
        try:
            st = _usage_store()
            if st is not None:
                st.record(
                    kind="chat",
                    model=rec.get("model") or "",
                    prompt_tokens=int(rec.get("prompt_tokens") or 0),
                    reply_tokens=int(rec.get("reply_tokens") or 0),
                    elapsed_ms=float(rec.get("elapsed_ms") or 0),
                    provider="local",
                )
        except Exception:
            pass
        try:
            _quota_add(rec.get("ip") or "", int(rec.get("prompt_tokens") or 0)
                       + int(rec.get("reply_tokens") or 0))
        except Exception:
            pass
        with LOCK:
            STATS["conversations"] += 1
            if client is not None:
                client["conversations"] = client.get("conversations", 0) + 1
                client["last_prompt"] = last_user[:120]
                client["last_reply"] = reply[:120]
            RECENT.append(rec)
        log_conversation(rec)


def load_recent_history():
    """启动时把今天的对话记录读回内存，重启后监控面板不至于空白"""
    path = os.path.join(LOG_DIR, "conversations-%s.jsonl" % _today())
    if not os.path.exists(path):
        return
    rows = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        return
    with LOCK:
        for rec in rows[-200:]:
            try:
                rec["_ts"] = datetime.fromisoformat(rec.get("t", "")).timestamp()
            except Exception:
                rec["_ts"] = 0
            RECENT.append(rec)
        STATS["conversations"] = len(rows)


class _FastHTTPServer(ThreadingHTTPServer):
    """ThreadingHTTPServer without the reverse-DNS lookup done by server_bind().

    socketserver calls socket.getfqdn() while binding, which blocks for 1-2s on
    Windows machines without a responsive DNS/reverse lookup. The server name is
    never used by this gateway, so binding directly removes the startup freeze.
    """

    daemon_threads = True
    allow_reuse_address = True

    def server_bind(self):
        import socketserver as _socketserver
        _socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = str(host)
        self.server_port = port


def start_server():
    try:
        threading.Thread(target=_idle_unloader, daemon=True).start()
    except Exception:
        pass
    """在当前线程中启动 HTTP 服务（供 GUI 调用）"""
    host = CFG["listen_host"]
    port = int(CFG["listen_port"])
    srv = _FastHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    log_event("gateway_start", port=port, version=VERSION)
    return srv


def main():
    load_recent_history()
    srv = start_server()
    print("Hymnix Gateway v%s listening on %s:%s" % (VERSION, CFG["listen_host"], CFG["listen_port"]))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        log_event("gateway_stop")
        srv.server_close()


if __name__ == "__main__":
    main()
