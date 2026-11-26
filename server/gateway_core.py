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
import ipaddress
import json
import secrets
import os
import posixpath
import socket
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import re
import urllib.parse
import urllib.request
from collections import deque
from datetime import datetime
import socketserver
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def _files_int(raw, minimum, maximum, name):
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)", str(raw)):
        raise ValueError("invalid_" + name)
    value = int(raw)
    if value < minimum or value > maximum:
        raise ValueError("invalid_" + name)
    return value


_TOOL_APPROVAL_LOCK = threading.RLock()
_TOOL_APPROVAL_ARGS = {}
_TOOL_APPROVAL_TTL = 60.0
_TOOL_APPROVAL_MAX = 256
_SAFE_REMOTE_TOOLS = {"time.now", "calc", "fs.list", "fs.read", "fs.stat", "sysinfo", "repo.tree", "repo.search", "repo.read"}

# Tool classes for the three-level policy. Unknown tools count as exec: the most
# restrictive class below "full".
_TOOL_READ = {"time.now", "calc", "sysinfo", "fs.list", "fs.read", "fs.stat", "repo.tree", "repo.search", "repo.read"}
_TOOL_WRITE = {"fs.write", "fs.mkdir", "fs.move", "fs.remove", "diff.apply", "diff.rollback"}


def _tool_class(name):
    if name in _TOOL_READ:
        return "read"
    if name in _TOOL_WRITE:
        return "write"
    return "exec"


def _tool_policy_allows(policy, name):
    """Return (allowed, reason) for one tool call under the current policy."""
    cls = _tool_class(name)
    if policy == "read":
        return (cls == "read", "read_only")
    if policy == "workspace":
        return (cls != "exec", "workspace_only")
    return (True, "")


class _BoundedJSONError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


def _approval_redact(value):
    try:
        from hxcore.approvals import redacted_args
        return redacted_args(value if isinstance(value, dict) else {"value": value}).get("value") if not isinstance(value, dict) else redacted_args(value)
    except Exception:
        if isinstance(value, dict):
            return {str(k): "[REDACTED]" if any(s in str(k).lower() for s in ("token", "secret", "password", "key", "auth")) else _approval_redact(v) for k, v in list(value.items())[:64]}
        if isinstance(value, list):
            return [_approval_redact(v) for v in value[:64]]
        if isinstance(value, str):
            return value[:512]
        return value


_TOOL_REQUEST_IDS = {}
_TOOL_REQUEST_MAX = 2048


_BUNDLE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
_EXE_DIR = (os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, "frozen", False)
            else os.path.dirname(os.path.abspath(__file__)))
BASE_DIR = os.environ.get("HYMNIX_DATA_DIR") or os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Hymnix")
if not os.path.isdir(BASE_DIR):
    os.makedirs(BASE_DIR, exist_ok=True)
CONFIG_PATH = os.path.join(BASE_DIR, "gateway_config.json")
LOG_DIR = os.path.join(BASE_DIR, "logs")
def _read_version():
    for base in (os.path.dirname(_BUNDLE_DIR), _EXE_DIR, _BUNDLE_DIR, os.path.dirname(_EXE_DIR)):
        try:
            with open(os.path.join(base, "VERSION"), encoding="utf-8") as handle:
                value = handle.read().strip()
            if value:
                return value
        except (OSError, UnicodeError):
            pass
    return "1.2.1"


VERSION = _read_version()

DEFAULT_CONFIG = {
    # Loopback by default; LAN sharing must be switched on explicitly.
    "listen_host": "127.0.0.1",
    "listen_port": 11435,
    "upstream_host": "127.0.0.1",
    "upstream_port": 11434,
    "api_key": "",
    "admin_key": "",
    "host_name": "Hymnix Orbit",
    "host_password": "",
    "allow_remote": True,
    "chat_source": "local",
    "cloud_enabled": False,
    "cloud_api": {"base_url": "", "api_key": "", "model": "", "kind": "openai", "agent_id": "", "max_tokens": 0},
    # Named provider profiles the desktop model picker lists. cloud_api above stays
    # the single runtime copy the chat path reads, so nothing else had to change.
    "cloud_providers": [],
    "cloud_active": "",
    # When true, tool calls skip the approval queue (still logged).
    "auto_approve_tools": False,
    # read | workspace | full — what tools may do without asking.
    "tool_policy": "workspace",
    "max_body_mb": 32,
    "online_timeout_s": 120,
    "keep_log_days": 30,
    "model_aliases": {},
    "default_model": "",
    "inject_time": False,
    "compat_mode": "auto",
    "prompt_char_limit": 26000,
    "idle_unload_seconds": 60,
    "idle_check_seconds": 15,
    "enable_note_injection": False,
    "trust_proxy_headers": False,
    "power_price": 0.6,
    "base_power_w": 40,
    "timezone": "Asia/Shanghai",
    "note": "客户端用 api_key 连接；你（管理员）用 admin_key 看监控"
}

os.makedirs(LOG_DIR, exist_ok=True)


HEALTH_CACHE = {"payload": None, "at": 0.0}
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

# Only the desktop shell and loopback pages are allowed to read cross-origin.
# Everything else gets no CORS header at all, which is what blocks a hostile web
# page from reading /admin responses through DNS rebinding.
CORS_ORIGIN_RE = re.compile(r"^(?:app://hymnix|http://(?:localhost|127\.0\.0\.1)(?::\d{1,5})?)$", re.IGNORECASE)


def _sync_runtime(cfg):
    """Mirror config-only quotas into RUNTIME.

    The Tk console used to be the only writer, so a headless gateway started by
    the desktop app never saw the configured daily quota and never enforced it.
    """
    try:
        RUNTIME["daily_quota_tokens"] = max(0, int(cfg.get("daily_quota_tokens") or 0))
    except (TypeError, ValueError):
        RUNTIME["daily_quota_tokens"] = 0
    RUNTIME["billing_enabled"] = bool(cfg.get("billing_enabled", True))
    if not str(RUNTIME.get("share_model") or "").strip():
        RUNTIME["share_model"] = str(cfg.get("default_model") or "").strip()
    return RUNTIME


def _checked_base_url(raw):
    """Validate a provider base URL before it is stored or fetched.

    Providers legitimately point at loopback (OpenClaw) or a LAN box, so private
    addresses stay allowed. What must never happen is a link-local address such as
    the 169.254.169.254 cloud metadata service, which is how an SSRF turns into a
    credential theft, plus anything that is not plain http(s).
    """
    text = str(raw or "").strip()
    if not text:
        return ""
    parsed = urllib.parse.urlsplit(text)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("invalid_base_url")
    if parsed.username or parsed.password:
        raise ValueError("invalid_base_url")
    host = parsed.hostname.strip().lower()
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        # Unresolvable: nothing to connect to, so no SSRF surface. The probe will
        # surface the DNS failure to the user.
        return text
    for info in infos:
        address = str(info[4][0]).split("%", 1)[0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            raise ValueError("invalid_base_url")
        if ip.is_link_local or ip.is_unspecified or ip.is_multicast or ip.is_reserved:
            raise ValueError("blocked_base_url")
    return text


def _write_text_atomic(path, text):
    """Replace a file through a fsynced sibling temp file.

    A plain open(path, "w") truncates before writing, so an interrupted write
    leaves the user with half a conversation log or half a source file.
    """
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, temp = tempfile.mkstemp(dir=directory, prefix=".hymnix-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


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
    if not str(cfg.get("host_password") or "").strip():
        cfg["host_password"] = secrets.token_urlsafe(9)
        changed = True
    if not str(cfg.get("admin_key") or "").strip():
        cfg["admin_key"] = "HymnixAdmin-" + secrets.token_hex(18)
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
    cfg = _ensure_keys(cfg)
    _sync_runtime(cfg)
    return cfg


CFG = load_config()
if not str(CFG.get("host_name") or "").strip():
    CFG["host_name"] = "Hymnix Orbit"
if not str(CFG.get("host_password") or "").strip():
    CFG["host_password"] = secrets.token_urlsafe(9)
if "allow_remote" not in CFG:
    CFG["allow_remote"] = True
try:
    _CFG_PATH = CONFIG_PATH
    with open(_CFG_PATH, "w", encoding="utf-8") as _handle:
        json.dump(CFG, _handle, ensure_ascii=False, indent=2)
except Exception:
    pass
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
OLLAMA_STATE = {"proc": None}
OLLAMA_START_LOCK = threading.Lock()
GATEWAY_STOPPING = threading.Event()
_BOUND_LISTEN_ADDRESS = None
OLLAMA_START_TIMEOUT = 20.0
OLLAMA_PROBE_INTERVAL = 0.25
TUNNEL_STATE = {"proc": None, "state": "off", "url": "", "started_ever": False, "stopped": False, "log": [], "watchdog": False}
TUNNEL_LOG = []


def _tunnel_note(text):
    TUNNEL_LOG.append("[%s] %s" % (time.strftime("%H:%M:%S"), text))
    if len(TUNNEL_LOG) > 60:
        del TUNNEL_LOG[: len(TUNNEL_LOG) - 60]
    TUNNEL_STATE["log"] = list(TUNNEL_LOG)


def _cloudflared_path():
    here = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
    candidates = [
        os.path.join(here, "cloudflared.exe"),
        os.path.join(BASE_DIR, "cloudflared.exe"),
        os.path.join(os.path.dirname(here), "cloudflared.exe"),
        os.path.join(os.path.dirname(BASE_DIR), "cloudflared.exe"),
    ]
    for item in candidates:
        if os.path.exists(item):
            return item
    return ""


def _tunnel_pump(proc):
    import re as _re
    pattern = _re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
    try:
        for raw in iter(proc.stdout.readline, b""):
            if not raw:
                break
            line = raw.decode("utf-8", "ignore").strip()
            if not line:
                continue
            _tunnel_note(line[:200])
            match = pattern.search(line)
            if match:
                TUNNEL_STATE["url"] = match.group(0)
                TUNNEL_STATE["state"] = "up"
                try:
                    with open(TUNNEL_FILE, "w", encoding="utf-8") as handle:
                        handle.write(TUNNEL_STATE["url"])
                except Exception:
                    pass
                _tunnel_note("ready: " + TUNNEL_STATE["url"])
    except Exception as exc:
        _tunnel_note("pump error: %s" % exc)


def _tunnel_watchdog():
    time.sleep(30)
    while True:
        try:
            if TUNNEL_STATE.get("started_ever") and not TUNNEL_STATE.get("stopped"):
                proc = TUNNEL_STATE.get("proc")
                if proc is None or proc.poll() is not None:
                    _tunnel_note("tunnel lost, reconnecting")
                    start_tunnel()
        except Exception:
            pass
        time.sleep(20)


def start_tunnel():
    # cloudflared reaches us over loopback, so without trusting its headers every
    # guest would look like 127.0.0.1. The flag is scoped to the tunnel's lifetime.
    CFG["trust_proxy_headers"] = True
    try:
        _save_cfg()
    except Exception:
        pass
    if not str(CFG.get("host_password") or "").strip():
        TUNNEL_STATE["state"] = "failed"
        _tunnel_note("refused: share password is empty")
        return tunnel_status()
    proc = TUNNEL_STATE.get("proc")
    if proc is not None and proc.poll() is None:
        return tunnel_status()
    exe = _cloudflared_path()
    if not exe:
        TUNNEL_STATE["state"] = "failed"
        _tunnel_note("cloudflared.exe not found")
        return tunnel_status()
    port = listen_address()[1]
    try:
        proc = subprocess.Popen(
            [exe, "tunnel", "--url", "http://127.0.0.1:%d" % port, "--no-autoupdate"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception as exc:
        TUNNEL_STATE["state"] = "failed"
        _tunnel_note("spawn failed: %s" % exc)
        return tunnel_status()
    TUNNEL_STATE["proc"] = proc
    TUNNEL_STATE["state"] = "starting"
    TUNNEL_STATE["url"] = ""
    TUNNEL_STATE["started_ever"] = True
    TUNNEL_STATE["stopped"] = False
    _tunnel_note("spawned cloudflared pid=%s" % proc.pid)
    threading.Thread(target=_tunnel_pump, args=(proc,), daemon=True).start()
    if not TUNNEL_STATE.get("watchdog"):
        TUNNEL_STATE["watchdog"] = True
        threading.Thread(target=_tunnel_watchdog, daemon=True).start()
    return tunnel_status()


def stop_tunnel():
    CFG["trust_proxy_headers"] = False
    try:
        _save_cfg()
    except Exception:
        pass

    proc = TUNNEL_STATE.get("proc")
    if proc is not None:
        try:
            proc.terminate()
        except Exception:
            pass
    TUNNEL_STATE["proc"] = None
    TUNNEL_STATE["state"] = "off"
    TUNNEL_STATE["url"] = ""
    TUNNEL_STATE["stopped"] = True
    try:
        if os.path.exists(TUNNEL_FILE):
            os.remove(TUNNEL_FILE)
    except Exception:
        pass
    _tunnel_note("stopped")
    return tunnel_status()


def tunnel_status():
    proc = TUNNEL_STATE.get("proc")
    alive = proc is not None and proc.poll() is None
    state = TUNNEL_STATE.get("state") or "off"
    if state == "up" and not alive:
        state = "lost"
    return {
        "ok": True,
        "state": state,
        "url": TUNNEL_STATE.get("url") or "",
        "pid": getattr(proc, "pid", None) if alive else None,
        "log": TUNNEL_STATE.get("log") or [],
    }


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


_CLOUD_KINDS = ("openai", "anthropic", "openclaw")


def _cloud_kind(value):
    """Normalise the three dialects the desktop client can speak."""
    text = str(value or "").strip().lower().replace("-", "").replace("_", "").replace(" ", "")
    if text in ("anthropic", "claude", "claudecode"):
        return "anthropic"
    if text in ("openclaw", "claw"):
        return "openclaw"
    return "openai"


def _cloud_url(base, suffix):
    """Join a base URL with an API path without duplicating a version segment."""
    root = str(base or "").strip().rstrip("/")
    if root.endswith(suffix):
        return root
    if re.search(r"/v[0-9]+[a-z]*(?:/[^/]+)*$", root):
        return root + suffix
    return root + "/v1" + suffix


def _redact_upstream_url(value):
    try:
        parts = urllib.parse.urlsplit(str(value or ""))
        host = parts.hostname or ""
        if ":" in host and not host.startswith("["):
            host = "[" + host + "]"
        if parts.port:
            host += ":%d" % parts.port
        return urllib.parse.urlunsplit((parts.scheme, host, parts.path, "", ""))
    except Exception:
        return ""


def _normalize_upstream_error(exc=None, status=None, raw="", upstream_url="", provider=None, model=""):
    """Return stable OpenAI-compatible error and retain a bounded diagnostic."""
    text = str(raw or exc or "upstream error")
    low = text.lower()
    provider = str(provider or os.environ.get("HYMNIX_UPSTREAM_PROVIDER") or "ollama").strip()[:40]
    model = str(model or "").strip()[:100]
    if not model and isinstance(raw, (str, bytes)):
        try:
            raw_text = raw.decode("utf-8", "ignore") if isinstance(raw, bytes) else raw
            parsed = json.loads(raw_text)
            if isinstance(parsed, dict):
                model = str(parsed.get("model") or "")[:100]
        except Exception:
            pass
    credential_pattern = re.compile(r"(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~-]{8,}|\b[0-9a-fA-F]{32,}\b)")
    if status in (401, 403) or credential_pattern.search(text):
        text = "上游认证失败" if status in (401, 403) else "上游响应包含敏感凭据，已隐藏"
    text = text[:300]
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
            "upstream_url": _redact_upstream_url(upstream_url), "message": text[:300]}
    with LOCK:
        ERROR_RECENT.append(item)
        STATS["last_error"] = text[:300]
        STATS["errors"] = STATS.get("errors", 0) + 1
    log_event("upstream_error_normalized", **item)
    return out_status, {"error": {"code": code, "message": text[:300], "type": "upstream_error", "provider": provider, "model": model}}


def _error_response(exc=None, status=None, raw="", upstream_url="", provider=None, model=""):
    out_status, body = _normalize_upstream_error(exc, status, raw, upstream_url, provider, model)
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
        with_response = http.client.HTTPConnection(UP_HOST, UP_PORT, timeout=timeout)
        try:
            with_response.request("GET", path)
            resp = with_response.getresponse()
            data = resp.read()
            return resp.status, json.loads(data.decode("utf-8"))
        finally:
            with_response.close()
    except (OSError, http.client.HTTPException, ValueError):
        return 0, None


def _ollama_version(timeout=1):
    status, data = upstream_json("/api/version", timeout=timeout)
    version = data.get("version") if isinstance(data, dict) else None
    return version.strip() if status == 200 and isinstance(version, str) else ""


def _ollama_models(path, timeout=3):
    status, data = upstream_json(path, timeout=timeout)
    if status != 200 or not isinstance(data, dict) or not isinstance(data.get("models"), list):
        return []
    return [m["name"] for m in data["models"] if isinstance(m, dict) and isinstance(m.get("name"), str)]


def upstream_status():
    version = _ollama_version()
    return {"online": bool(version), "version": version,
            "models": _ollama_models("/api/tags") if version else [],
            "loaded": _ollama_models("/api/ps") if version else []}


def _ollama_result(ok, online, models=0, code=None, detail=None):
    result = {"ok": ok, "online": online, "ready": online, "models": models}
    if code:
        result.update(code=code, error=code, detail=detail)
    return result


def _find_ollama():
    executable = shutil.which("ollama")
    if executable or os.name != "nt":
        return executable
    for key, subdir in (("LOCALAPPDATA", "Programs"), ("ProgramFiles", ""), ("ProgramFiles(x86)", "")):
        base = os.environ.get(key)
        if base:
            candidate = os.path.join(base, subdir, "Ollama", "ollama.exe")
            if os.path.isfile(candidate):
                return candidate
    return None


def _stop_owned_ollama():
    with OLLAMA_START_LOCK:
        proc = OLLAMA_STATE.get("proc")
        if proc is None:
            return
        if proc.poll() is None:
            if os.name == "nt":
                # Ollama serves loaded models from child runner processes on Windows.
                try:
                    subprocess.run(["taskkill.exe", "/PID", str(proc.pid), "/T", "/F"],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=1.5,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                except (OSError, subprocess.TimeoutExpired):
                    pass
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=1)
        OLLAMA_STATE["proc"] = None


def _start_ollama():
    deadline = time.monotonic() + OLLAMA_START_TIMEOUT
    with OLLAMA_START_LOCK:
        if GATEWAY_STOPPING.is_set():
            return _ollama_result(False, False, code="gateway_stopping", detail="Gateway is stopping.")
        if _ollama_version():
            return _ollama_result(True, True, len(_ollama_models("/api/tags", timeout=1)))
        proc = OLLAMA_STATE.get("proc")
        if proc is None or proc.poll() is not None:
            if UP_HOST not in ("127.0.0.1", "localhost", "::1"):
                return _ollama_result(False, False, code="ollama_not_local", detail="The configured Ollama endpoint is remote.")
            executable = _find_ollama()
            if not executable:
                return _ollama_result(False, False, code="ollama_not_installed", detail="Ollama was not found. Install Ollama and retry.")
            ollama_host = "[%s]" % UP_HOST if ":" in UP_HOST else UP_HOST
            try:
                proc = subprocess.Popen([executable, "serve"], stdin=subprocess.DEVNULL,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        env={**os.environ, "OLLAMA_HOST": "%s:%d" % (ollama_host, UP_PORT)},
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except OSError as exc:
                return _ollama_result(False, False, code="ollama_start_failed", detail=str(exc)[:160])
            OLLAMA_STATE["proc"] = proc

    while not GATEWAY_STOPPING.is_set():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        if _ollama_version(timeout=min(1, remaining)):
            return _ollama_result(True, True, len(_ollama_models("/api/tags", timeout=1)))
        exit_code = proc.poll()
        if exit_code is not None:
            return _ollama_result(False, False, code="ollama_exited", detail="Ollama exited before becoming ready (code %s)." % exit_code)
        GATEWAY_STOPPING.wait(min(OLLAMA_PROBE_INTERVAL, max(0, deadline - time.monotonic())))
    if GATEWAY_STOPPING.is_set():
        return _ollama_result(False, False, code="gateway_stopping", detail="Gateway is stopping.")
    return _ollama_result(False, False, code="ollama_start_timeout", detail="Ollama did not become ready before the startup deadline.")


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


def normalized_path(path):
    """Decode and normalise a request path before any prefix decision.

    Decoding repeats: one unquote turns /api/%2570ull into /api/%70ull, which the
    upstream would decode again. Leading slashes collapse because normpath keeps
    "//" intact, and the result is what gets forwarded, so the check and the
    upstream request can never disagree.
    """
    text = str(path or "")
    for _ in range(4):
        try:
            decoded = urllib.parse.unquote(text)
        except Exception:
            break
        if decoded == text:
            break
        text = decoded
    text = "/" + text.lstrip("/")
    text = posixpath.normpath(text)
    if not text.startswith("/"):
        text = "/" + text
    return text


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "HymnixGateway/" + VERSION

    # ---------- 基础工具 ----------
    def log_message(self, fmt, *args):
        pass

    def _ip(self):
        # Forwarded headers are only believable when a proxy we trust wrote them.
        # Any local process can send CF-Connecting-IP over a loopback socket, so
        # this is opt-in (trust_proxy_headers) and off by default.
        if self.client_address[0] in ("127.0.0.1", "::1") and bool(CFG.get("trust_proxy_headers", False)):
            fwd = self.headers.get("CF-Connecting-IP", "").strip()
            if not fwd:
                xff = self.headers.get("X-Forwarded-For", "")
                fwd = xff.split(",")[0].strip() if xff else ""
            if fwd:
                return fwd
        return self.client_address[0]

    def _direct_local(self):
        """True only for a request that reached the loopback socket without a proxy.

        A Cloudflare tunnel also connects from 127.0.0.1, so the socket address
        alone cannot prove the caller is the desktop app on this machine.
        cloudflared tags every forwarded request, and those markers disqualify it.
        """
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            return False
        for header in ("CF-Connecting-IP", "CF-Ray", "CF-Visitor", "X-Forwarded-For", "X-Real-IP"):
            if (self.headers.get(header) or "").strip():
                return False
        return True

    def _cors_origin(self):
        """Only the desktop shell and loopback pages may read our responses.

        A wildcard here let any web page on the internet read /admin/* through a
        DNS-rebinding trick, so the header is echoed from a list instead.
        """
        origin = (self.headers.get("Origin") or "").strip()
        if origin and CORS_ORIGIN_RE.match(origin):
            return origin
        return ""

    def _json(self, code, obj, extra_headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Authorization, X-API-Key, X-Admin-Key, Content-Type")
        self.send_header("Cache-Control", "no-store")
        # An error answered before the request body was read used to leave those
        # bytes in the socket, where the keep-alive parser took them for the next
        # request line (the same smuggling class as the chunked case). Closing on
        # every error keeps the connection boundary honest.
        if code >= 400:
            self.close_connection = True
            self.send_header("Connection", "close")
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
            # A key in the URL ends up in history, proxy logs and Referer, so the
            # query fallback is limited to a direct loopback request (the dashboard).
            parsed_admin = urllib.parse.urlparse(self.path)
            # Query keys are limited to loopback HTML pages. The admin API must
            # never take a key from the URL: a smuggled request line could carry it.
            if self.command == "GET" and self._direct_local() and not parsed_admin.path.startswith("/admin/"):
                q = parsed_admin.query
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

    def _read_json_body(self):
        """Best-effort JSON object from the request body; empty dict on failure."""
        try:
            raw = self._read_body()
        except ValueError:
            return {}
        try:
            payload = json.loads(raw.decode("utf-8", "ignore") or "{}")
        except Exception:
            return {}
        return payload if isinstance(payload, dict) else {}

    # ---------- HTTP 动词 ----------
    # ---------- 一体化：主机身份 / 访客登录 / 公网隧道 ----------
    def _connect_verify(self):
        # Guessing the share password is the cheapest way in, so failed attempts
        # feed the same ban list the API key uses.
        client = self._ip()
        if banned(client):
            return self._json(429, {"ok": False, "error": "too_many_attempts"})
        body = self._read_body()
        try:
            payload = json.loads(body.decode("utf-8", "ignore") or "{}")
        except Exception:
            return self._json(400, {"ok": False, "error": "invalid_json"})
        if not isinstance(payload, dict):
            return self._json(400, {"ok": False, "error": "invalid_payload"})
        name = str(payload.get("name") or "").strip()
        password = str(payload.get("password") or "")
        if not CFG.get("allow_remote", True):
            return self._json(403, {"ok": False, "error": "remote_disabled"})
        expected_name = str(CFG.get("host_name") or "").strip()
        expected_password = str(CFG.get("host_password") or "")
        if not expected_password or not hmac.compare_digest(password.encode(), expected_password.encode()):
            note_auth_failure(client)
            log_event("connect_fail", ip=client, reason="bad_password")
            return self._json(401, {"ok": False, "error": "bad_password"})
        if name and expected_name and name != expected_name:
            note_auth_failure(client)
            return self._json(401, {"ok": False, "error": "name_mismatch"})
        return self._json(200, {"ok": True, "name": expected_name, "token": API_KEY, "gateway": VERSION})

    def _admin_network(self):
        # The share password used to be returned in plain text to anyone who asked.
        # Hand it out only to the desktop app on this machine, and never to a
        # request that came through the public tunnel.
        password = str(CFG.get("host_password") or "")
        reveal = "reveal=1" in (self.path or "") and self._direct_local()
        return self._json(200, {
            "ok": True,
            "host_name": CFG.get("host_name") or "",
            "host_password": password if reveal else "",
            "host_password_masked": self._mask_key(password),
            "has_password": bool(password),
            "allow_remote": bool(CFG.get("allow_remote", True)),
            "tunnel": read_tunnel_url(),
            "tunnel_running": TUNNEL_STATE.get("proc") is not None,
            "listen_port": listen_address()[1],
        })

    def _mask_key(self, value):
        text = str(value or "")
        return "" if not text else ("*" * max(0, len(text) - 4) + text[-4:])

    CONFIG_EDITABLE = {
        "default_model", "idle_unload_seconds", "idle_check_seconds", "prompt_char_limit",
        "keep_log_days", "online_timeout_s", "max_body_mb", "billing_enabled",
        "daily_quota_tokens", "power_price", "base_power_w", "allow_remote",
        "chat_source", "timezone", "compat_mode", "inject_time", "enable_note_injection",
        "auto_approve_tools", "tool_policy",
    }

    def _admin_ollama(self, method="POST"):
        payload = {}
        if method == "POST":
            try:
                payload = json.loads(self._read_body() or b"{}")
            except (ValueError, UnicodeError):
                pass
        action = str(payload.get("action") or "status").strip().lower() if isinstance(payload, dict) else "status"
        if action == "start":
            return self._json(200, _start_ollama())
        if action == "stop":
            try:
                _stop_owned_ollama()
            except (OSError, subprocess.TimeoutExpired) as exc:
                return self._json(200, _ollama_result(False, bool(_ollama_version()), code="ollama_stop_failed", detail=str(exc)[:160]))
        online = bool(_ollama_version())
        models = len(_ollama_models("/api/tags", timeout=1)) if online else 0
        return self._json(200, _ollama_result(True, online, models))

    def _admin_config(self, method):
        if method == "GET":
            data = {key: CFG.get(key) for key in sorted(self.CONFIG_EDITABLE)}
            data["host_name"] = CFG.get("host_name")
            data["listen_port"] = listen_address()[1]
            data["upstream_host"] = UP_HOST
            data["upstream_port"] = UP_PORT
            return self._json(200, {"ok": True, "editable": sorted(self.CONFIG_EDITABLE), "values": data})
        body = self._read_body()
        try:
            payload = json.loads(body.decode("utf-8", "ignore") or "{}")
        except Exception:
            return self._json(400, {"ok": False, "error": "invalid_json"})
        if not isinstance(payload, dict):
            return self._json(400, {"ok": False, "error": "invalid_payload"})
        changed = {}
        rejected = []
        for key, value in payload.items():
            if key not in self.CONFIG_EDITABLE:
                rejected.append(key)
                continue
            current = CFG.get(key)
            if isinstance(current, bool):
                value = bool(value)
            elif isinstance(current, int) and not isinstance(current, bool):
                try:
                    value = int(value)
                except Exception:
                    rejected.append(key)
                    continue
            elif isinstance(current, float):
                try:
                    value = float(value)
                except Exception:
                    rejected.append(key)
                    continue
            else:
                value = str(value)
            CFG[key] = value
            changed[key] = value
        if changed:
            try:
                _write_text_atomic(CONFIG_PATH, json.dumps(CFG, ensure_ascii=False, indent=2))
            except Exception:
                pass
            _sync_runtime(CFG)
            append_log("config-%s.jsonl" % _today(), {"t": time.strftime("%Y-%m-%d %H:%M:%S"), "changed": changed})
        return self._json(200, {"ok": True, "changed": changed, "rejected": rejected})

    # ---------- provider profiles ----------
    def _providers(self):
        rows = CFG.get("cloud_providers")
        return rows if isinstance(rows, list) else []

    def _provider_view(self, row, reveal=False):
        key = str(row.get("api_key") or "")
        return {
            "id": str(row.get("id") or ""),
            "label": str(row.get("label") or ""),
            "kind": _cloud_kind(row.get("kind")),
            "base_url": str(row.get("base_url") or ""),
            "models": [str(m) for m in (row.get("models") or []) if isinstance(m, str) and m.strip()][:500],
            "agent_id": str(row.get("agent_id") or ""),
            "max_tokens": int(row.get("max_tokens") or 0),
            "max_effort": bool(row.get("max_effort")),
            "has_key": bool(key),
            "api_key_masked": self._mask_key(key),
            "api_key": key if reveal else "",
        }

    def _providers_payload(self, reveal=False):
        active = str(CFG.get("cloud_active") or "")
        rows = [self._provider_view(row, reveal) for row in self._providers() if isinstance(row, dict)]
        cloud = CFG.get("cloud_api") or {}
        return {
            "ok": True,
            "providers": rows,
            "active": active,
            "chat_source": CFG.get("chat_source") or "local",
            "current_model": str(cloud.get("model") or ""),
            "auto_approve_tools": bool(CFG.get("auto_approve_tools", False)),
        }

    def _save_config_file(self):
        try:
            _write_text_atomic(CONFIG_PATH, json.dumps(CFG, ensure_ascii=False, indent=2))
        except Exception:
            pass

    def _probe_provider_models(self, row):
        kind = _cloud_kind(row.get("kind"))
        base = str(row.get("base_url") or "").strip().rstrip("/")
        key = str(row.get("api_key") or "")
        if not base:
            raise ValueError("base_url_missing")
        _checked_base_url(base)
        url = _cloud_url(base, "/models")
        headers = {"Accept": "application/json"}
        if key:
            headers["Authorization"] = "Bearer " + key
        if kind == "anthropic":
            url += "?limit=100"
            if key:
                headers["x-api-key"] = key
            headers["anthropic-version"] = "2023-06-01"
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8", "ignore") or "{}")
        found = []
        for item in (data.get("data") or data.get("models") or []):
            if not isinstance(item, dict):
                continue
            name = item.get("id") or item.get("name") or item.get("model")
            if isinstance(name, str) and name.strip():
                found.append(name.strip())
        return sorted(set(found))[:500]

    def _admin_providers(self):
        return self._json(200, self._providers_payload())

    def _admin_providers_save(self):
        payload = self._read_json_body()
        action = str(payload.get("action") or "save").strip().lower()
        rows = [dict(row) for row in self._providers() if isinstance(row, dict)]
        by_id = {str(row.get("id") or ""): index for index, row in enumerate(rows)}

        if action == "delete":
            target = str(payload.get("id") or "")
            if target not in by_id:
                return self._json(404, {"ok": False, "error": "provider_not_found"})
            rows.pop(by_id[target])
            CFG["cloud_providers"] = rows
            if str(CFG.get("cloud_active") or "") == target:
                CFG["cloud_active"] = rows[0]["id"] if rows else ""
                self._apply_active_provider(rows[0] if rows else None, "")
            self._save_config_file()
            return self._json(200, self._providers_payload())

        if action == "select":
            target = str(payload.get("id") or "")
            if target not in by_id:
                return self._json(404, {"ok": False, "error": "provider_not_found"})
            row = rows[by_id[target]]
            wanted = str(payload.get("model") or "").strip()
            models = [m for m in (row.get("models") or []) if isinstance(m, str)]
            model = wanted if wanted in models else (models[0] if models else str(row.get("model") or ""))
            CFG["cloud_active"] = target
            self._apply_active_provider(row, model)
            self._save_config_file()
            return self._json(200, self._providers_payload())

        if action in ("add_model", "remove_model"):
            target = str(payload.get("id") or "")
            if target not in by_id:
                return self._json(404, {"ok": False, "error": "provider_not_found"})
            name = str(payload.get("model") or "").strip()[:200]
            if not name or any(ord(ch) < 32 for ch in name):
                return self._json(400, {"ok": False, "error": "invalid_model"})
            models = [m for m in (rows[by_id[target]].get("models") or []) if isinstance(m, str)]
            if action == "add_model":
                if name not in models:
                    models.append(name)
            else:
                models = [m for m in models if m != name]
            rows[by_id[target]]["models"] = models[:500]
            CFG["cloud_providers"] = rows
            self._save_config_file()
            return self._json(200, self._providers_payload())

        if action == "fetch_models":
            target = str(payload.get("id") or "")
            if target not in by_id:
                return self._json(404, {"ok": False, "error": "provider_not_found"})
            try:
                found = self._probe_provider_models(rows[by_id[target]])
            except ValueError as exc:
                return self._json(400, {"ok": False, "error": str(exc)})
            except Exception as exc:
                return self._json(502, {"ok": False, "error": "provider_unreachable", "detail": str(exc)[:200]})
            merged = [m for m in (rows[by_id[target]].get("models") or []) if isinstance(m, str)]
            for name in found:
                if name not in merged:
                    merged.append(name)
            rows[by_id[target]]["models"] = merged[:500]
            CFG["cloud_providers"] = rows
            self._save_config_file()
            result = self._providers_payload()
            result["fetched"] = found
            return self._json(200, result)

        # save (create or update)
        raw = payload.get("provider") if isinstance(payload.get("provider"), dict) else {}
        target = str(raw.get("id") or "")
        try:
            base_url = _checked_base_url(raw.get("base_url"))
        except ValueError as exc:
            return self._json(400, {"ok": False, "error": str(exc)})
        label = str(raw.get("label") or "").strip()[:60] or "Provider"
        models = [str(m).strip()[:200] for m in (raw.get("models") or []) if isinstance(m, str) and m.strip()][:500]
        key = raw.get("api_key")
        record = {
            "id": target if target in by_id else "p" + secrets.token_hex(6),
            "label": label,
            "kind": _cloud_kind(raw.get("kind")),
            "base_url": base_url,
            "models": models,
            "agent_id": str(raw.get("agent_id") or "").strip()[:120],
            "max_tokens": max(0, min(200000, int(raw.get("max_tokens") or 0) if str(raw.get("max_tokens") or 0).isdigit() else 0)),
            "max_effort": bool(raw.get("max_effort")),
        }
        if target in by_id:
            record["api_key"] = rows[by_id[target]].get("api_key", "")
        else:
            record["api_key"] = ""
        if isinstance(key, str) and key.strip() and "*" not in key:
            record["api_key"] = key.strip()
        if target in by_id:
            rows[by_id[target]] = record
        else:
            rows.append(record)
        CFG["cloud_providers"] = rows
        if not str(CFG.get("cloud_active") or "") or str(CFG.get("cloud_active")) == record["id"]:
            CFG["cloud_active"] = record["id"]
            self._apply_active_provider(record, models[0] if models else "")
        self._save_config_file()
        return self._json(200, self._providers_payload())

    def _apply_active_provider(self, row, model):
        """Copy the chosen profile into cloud_api so the chat path stays unchanged."""
        if not row:
            CFG["cloud_api"] = {"base_url": "", "api_key": "", "model": "", "kind": "openai", "agent_id": "", "max_tokens": 0}
            CFG["chat_source"] = "local"
            return
        CFG["cloud_api"] = {
            "base_url": str(row.get("base_url") or ""),
            "api_key": str(row.get("api_key") or ""),
            "model": str(model or (row.get("models") or [""])[0] or ""),
            "kind": _cloud_kind(row.get("kind")),
            "agent_id": str(row.get("agent_id") or ""),
            "max_tokens": int(row.get("max_tokens") or 0),
        }
        CFG["chat_source"] = "cloud"

    def _admin_cloud(self):
        cloud = CFG.get("cloud_api") or {}
        payload = {
            "ok": True,
            "chat_source": CFG.get("chat_source") or "local",
            "cloud_enabled": bool(CFG.get("cloud_enabled", False)),
            "kind": _cloud_kind(cloud.get("kind")),
            "base_url": cloud.get("base_url") or "",
            "model": cloud.get("model") or "",
            "agent_id": cloud.get("agent_id") or "",
            "max_tokens": int(cloud.get("max_tokens") or 0),
            "api_key_masked": self._mask_key(cloud.get("api_key")),
            "has_key": bool(cloud.get("api_key")),
        }
        # The desktop client streams chat itself, so it needs the real key after a
        # restart. Hand it out only to a direct loopback caller that already proved
        # the admin key — a request through the public tunnel fails the IP check.
        if "reveal=1" in (self.path or "") and self._ip() in ("127.0.0.1", "::1"):
            payload["api_key"] = cloud.get("api_key") or ""
        return self._json(200, payload)

    def _admin_cloud_save(self):
        body = self._read_body()
        try:
            payload = json.loads(body.decode("utf-8", "ignore") or "{}")
        except Exception:
            return self._json(400, {"ok": False, "error": "invalid_json"})
        if not isinstance(payload, dict):
            return self._json(400, {"ok": False, "error": "invalid_payload"})
        cloud = dict(CFG.get("cloud_api") or {})
        cloud.setdefault("kind", "openai")
        if "kind" in payload:
            cloud["kind"] = _cloud_kind(payload.get("kind"))
        if "base_url" in payload:
            try:
                cloud["base_url"] = _checked_base_url(payload.get("base_url"))
            except ValueError as exc:
                return self._json(400, {"ok": False, "error": str(exc)})
        if "model" in payload:
            cloud["model"] = str(payload.get("model") or "").strip()
        if "agent_id" in payload:
            cloud["agent_id"] = str(payload.get("agent_id") or "").strip()[:120]
        if "max_tokens" in payload:
            try:
                cloud["max_tokens"] = max(0, min(200000, int(payload.get("max_tokens") or 0)))
            except (TypeError, ValueError):
                cloud["max_tokens"] = 0
        api_key = payload.get("api_key")
        if isinstance(api_key, str) and api_key.strip() and "*" not in api_key:
            cloud["api_key"] = api_key.strip()
        CFG["cloud_api"] = cloud
        if isinstance(payload.get("chat_source"), str) and payload["chat_source"] in ("local", "cloud"):
            CFG["chat_source"] = payload["chat_source"]
        if "cloud_enabled" in payload:
            CFG["cloud_enabled"] = bool(payload.get("cloud_enabled"))
        try:
            _write_text_atomic(CONFIG_PATH, json.dumps(CFG, ensure_ascii=False, indent=2))
        except Exception:
            pass
        return self._admin_cloud()

    def _admin_cloud_test(self):
        """Probe the saved provider with the headers its protocol actually needs."""
        cloud = CFG.get("cloud_api") or {}
        kind = _cloud_kind(cloud.get("kind"))
        base = str(cloud.get("base_url") or "").strip().rstrip("/")
        key = str(cloud.get("api_key") or "")
        model = str(cloud.get("model") or "")
        if not base:
            return self._json(400, {"ok": False, "error": "base_url_missing"})
        try:
            _checked_base_url(base)
        except ValueError as exc:
            return self._json(400, {"ok": False, "error": str(exc)})
        url = _cloud_url(base, "/models")
        headers = {"Accept": "application/json"}
        if key:
            headers["Authorization"] = "Bearer " + key
        if kind == "anthropic":
            url += "?limit=100"
            if key:
                headers["x-api-key"] = key
            headers["anthropic-version"] = "2023-06-01"
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8", "ignore") or "{}")
            models = [item.get("id") for item in (data.get("data") or []) if isinstance(item, dict)]
            return self._json(200, {"ok": True, "kind": kind, "count": len(models), "models": models[:20]})
        except Exception as exc:
            detail = str(exc)[:200]
            if kind == "openclaw" and ("404" in detail or "Not Found" in detail):
                detail = "OpenClaw 的 OpenAI 兼容端点未开启：设置 gateway.http.endpoints.chatCompletions.enabled = true 后重启网关。"
            return self._json(502, {"ok": False, "kind": kind, "error": "cloud_unreachable",
                                    "model": model, "detail": detail})


    def _admin_network_save(self):
        body = self._read_body()
        try:
            payload = json.loads(body.decode("utf-8", "ignore") or "{}")
        except Exception:
            return self._json(400, {"ok": False, "error": "invalid_json"})
        if not isinstance(payload, dict):
            return self._json(400, {"ok": False, "error": "invalid_payload"})
        if isinstance(payload.get("host_name"), str) and payload["host_name"].strip():
            CFG["host_name"] = payload["host_name"].strip()[:40]
        password = payload.get("host_password")
        if isinstance(password, str) and password.strip():
            CFG["host_password"] = password.strip()[:64]
        if "allow_remote" in payload:
            CFG["allow_remote"] = bool(payload.get("allow_remote"))
        try:
            _write_text_atomic(CONFIG_PATH, json.dumps(CFG, ensure_ascii=False, indent=2))
        except Exception:
            pass
        _tunnel_note("host identity updated")
        return self._json(200, {"ok": True, "host_name": CFG.get("host_name"), "has_password": bool(CFG.get("host_password"))})

    def _admin_tunnel(self):
        body = self._read_body()
        try:
            payload = json.loads(body.decode("utf-8", "ignore") or "{}")
        except Exception:
            payload = {}
        action = str((payload or {}).get("action") or "start").strip().lower()
        if action == "stop":
            stop_tunnel()
            return self._admin_tunnel_status()
        if action == "restart":
            stop_tunnel()
        state = start_tunnel()
        return self._json(200, state)

    def _admin_tunnel_status(self):
        return self._json(200, tunnel_status())

    def do_OPTIONS(self):
        # Preflights never carry a body. Anything with one is either broken or an
        # attempt to smuggle a second request onto the same keep-alive connection.
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > 0 or self.headers.get("Transfer-Encoding") is not None:
            self.close_connection = True
            try:
                self._json(400, {"ok": False, "error": "body_not_allowed_on_options"})
            except Exception:
                pass
            return
        self.send_response(204)
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, X-API-Key, X-Admin-Key, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
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
        # This server never accepts chunked bodies. Reading only Content-Length
        # while an attacker sends Transfer-Encoding let the leftover bytes be
        # parsed as a second request on the same keep-alive connection.
        if self.headers.get("Transfer-Encoding") is not None:
            self.close_connection = True
            try:
                self._json(400, {"ok": False, "error": "transfer_encoding_unsupported"})
            except Exception:
                pass
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            # One gate for the whole admin surface. Every handler below assumes the
            # caller already proved the admin key, so a newly added route cannot be
            # published without authentication by forgetting a check.
            if path.startswith("/admin/") and not self._admin_ok():
                with LOCK:
                    STATS["auth_fail"] += 1
                note_auth_failure(self._ip())
                log_event("admin_auth_fail", ip=self._ip(), path=path)
                return self._json(401, {"ok": False, "error": "admin_key_required"})
            if path == "/api/tools":
                if method != "GET":
                    return self._json(405, {"ok": False, "error": "method_not_allowed"})
                if parsed.query:
                    return self._json(400, {"ok": False, "error": "query_not_allowed"})
                return self._tools_catalog()
            if path == "/api/tools/call":
                if method != "POST":
                    return self._json(405, {"ok": False, "error": "method_not_allowed"})
                if parsed.query:
                    return self._json(400, {"ok": False, "error": "query_not_allowed"})
                return self._tools_call()
            if path == "/admin/approvals":
                if method != "GET":
                    return self._json(405, {"ok": False, "error": "method_not_allowed"})
                if parsed.query:
                    return self._json(400, {"ok": False, "error": "query_not_allowed"})
                return self._admin_approvals_list()
            if path.startswith("/admin/approvals/"):
                if method != "POST":
                    return self._json(405, {"ok": False, "error": "method_not_allowed"})
                if parsed.query:
                    return self._json(400, {"ok": False, "error": "query_not_allowed"})
                return self._admin_approval_decide(path.rsplit("/", 1)[-1])
            if path in ("/api/files/tree", "/api/files/search", "/api/files/read"):
                if method != "GET":
                    return self._json(405, {"ok": False, "error": "method_not_allowed"})
                return self._files_api(path, parsed.query)
            if path == "/admin/cleanup" and method == "POST":
                return self._admin_cleanup()
            if path == "/admin/send" and method == "POST":
                return self._inbox_send()
            if path == "/api/inbox":
                return self._inbox_fetch()
            if path == "/connect" and method == "POST":
                return self._connect_verify()
            if path == "/admin/network" and method == "GET":
                return self._admin_network()
            if path == "/admin/network" and method == "POST":
                return self._admin_network_save()
            if path == "/admin/ollama" and method in ("GET", "POST"):
                return self._admin_ollama(method)
            if path == "/admin/config":
                return self._admin_config(method)
            if path == "/admin/cloud" and method == "GET":
                return self._admin_cloud()
            if path == "/admin/cloud" and method == "POST":
                return self._admin_cloud_save()
            if path == "/admin/providers" and method == "GET":
                return self._admin_providers()
            if path == "/admin/providers" and method == "POST":
                return self._admin_providers_save()
            if path == "/admin/cloud/test" and method == "POST":
                return self._admin_cloud_test()
            if path == "/admin/tunnel" and method == "POST":
                return self._admin_tunnel()
            if path == "/admin/tunnel" and method == "GET":
                return self._admin_tunnel_status()
            if path == "/health":
                _now = time.time()
                if HEALTH_CACHE["payload"] and _now - HEALTH_CACHE["at"] < 5:
                    return self._json(200, HEALTH_CACHE["payload"])
                st = upstream_status()
                payload = {"ok": True, "gateway": VERSION,
                           "tunnel": read_tunnel_url(),
                           "ollama": st["online"],
                           "models": len(st["models"]),
                           "clients_online": sum(1 for c in clients_snapshot() if c["online"]),
                           "uptime_s": int(time.time() - START_TS)}
                HEALTH_CACHE["payload"] = payload
                HEALTH_CACHE["at"] = _now
                return self._json(200, payload)
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
    def _tools_catalog(self):
        if not self._api_key_ok():
            return self._json(401, {"ok": False, "error": "unauthorized"})
        try:
            from hxcore import tools as tool_registry
            tool_registry.builtin_tools()
            catalog = []
            for item in tool_registry.all_tools():
                if not isinstance(item, dict):
                    continue
                catalog.append({
                    "name": str(item.get("name") or ""),
                    "description": str(item.get("description") or ""),
                    "schema": item.get("schema") if isinstance(item.get("schema"), dict) else {"type": "object", "properties": {}},
                    "danger": bool(item.get("danger")),
                    "permission": item.get("permission"),
                })
            catalog.sort(key=lambda item: item["name"])
            return self._json(200, {"ok": True, "tools": catalog, "count": len(catalog)})
        except Exception:
            return self._json(500, {"ok": False, "error": "tools_catalog_unavailable"})

    def _tools_call(self):
        if not self._api_key_ok():
            return self._json(401, {"ok": False, "error": "unauthorized"})
        try:
            raw = self._read_bounded_json(16384)
            # Accept both spellings: the desktop app used to send requestId while
            # this handler only read request_id, which rejected every call.
            request_id = raw.get("request_id", raw.get("requestId"))
            name = raw.get("tool")
            args = raw.get("args", {})
            if (not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", request_id)
                    or not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", name)
                    or not isinstance(args, dict)
                    or set(raw) - {"request_id", "requestId", "tool", "args"}):
                return self._json(400, {"ok": False, "error": "invalid_request"})
            if len(json.dumps(args, ensure_ascii=False).encode("utf-8")) > 8192:
                return self._json(413, {"ok": False, "error": "arguments_too_large"})
            import time as _time
            from hxcore import approvals, tools as tool_registry
            tool_registry.builtin_tools()
            now = _time.time()
            with _TOOL_APPROVAL_LOCK:
                for rid, expiry in list(_TOOL_REQUEST_IDS.items()):
                    if expiry <= now:
                        del _TOOL_REQUEST_IDS[rid]
                if request_id in _TOOL_REQUEST_IDS:
                    return self._json(409, {"ok": False, "error": "duplicate_request_id"})
                if len(_TOOL_REQUEST_IDS) >= _TOOL_REQUEST_MAX:
                    oldest = min(_TOOL_REQUEST_IDS, key=_TOOL_REQUEST_IDS.get)
                    del _TOOL_REQUEST_IDS[oldest]
                _TOOL_REQUEST_IDS[request_id] = now + _TOOL_APPROVAL_TTL
            item = tool_registry.get(name)
            if name in _SAFE_REMOTE_TOOLS:
                if not item:
                    return self._json(400, {"ok": False, "error": "unknown_tool"})
                result = tool_registry.call(name, args)
                safe_result = _approval_redact(result.get("result"))
                status = 200 if result.get("ok") else 400
                return self._json(status, {"ok": bool(result.get("ok")), "request_id": request_id,
                                           "tool": name, "result": safe_result,
                                           "error": str(result.get("error") or "")[:128]})
            policy = str(CFG.get("tool_policy") or "workspace").strip().lower()
            allowed, reason = _tool_policy_allows(policy, name)
            if not allowed:
                try:
                    append_log("tool-denied-%s.jsonl" % _today(), {
                        "t": time.strftime("%Y-%m-%d %H:%M:%S"), "request_id": request_id,
                        "tool": name, "policy": policy, "reason": reason, "ip": self._ip()})
                except Exception:
                    pass
                return self._json(403, {"ok": False, "request_id": request_id, "tool": name,
                                        "error": "policy_denied", "policy": policy, "detail": reason})
            if bool(CFG.get("auto_approve_tools", False)):
                # Global "auto allow" switch from the composer. The call is still
                # audited, it just never enters the approval queue. Without this
                # branch the queue below was dead code and every tool ran unattended.
                if not item:
                    return self._json(400, {"ok": False, "error": "unknown_tool"})
                result = tool_registry.call(name, args)
                safe_result = _approval_redact(result.get("result"))
                try:
                    append_log("tool-auto-%s.jsonl" % _today(), {
                        "t": time.strftime("%Y-%m-%d %H:%M:%S"), "request_id": request_id,
                        "tool": name, "args_sha256": approvals.args_digest(args),
                        "ok": bool(result.get("ok")), "ip": self._ip()})
                except Exception:
                    pass
                status = 200 if result.get("ok") else 400
                return self._json(status, {"ok": bool(result.get("ok")), "request_id": request_id,
                                           "tool": name, "result": safe_result,
                                           "error": str(result.get("error") or "")[:128],
                                           "auto_approved": True})
            command = "tool:" + name + " " + json.dumps(args, ensure_ascii=False, sort_keys=True)
            decision = approvals.check(command, origin="api")
            approvals.record(decision, "tool:" + name + " [args_sha256:" + approvals.args_digest(args) + "]")
            pending = approvals.create_pending(request_id, name, args, decision=decision)
            if not pending.get("ok"):
                status = 409 if pending.get("error") == "conflict" else 400
                return self._json(status, {"ok": False, "error": pending.get("error", "pending_failed")})
            with _TOOL_APPROVAL_LOCK:
                _TOOL_APPROVAL_ARGS[pending["approval_id"]] = {
                    "request_id": request_id, "tool": name, "args": args,
                    "expires_at": pending["expires_at"]}
                if len(_TOOL_APPROVAL_ARGS) > _TOOL_APPROVAL_MAX:
                    oldest = sorted(_TOOL_APPROVAL_ARGS, key=lambda k: _TOOL_APPROVAL_ARGS[k]["expires_at"])
                    for key in oldest[:-_TOOL_APPROVAL_MAX]:
                        _TOOL_APPROVAL_ARGS.pop(key, None)
            return self._json(202, {"ok": False, "error": "approval_required",
                                    "approval": {"id": pending["approval_id"], "request_id": request_id,
                                                 "tool": name, "args": pending.get("args_redacted", {}),
                                                 "risk": decision.get("risk", "unknown"),
                                                 "reasons": decision.get("reasons", []),
                                                 "expires_at": pending.get("expires_at")}})
        except _BoundedJSONError as exc:
            return self._json(exc.status, {"ok": False, "error": exc.code})
        except (UnicodeError, json.JSONDecodeError):
            return self._json(400, {"ok": False, "error": "invalid_json"})

    def _admin_approvals_list(self):
        if not self._admin_ok():
            return self._json(401, {"ok": False, "error": "admin_key_required"})
        from hxcore import approvals
        rows = []
        with _TOOL_APPROVAL_LOCK:
            entries = list(_TOOL_APPROVAL_ARGS.items())
        for approval_id, cached in entries:
            pending = approvals.get_pending(approval_id)
            if not pending.get("ok"):
                with _TOOL_APPROVAL_LOCK:
                    _TOOL_APPROVAL_ARGS.pop(approval_id, None)
                continue
            decision = pending.get("decision") or {}
            rows.append({"id": approval_id, "request_id": pending.get("request_id"),
                         "tool": pending.get("tool"), "args": pending.get("args_redacted", {}),
                         "risk": decision.get("risk", "unknown"), "reasons": decision.get("reasons", []),
                         "created_at": pending.get("created_at"), "expires_at": pending.get("expires_at")})
        rows.sort(key=lambda row: row.get("created_at") or 0, reverse=True)
        return self._json(200, {"ok": True, "approvals": rows[:100], "count": min(len(rows), 100)})

    def _admin_approval_decide(self, approval_id):
        if not self._admin_ok():
            return self._json(401, {"ok": False, "error": "admin_key_required"})
        if not re.fullmatch(r"[a-f0-9]{32}", approval_id):
            return self._json(400, {"ok": False, "error": "invalid_approval_id"})
        try:
            payload = self._read_bounded_json(4096)
        except _BoundedJSONError as exc:
            return self._json(exc.status, {"ok": False, "error": exc.code})
        except (UnicodeError, json.JSONDecodeError):
            return self._json(400, {"ok": False, "error": "invalid_json"})
        action = payload.get("decision")
        if set(payload) != {"decision"} or action not in ("allow", "deny"):
            return self._json(400, {"ok": False, "error": "invalid_decision"})
        from hxcore import approvals, tools as tool_registry
        pending = approvals.get_pending(approval_id)
        if not pending.get("ok"):
            return self._json(410, {"ok": False, "error": "stale_or_replayed"})
        with _TOOL_APPROVAL_LOCK:
            cached = _TOOL_APPROVAL_ARGS.get(approval_id)
            if not cached or cached.get("expires_at", 0) <= time.time():
                _TOOL_APPROVAL_ARGS.pop(approval_id, None)
                return self._json(410, {"ok": False, "error": "stale"})
            cached = dict(cached)
        name, args, request_id = cached["tool"], cached["args"], cached["request_id"]
        tool_registry.builtin_tools()
        command = "tool:" + name + " " + json.dumps(args, ensure_ascii=False, sort_keys=True)
        current = approvals.check(command, origin="api")
        if action == "allow" and current.get("decision") != "ask":
            return self._json(409, {"ok": False, "error": "policy_changed"})
        consumed = approvals.consume_pending(approval_id, request_id, name, args, action)
        if not consumed.get("ok"):
            with _TOOL_APPROVAL_LOCK:
                _TOOL_APPROVAL_ARGS.pop(approval_id, None)
            code = 409 if consumed.get("error") == "conflict" else 410
            return self._json(code, {"ok": False, "error": consumed.get("error", "stale_or_replayed")})
        with _TOOL_APPROVAL_LOCK:
            _TOOL_APPROVAL_ARGS.pop(approval_id, None)
        if action == "deny":
            approvals.record({**current, "decision": "deny", "admin_decision": "deny"}, "tool:" + name + " [args_sha256:" + approvals.args_digest(args) + "]")
            return self._json(200, {"ok": True, "approval_id": approval_id, "decision": "deny"})
        def _approved(tool, call_args, _decision):
            return (tool == name and approvals.args_digest(call_args) == pending.get("args_digest")
                    and consumed.get("state") == "consumed")
        result = tool_registry.call(name, args, approve=_approved)
        return self._json(200 if result.get("ok") else 400,
                          {"ok": bool(result.get("ok")), "approval_id": approval_id,
                           "tool": name, "result": _approval_redact(result.get("result")),
                           "error": str(result.get("error") or "")[:128]})

    def _read_bounded_json(self, maximum):
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            raise _BoundedJSONError(400, "invalid_content_length")
        if length <= 0:
            raise _BoundedJSONError(400, "empty_body")
        if length > maximum:
            raise _BoundedJSONError(413, "body_too_large")
        body = self.rfile.read(length)
        if len(body) != length:
            raise _BoundedJSONError(400, "incomplete_body")
        try:
            obj = json.loads(body.decode("utf-8", "strict"))
        except (UnicodeError, json.JSONDecodeError):
            raise _BoundedJSONError(400, "invalid_json")
        if not isinstance(obj, dict):
            raise _BoundedJSONError(400, "invalid_payload")
        return obj

    def _files_api(self, path, raw_query):
        if not self._api_key_ok():
            return self._json(401, {"ok": False, "error": "unauthorized"})
        try:
            pairs = urllib.parse.parse_qsl(raw_query, keep_blank_values=True, strict_parsing=True, max_num_fields=8)
            q = {}
            for key, value in pairs:
                if key in q:
                    raise ValueError("duplicate_parameter")
                q[key] = value
            allowed = {"/api/files/tree": {"path", "depth", "limit"},
                       "/api/files/search": {"path", "q", "mode", "include", "limit"},
                       "/api/files/read": {"path"}}[path]
            if set(q) - allowed:
                raise ValueError("unknown_parameter")
            rel = q.get("path", ".")
            if not rel or len(rel) > 2048 or "\x00" in rel:
                raise ValueError("invalid_path")
            from pathlib import Path
            from hxcore.paths import root_dir
            root = Path(root_dir()).resolve(strict=True)
            target = (root / rel).resolve(strict=True)
            try:
                target.relative_to(root)
            except ValueError:
                return self._json(400, {"ok": False, "error": "out_of_scope"})
            scope = target.relative_to(root).as_posix() or "."
            if path.endswith("/tree"):
                depth = _files_int(q.get("depth", "2"), 0, 8, "depth")
                limit = _files_int(q.get("limit", "200"), 1, 500, "limit")
                import hxcore.fstree as fstree
                items = fstree.tree(scope, depth=depth, limit=limit)
                if fstree.last_error():
                    return self._json(400, {"ok": False, "error": "tree_failed"})
                return self._json(200, {"ok": True, "results": items[:limit], "count": len(items[:limit])})
            if path.endswith("/search"):
                text = q.get("q", "")
                if not text or len(text) > 512 or any(ord(ch) < 32 for ch in text):
                    raise ValueError("invalid_query")
                mode = q.get("mode", "name")
                if mode not in ("name", "text"):
                    raise ValueError("invalid_mode")
                limit = _files_int(q.get("limit", "100"), 1, 200, "limit")
                if "include" in q and (not q["include"] or len(q["include"]) > 128):
                    raise ValueError("invalid_include")
                import hxcore.fstree as fstree
                items = (fstree.search_name(text, limit=limit) if mode == "name"
                         else fstree.search_text(text, path=scope, include=q.get("include"), limit=limit))
                if fstree.last_error():
                    return self._json(400, {"ok": False, "error": "search_failed"})
                return self._json(200, {"ok": True, "results": items[:limit], "count": len(items[:limit])})
            if not target.is_file():
                raise ValueError("not_a_file")
            max_bytes = 262144
            if target.stat().st_size > max_bytes:
                return self._json(413, {"ok": False, "error": "file_too_large", "max_bytes": max_bytes})
            data = target.read_bytes()
            if len(data) > max_bytes:
                return self._json(413, {"ok": False, "error": "file_too_large", "max_bytes": max_bytes})
            if b"\x00" in data:
                return self._json(415, {"ok": False, "error": "binary_file"})
            try:
                content = data.decode("utf-8", "strict")
            except UnicodeDecodeError:
                return self._json(415, {"ok": False, "error": "invalid_utf8"})
            return self._json(200, {"ok": True, "path": scope,
                                    "content": content, "size": len(data)})
        except (ValueError, TypeError) as exc:
            return self._json(400, {"ok": False, "error": str(exc) or "invalid_query"})
        except FileNotFoundError:
            return self._json(404, {"ok": False, "error": "not_found"})
        except PermissionError:
            return self._json(403, {"ok": False, "error": "forbidden"})
        except OSError:
            return self._json(400, {"ok": False, "error": "filesystem_error"})

    def _api_key_ok(self):
        got = self._key()
        return bool(got and hmac.compare_digest(got.encode(), API_KEY.encode()))

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
        removed = []
        pending = []          # (path, surviving lines) collected before any write
        for fpath in files:
            keep = []
            changed = False
            try:
                with open(fpath, encoding="utf-8", errors="ignore") as handle:
                    for line in handle:
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
                            changed = True
                        else:
                            keep.append(line)
            except Exception:
                continue
            if changed:
                pending.append((fpath, keep))
        result = {"matched": len(removed), "apply": apply}
        if apply and removed:
            # Archive before touching the originals: if the archive write fails the
            # records stay in place instead of disappearing with the temp file.
            arch_dir = os.path.join(LOG_DIR, "archive")
            os.makedirs(arch_dir, exist_ok=True)
            arch = os.path.join(arch_dir, "removed-%s.jsonl" % datetime.now().strftime("%Y%m%d-%H%M%S"))
            try:
                _write_text_atomic(arch, "".join(json.dumps(rec, ensure_ascii=False) + "\n" for rec in removed))
                result["archived"] = arch
            except Exception as e:
                result["archive_error"] = str(e)
                result["apply"] = False
                return self._json(200, result)
            failed = []
            for fpath, keep in pending:
                try:
                    _write_text_atomic(fpath, "".join(line + "\n" for line in keep))
                except Exception:
                    failed.append(os.path.basename(fpath))
            if failed:
                result["rewrite_error"] = failed
            with LOCK:
                RECENT.clear()
            load_recent_history()
        return self._json(200, result)

    def _admin_plugins(self, method):
        if not self._admin_ok():
            with LOCK:
                STATS["auth_fail"] += 1
            log_event("admin_auth_fail", ip=self._ip(), path="/admin/plugins")
            return self._json(401, {"error": "admin key required"})
        if method == "GET":
            try:
                from hxcore import plugins
                items = []
                for row in plugins.discover():
                    if not isinstance(row, dict) or not isinstance(row.get("id"), str):
                        continue
                    items.append({key: row.get(key) for key in (
                        "id", "name", "version", "apiVersion", "description", "author",
                        "permissions", "capabilities", "enabled", "loaded", "source", "error")})
                    items[-1]["granted"] = plugins.granted(row["id"])
                status = plugins.status()
                return self._json(200, {"ok": True, "count": len(items), "enabled": int(status.get("enabled", 0)),
                                        "loaded": int(status.get("loaded", 0)), "plugins": items})
            except Exception:
                traceback.print_exc()
                return self._json(500, {"ok": False, "error": "plugin_service_unavailable"})
        if method != "POST":
            return self._json(405, {"ok": False, "error": "method_not_allowed"})
        try:
            raw = self._read_body()
            payload = json.loads(raw.decode("utf-8", "strict")) if raw else {}
            if not isinstance(payload, dict):
                return self._json(400, {"ok": False, "error": "invalid_request"})
            from hxcore import plugins
            action = payload.get("action")
            if action == "install":
                source = payload.get("source")
                if not isinstance(source, str) or not source.strip() or len(source) > 4096:
                    return self._json(400, {"ok": False, "error": "invalid_source"})
                result = plugins.install_from_folder(source.strip())
                return self._json(200, {"ok": bool(result.get("ok")), "action": action,
                                        "id": result.get("id", ""), "error": result.get("error", "")})
            plugin_id = payload.get("id")
            if not isinstance(plugin_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,63}", plugin_id):
                return self._json(400, {"ok": False, "error": "invalid_plugin_id"})
            if action in ("grant", "revoke"):
                permission = payload.get("permission")
                if not isinstance(permission, str) or permission not in ("fs.read", "fs.write", "net.http", "ui.toast", "tools.register", "log.write"):
                    return self._json(400, {"ok": False, "error": "invalid_permission"})
                if action == "revoke" and permission in plugins.granted(plugin_id):
                    plugins.unload(plugin_id)
                    plugins.set_enabled(plugin_id, False)
                result = plugins.grant(plugin_id, permission) if action == "grant" else plugins.revoke(plugin_id, permission)
                return self._json(200, {"ok": bool(result.get("ok")), "action": action,
                                        "id": plugin_id, "permission": permission})
            if action == "enable":
                if not plugins.set_enabled(plugin_id, True):
                    return self._json(409, {"ok": False, "error": "permission_not_granted",
                                            "id": plugin_id, "granted": plugins.granted(plugin_id)})
                result = plugins.load(plugin_id)
                if not result.get("ok"):
                    plugins.set_enabled(plugin_id, False)
                return self._json(200 if result.get("ok") else 409,
                                  {"ok": bool(result.get("ok")), "action": action, "id": plugin_id,
                                   "enabled": bool(result.get("ok")), "loaded": bool(result.get("ok")),
                                   "error": result.get("error", ""), "detail": result.get("detail", "")})
            if action == "disable":
                plugins.unload(plugin_id)
                ok = plugins.set_enabled(plugin_id, False)
                return self._json(200 if ok else 404, {"ok": bool(ok), "action": action,
                                                       "id": plugin_id, "enabled": False, "loaded": False})
            if action == "load":
                result = plugins.load(plugin_id)
                return self._json(200 if result.get("ok") else 409,
                                  {"ok": bool(result.get("ok")), "action": action, "id": plugin_id,
                                   "loaded": bool(result.get("ok")), "error": result.get("error", ""),
                                   "detail": result.get("detail", "")})
            if action == "unload":
                ok = plugins.unload(plugin_id)
                return self._json(200, {"ok": True, "action": action, "id": plugin_id,
                                        "loaded": False, "changed": bool(ok)})
            if action == "reload":
                result = plugins.reload(plugin_id)
                return self._json(200 if result.get("ok") else 409,
                                  {"ok": bool(result.get("ok")), "action": action, "id": plugin_id,
                                   "loaded": bool(result.get("ok")), "error": result.get("error", ""),
                                   "detail": result.get("detail", "")})
            if action == "uninstall":
                plugins.unload(plugin_id)
                for permission in plugins.granted(plugin_id):
                    plugins.revoke(plugin_id, permission)
                ok = plugins.uninstall(plugin_id)
                return self._json(200 if ok else 404, {"ok": bool(ok), "action": action,
                                                       "id": plugin_id, "error": "" if ok else "plugin_not_found"})
            return self._json(400, {"ok": False, "error": "invalid_action"})
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._json(400, {"ok": False, "error": "invalid_json"})
        except ValueError:
            return self._json(400, {"ok": False, "error": "invalid_request"})
        except Exception:
            traceback.print_exc()
            return self._json(500, {"ok": False, "error": "plugin_operation_failed"})

    def _admin_api(self, path):
        if not self._admin_ok():
            with LOCK:
                STATS["auth_fail"] += 1
            log_event("admin_auth_fail", ip=self._ip(), path=path)
            return self._json(401, {"error": "admin key required"})

        if path == "/admin/plugins":
            return self._admin_plugins(self.command)

        if path == "/admin/models":
            tags_status, tags = upstream_json("/api/tags", timeout=8)
            ps_status, ps = upstream_json("/api/ps", timeout=8)
            if tags_status != 200 or not isinstance(tags, dict):
                status, body = _error_response(status=tags_status or 502, raw="Ollama model catalog unavailable", upstream_url="http://%s:%d/api/tags" % (UP_HOST, UP_PORT))
                return self._json(status, body)
            loaded = {}
            if ps_status == 200 and isinstance(ps, dict):
                for item in ps.get("models") or []:
                    if isinstance(item, dict):
                        name = item.get("name") or item.get("model")
                        if name: loaded[str(name)] = item
            models = []
            for item in tags.get("models") or []:
                if not isinstance(item, dict): continue
                name = item.get("name") or item.get("model")
                if not name: continue
                models.append({"name": str(name), "size": int(item.get("size") or 0), "loaded": str(name) in loaded})
            return self._json(200, {"models": models})

        if path in ("/admin/models/pull", "/admin/models/delete", "/admin/models/start", "/admin/models/stop"):
            try:
                raw = self._read_body()
                payload = json.loads(raw.decode("utf-8", "ignore")) if raw else {}
                model = str(payload.get("model") or "").strip()
                if not model or len(model) > 200 or any(ord(ch) < 32 for ch in model):
                    return self._json(400, {"error": {"code": "invalid_model", "message": "model is required"}})
                if path.endswith("/pull"):
                    target, body = "/api/pull", {"name": model, "stream": False}
                elif path.endswith("/delete"):
                    target, body = "/api/delete", {"name": model}
                elif path.endswith("/start"):
                    target, body = "/api/generate", {"model": model, "prompt": "", "keep_alive": -1, "stream": False}
                else:
                    target, body = "/api/generate", {"model": model, "prompt": "", "keep_alive": 0, "stream": False}
                encoded = json.dumps(body).encode("utf-8")
                conn, resp = _open_upstream("POST", target, encoded, {"Content-Type": "application/json"}, timeout=900 if target == "/api/pull" else 30)
                raw_response = resp.read(1024 * 1024)
                if resp.status < 200 or resp.status >= 300:
                    status, result = _error_response(status=resp.status, raw=raw_response.decode("utf-8", "ignore"), upstream_url="http://%s:%d%s" % (UP_HOST, UP_PORT, target), model=model)
                    return self._json(status, result)
                try: result = json.loads(raw_response.decode("utf-8", "ignore")) if raw_response else {}
                except Exception: result = {}
                return self._json(200, {"ok": True, "model": model, "status": result.get("status", "success"), "result": result})
            except Exception as exc:
                status, result = _error_response(exc=exc, upstream_url="http://%s:%d" % (UP_HOST, UP_PORT))
                return self._json(status, result)

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
                            "listen": "%s:%s" % listen_address()},
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
            return self._json(200, {"ok": True, "count": len(CLIENTS),
                                    "clients": clients_snapshot()})

        if path == "/admin/clients/disconnect":
            if self.command != "POST":
                return self._json(405, {"ok": False, "error": "method_not_allowed"})
            body = self._read_json_body() or {}
            ip = str(body.get("ip") or "").strip()
            if not ip or len(ip) > 64:
                return self._json(400, {"ok": False, "error": "invalid_ip"})
            with LOCK:
                removed = CLIENTS.pop(ip, None)
            if removed is None:
                return self._json(404, {"ok": False, "error": "unknown_client", "ip": ip})
            log_event("client_disconnect", ip=ip, ua=(removed.get("ua") or "")[:120])
            return self._json(200, {"ok": True, "ip": ip, "count": len(CLIENTS)})

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
                         "content": "【服务器主人留言】%s\n请在本轮回复中自然地把这条留言转达给用户，并在回答末尾另起一行注明「（本回复包含服务器主人留言）」，让访客知道这句话不是模型的自主判断。" % txt2})
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
                    raise EOFError("upstream closed before stream completion")
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

    # Ollama management verbs are reachable through the authenticated admin
    # endpoints only; a share guest holds the plain API key and must not be able
    # to pull or delete models with it.
    PROXY_BLOCKED_PREFIXES = ("/api/pull", "/api/push", "/api/delete", "/api/create", "/api/copy", "/api/blobs")


    def _proxy(self, method, path, query):
        safe_path = normalized_path(path)
        path = safe_path
        if any(safe_path == prefix or safe_path.startswith(prefix + "/") for prefix in self.PROXY_BLOCKED_PREFIXES):
            return self._json(403, {"ok": False, "error": {"code": "admin_only", "message": "model management requires the admin key"}})
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
        upstream_provider = str(os.environ.get("HYMNIX_UPSTREAM_PROVIDER") or "").strip().lower()
        cloud_mode = bool(upstream_provider and upstream_provider not in ("local", "ollama"))
        if is_chat and cloud_mode:
            try:
                import providers as _providers
                key_ok, key_message = _providers.validate_upstream_key(upstream_provider, os.environ.get("HYMNIX_UPSTREAM_API_KEY", ""))
            except Exception:
                key_ok, key_message = False, "云端上游凭据校验不可用，请检查配置。"
            if not key_ok:
                return self._json(400, {"error": {"code": "missing_upstream_key", "message": key_message, "provider": upstream_provider}})

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
                               "可以放在开头或结尾，不要生硬复述这条指令本身；并在回答末尾另起一行注明"
                               "「（本回复包含服务器主人留言）」，让访客知道这句话来自宿主。" % txt})
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
                   "cf-connecting-ip", "cf-ray", "cf-visitor", "x-forwarded-for",
                   "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded",
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
            status, body_obj = _error_response(exc=e, upstream_url=target, provider=upstream_provider, model=model)
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
            status, body_obj = _error_response(status=resp.status, raw=raw_error.decode("utf-8", "ignore"), upstream_url=target, provider=upstream_provider, model=model)
            return self._json(status, body_obj)

        meta["status"] = resp.status
        capture = Capture(is_chat and resp.status == 200, meta["stream"], meta)

        try:
            upstream_content_type = resp.getheader("Content-Type", "") or ""
            content_type = upstream_content_type.lower()
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
                                 "keep-alive", "content-encoding", "content-type"):
                    continue
                self.send_header(k, v)
            self.send_header("Connection", "close")
            if stream_mode:
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
            else:
                nonstream_content_type = upstream_content_type
                if not nonstream_content_type:
                    nonstream_content_type = "application/json; charset=utf-8"
                elif nonstream_content_type.lower().split(";", 1)[0].strip() == "application/json" and "charset=" not in nonstream_content_type.lower():
                    nonstream_content_type += "; charset=utf-8"
                self.send_header("Content-Type", nonstream_content_type)
            _origin = self._cors_origin()
            if _origin:
                self.send_header("Access-Control-Allow-Origin", _origin)
                self.send_header("Vary", "Origin")
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
                    provider=rec.get("provider") or "local",
                    success=bool(rec.get("success", int(rec.get("status") or 200) < 400)),
                    error=rec.get("error") or "",
                    estimated=bool(rec.get("estimated")),
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


if hasattr(socketserver, "ThreadingUnixStreamServer"):
    class _FastUnixHTTPServer(socketserver.ThreadingUnixStreamServer):  # type: ignore[misc]
        """HTTP over a local Unix-domain socket: no TCP port is bound at all."""

        daemon_threads = True

        def server_bind(self):
            socketserver.UnixStreamServer.server_bind(self)
            self.server_name = "localhost"
            self.server_port = 0
else:
    _FastUnixHTTPServer = None


def listen_address():
    return _BOUND_LISTEN_ADDRESS or (CFG["listen_host"], int(CFG["listen_port"]))


def start_server(*, desktop_managed=False):
    """Bind an HTTP listener without persisting process-specific overrides."""
    global _BOUND_LISTEN_ADDRESS
    sock_path = "" if desktop_managed else str(os.environ.get("HYMNIX_SOCKET") or "").strip()
    if sock_path and _FastUnixHTTPServer is not None:
        parent = os.path.dirname(sock_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        try:
            os.unlink(sock_path)
        except FileNotFoundError:
            pass
        except Exception:
            pass
        srv = _FastUnixHTTPServer(sock_path, Handler)
        _BOUND_LISTEN_ADDRESS = None
        log_event("gateway_start", socket=sock_path, version=VERSION)
    else:
        host = "127.0.0.1" if desktop_managed else (os.environ.get("HYMNIX_LISTEN_HOST") or CFG["listen_host"])
        port = 0 if desktop_managed else int(os.environ.get("HYMNIX_LISTEN_PORT") or CFG["listen_port"])
        srv = _FastHTTPServer((host, port), Handler)
        _BOUND_LISTEN_ADDRESS = srv.server_address[:2]
        log_event("gateway_start", port=srv.server_port, version=VERSION)
    threading.Thread(target=_idle_unloader, daemon=True).start()
    return srv


def main(*, control_dir=None):
    GATEWAY_STOPPING.clear()
    load_recent_history()
    srv = start_server(desktop_managed=bool(control_dir))
    watcher_done = threading.Event()
    try:
        if control_dir:
            ready_path = os.path.join(control_dir, "ready.json")
            temp_path = ready_path + ".tmp"
            with open(temp_path, "w", encoding="utf-8") as handle:
                json.dump({"port": srv.server_port, "version": VERSION}, handle)
            os.replace(temp_path, ready_path)

            def watch_shutdown():
                stop_path = os.path.join(control_dir, "stop")
                while not watcher_done.wait(0.1):
                    if os.path.exists(stop_path) or not os.path.isdir(control_dir):
                        GATEWAY_STOPPING.set()
                        srv.shutdown()
                        return

            threading.Thread(target=watch_shutdown, daemon=True).start()
        if sys.stdout is not None:
            print("Hymnix Gateway v%s listening on %s" % (VERSION, srv.server_address), flush=True)
        srv.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        GATEWAY_STOPPING.set()
        watcher_done.set()
        srv.server_close()
        if TUNNEL_STATE.get("proc") is not None:
            stop_tunnel()
        try:
            _stop_owned_ollama()
        except (OSError, subprocess.TimeoutExpired):
            pass
        log_event("gateway_stop")


if __name__ == "__main__":
    main()
