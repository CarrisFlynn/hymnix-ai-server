# -*- coding: utf-8 -*-
from __future__ import annotations
import json, os, re, threading, time
from hxcore.paths import data_dir, logs_dir, ensure_dir, append_jsonl
MODES=("ask","readonly","auto")
_RULES=[
 ("rm_rf",r"\brm\s+-rf\b","danger","recursive delete"),("del_s",r"\bdel(?:ete)?\b.*(?:/f|/s)","danger","delete files"),("format",r"\bformat(?:\s|$)","danger","format disk"),("mkfs",r"\bmkfs(?:\.|\s|$)","danger","create filesystem"),("shutdown",r"\bshutdown\b","danger","shutdown system"),("taskkill",r"\btaskkill\b","danger","kill process"),("reg_delete",r"\breg\s+delete\b","danger","delete registry"),("bcdedit",r"\bbcdedit\b","danger","edit boot configuration"),("diskpart",r"\bdiskpart\b","danger","partition disk"),("git_force",r"\bgit\s+push\b.*--force(?:-with-lease)?","danger","force push"),("git_reset",r"\bgit\s+reset\s+--hard\b","danger","hard reset"),("pip_install",r"\bpip(?:3)?\s+install\b","danger","package install"),("npm_install",r"\bnpm\s+install\b","danger","package install"),("pip_global",r"\bpip(?:3)?\s+install\b.*(?:-g|--global)","danger","global package install"),("npm_global",r"\bnpm\s+install\b.*(?:-g|--global)","danger","global package install"),("pipe_sh",r"\bcurl\b[^|]*\|\s*(?:sh|bash)\b","danger","remote script execution"),("redirect",r"(?:>>|(?<![<>])>(?![>]))","danger","redirect writes files"),("chmod",r"\bchmod\s+777\b","danger","world writable permissions"),("delete_logs",r"\b(?:rm|del|rmdir)\b[^\n]*(?:logs|backup)","danger","delete logs or backups")]
_READ=[r"^\s*(?:ls|dir|cat|type|git\s+status|python(?:\s+-c)?|echo)(?:\s|$)",r"^\s*config\s+get(?:\s|$)"]
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
  with open(p,"w",encoding="utf-8") as f: json.dump(cfg,f,ensure_ascii=False,indent=2)
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
