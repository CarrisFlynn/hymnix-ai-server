# -*- coding: utf-8 -*-
from __future__ import annotations
import hashlib, json, os, re, threading, time, uuid
from hxcore.paths import data_dir, logs_dir, ensure_dir, append_jsonl
MODES=("ask","readonly","auto")
_RULES=[
 ("rm_rf",r"\brm\s+-rf\b","danger","recursive delete"),("del_s",r"\bdel(?:ete)?\b.*(?:/f|/s)","danger","delete files"),("format",r"\bformat(?:\s|$)","danger","format disk"),("mkfs",r"\bmkfs(?:\.|\s|$)","danger","create filesystem"),("shutdown",r"\bshutdown\b","danger","shutdown system"),("taskkill",r"\btaskkill\b","danger","kill process"),("reg_delete",r"\breg\s+delete\b","danger","delete registry"),("bcdedit",r"\bbcdedit\b","danger","edit boot configuration"),("diskpart",r"\bdiskpart\b","danger","partition disk"),("git_force",r"\bgit\s+push\b.*--force(?:-with-lease)?","danger","force push"),("git_reset",r"\bgit\s+reset\s+--hard\b","danger","hard reset"),("pip_install",r"\bpip(?:3)?\s+install\b","danger","package install"),("npm_install",r"\bnpm\s+install\b","danger","package install"),("pip_global",r"\bpip(?:3)?\s+install\b.*(?:-g|--global)","danger","global package install"),("npm_global",r"\bnpm\s+install\b.*(?:-g|--global)","danger","global package install"),("pipe_sh",r"\bcurl\b[^|]*\|\s*(?:sh|bash)\b","danger","remote script execution"),("redirect",r"(?:>>|(?<![<>])>(?![>]))","danger","redirect writes files"),("chmod",r"\bchmod\s+777\b","danger","world writable permissions"),("delete_logs",r"\b(?:rm|del|rmdir)\b[^\n]*(?:logs|backup)","danger","delete logs or backups")]
_READ=[r"^\s*(?:ls|dir|cat|type|git\s+status|python(?:\s+-c)?|echo)(?:\s|$)",r"^\s*config\s+get(?:\s|$)"]
_RULES += [
 ("rm_rf_variants", r"\brm\s+(?:(?:-[a-z]*r[a-z]*|-R)\s*)*(?:-[a-z]*f[a-z]*\s*)?", "danger", "recursive delete"),
 ("rm_long", r"\brm\b.*--(?:recursive|force|no-preserve-root)", "danger", "recursive delete"),
 ("pipe_shell", r"\b(?:curl|wget|powershell|pwsh)\b[^\n]*\|\s*(?:ba|z|k)?sh\b", "danger", "remote script execution"),
 ("iex_download", r"\b(?:iex|invoke-expression)\b[^\n]*(?:downloadstring|invoke-webrequest|wget|curl)", "danger", "remote script execution"),
]
_SAFE_TOOLS={"time.now","calc","fs.list","fs.read","fs.stat","sysinfo","web.fetch"}
_LOCK=threading.RLock()
def _config_path(): return os.path.join(data_dir(),"config","approvals.json")
def get_mode():
 try:
  cfg={}
  p=_config_path()
  if os.path.isfile(p):
   with open(p,encoding="utf-8") as f: cfg=json.load(f)
  mode=cfg.get("mode","ask") if isinstance(cfg,dict) else "ask"
  return mode if mode in MODES else "ask"
 except Exception:return "ask"
def set_mode(mode):
 if mode not in MODES:return {"ok":False,"error":"bad_mode"}
 try:
  p=_config_path()
  if os.path.isfile(p):
   with open(p,encoding="utf-8") as f: cfg=json.load(f)
   cfg=cfg if isinstance(cfg,dict) else {}
  else: cfg={}
  cfg["mode"]=mode; ensure_dir(os.path.dirname(p))
  tmp=p+".tmp"
  with open(tmp,"w",encoding="utf-8") as f: json.dump(cfg,f,ensure_ascii=False,indent=2)
  os.replace(tmp,p)
  return {"ok":True,"mode":mode}
 except Exception:return {"ok":False,"error":"write_failed"}
def classify(command):
 text=str(command or "").strip(); reasons=[]; found=[]; risk="safe"
 if not text:return {"risk":"safe","reasons":[],"rule":""}
 tool=re.match(r"^\s*tool:([A-Za-z0-9_.-]+)(?:\s|$)",text,re.I)
 if tool and tool.group(1) in _SAFE_TOOLS:return {"risk":"safe","reasons":[],"rule":"tool_read_only"}
 if tool:return {"risk":"moderate","reasons":["tool requires approval"],"rule":"tool_unknown"}
 for rid,pat,rrisk,note in _RULES:
  try:
   if re.search(pat,text,re.I): found.append((rid,rrisk,note))
  except Exception: continue
 if found:
  risk="danger" if any(x[1]=="danger" for x in found) else "moderate"; reasons=[x[2] for x in found]; rule=found[0][0]
 else:
  safe=any(re.search(p,text,re.I) for p in _READ)
  if not safe:risk="moderate"; reasons=["unknown command"]
  rule="read_only" if safe else "unknown"
 return {"risk":risk,"reasons":reasons,"rule":rule}
def check(command,*,mode=None,origin="terminal"):
 c=classify(command); mode=mode if mode in MODES else get_mode()
 if mode=="auto": decision="allow"
 elif mode=="readonly": decision="allow" if c["risk"]=="safe" else "deny"
 else: decision="allow" if c["risk"]=="safe" else "ask"
 return {"decision":decision,"risk":c["risk"],"reasons":c["reasons"],"mode":mode,"rule":c["rule"]}
def approve_retry(tool, args, origin="tool"):
  """Recheck and record each retry; an ask decision still needs explicit consent."""
  try:
   command="tool:"+str(tool)+" "+json.dumps(args,ensure_ascii=False,default=str)
   decision=check(command,origin=origin)
   record(decision,command)
   return {"ok":decision.get("decision")=="allow","decision":decision}
  except Exception as exc:
   return {"ok":False,"decision":{"decision":"deny","risk":"unknown","reasons":[str(exc)],"mode":get_mode(),"rule":"retry_error"}}



# Pending approvals are process-local: a restart invalidates every grant.
_PENDING_MAX = 256
_PENDING_TTL = 60.0
_PENDING = {}
_SECRET_KEYS = {"api_key", "apikey", "authorization", "password", "secret", "token", "access_token", "refresh_token", "private_key", "admin_key"}

def _canonical_args(args):
    return json.dumps(args if isinstance(args, dict) else {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)

def args_digest(args):
    return hashlib.sha256(_canonical_args(args).encode("utf-8")).hexdigest()

def _redact(value, key=""):
    lowered = key.lower().replace("-", "_")
    if lowered in _SECRET_KEYS or any(part in lowered for part in ("password", "token", "secret", "api_key", "authorization")):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): _redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v, key) for v in value[:64]]
    if isinstance(value, tuple):
        return [_redact(v, key) for v in value[:64]]
    if isinstance(value, str):
        return value[:512]
    return value

def truncated_args(args, limit=512):
    """How much of the argument payload the approver is actually seeing."""
    try:
        raw = json.dumps(args if isinstance(args, dict) else {}, ensure_ascii=False, default=str)
    except Exception:
        return {"truncated": False, "total_chars": 0}
    return {"truncated": len(raw) > limit, "total_chars": len(raw)}


def redacted_args(args):
    return _redact(args if isinstance(args, dict) else {})

def _purge_pending(now=None):
    now = time.time() if now is None else float(now)
    expired = [key for key, row in _PENDING.items() if row.get("expires_at", 0) <= now]
    for key in expired:
        del _PENDING[key]
    if len(_PENDING) > _PENDING_MAX:
        oldest = sorted(_PENDING, key=lambda key: _PENDING[key].get("created_at", 0))[:-_PENDING_MAX]
        for key in oldest:
            del _PENDING[key]

def create_pending(request_id, tool, args, *, decision=None, ttl=_PENDING_TTL):
    """Create a one-shot approval bound to request, tool, and exact args."""
    request_id = str(request_id or "").strip()
    tool = str(tool or "").strip()
    if not request_id or len(request_id) > 128 or not tool or len(tool) > 128:
        return {"ok": False, "error": "invalid_request"}
    try:
        ttl = float(ttl)
    except (TypeError, ValueError):
        ttl = _PENDING_TTL
    ttl = max(1.0, min(ttl, _PENDING_TTL))
    now = time.time()
    digest = args_digest(args)
    with _LOCK:
        _purge_pending(now)
        for row in _PENDING.values():
            if row["request_id"] == request_id and row["tool"] == tool and row["args_digest"] == digest:
                return {"ok": False, "error": "conflict", "approval_id": row["approval_id"]}
        approval_id = uuid.uuid4().hex
        row = {"approval_id": approval_id, "request_id": request_id, "tool": tool,
               "args_digest": digest, "args_redacted": redacted_args(args),
               "created_at": now, "expires_at": now + ttl, "state": "pending",
               "decision": decision if isinstance(decision, dict) else None}
        _PENDING[approval_id] = row
        _purge_pending(now)
        return {"ok": True, **row}

def get_pending(approval_id):
    """Return a redacted pending record, or a stable stale/unknown error."""
    with _LOCK:
        _purge_pending()
        row = _PENDING.get(str(approval_id or ""))
        if not row:
            return {"ok": False, "error": "stale_or_unknown"}
        return {"ok": True, **row}

def consume_pending(approval_id, request_id, tool, args, decision):
    """Atomically consume one approval after identity and policy checks."""
    key = str(approval_id or "")
    request_id = str(request_id or "")
    tool = str(tool or "")
    digest = args_digest(args)
    with _LOCK:
        row = _PENDING.get(key)
        if not row:
            return {"ok": False, "error": "stale_or_replayed"}
        if row["expires_at"] <= time.time():
            del _PENDING[key]
            return {"ok": False, "error": "stale"}
        if row["request_id"] != request_id or row["tool"] != tool or row["args_digest"] != digest:
            return {"ok": False, "error": "conflict"}
        if decision != "allow":
            del _PENDING[key]
            return {"ok": False, "error": "denied", "approval_id": key}
        del _PENDING[key]
        return {"ok": True, "approval_id": key, "request_id": request_id,
                "tool": tool, "args_digest": digest, "state": "consumed"}


def rules():
 return [{"id":i,"pattern":p,"risk":r,"note":n} for i,p,r,n in _RULES]
def record(decision,command):
 try:
  path=os.path.join(logs_dir(),"approvals",time.strftime("%Y%m%d")+".jsonl")
  row={"ts":time.time(),"iso":time.strftime("%Y-%m-%dT%H:%M:%S"),"command":str(command),"decision":decision}
  append_jsonl(path,row)
 except Exception: pass
def recent(limit=50):
 try:
  path=os.path.join(logs_dir(),"approvals",time.strftime("%Y%m%d")+".jsonl")
  with open(path,encoding="utf-8") as f: rows=[json.loads(x) for x in f if x.strip()]
  return rows[-max(0,int(limit)):][::-1]
 except Exception:return []
