# -*- coding: utf-8 -*-
from __future__ import annotations
import json
from datetime import datetime
from pathlib import Path
try:
 from hxcore.paths import logs_dir
except Exception:
 logs_dir=lambda: str(Path(__file__).resolve().parents[2]/"logs")
_MAX=5*1024*1024

def _files():
 try:
  p=Path(logs_dir()); return sorted(p.glob("events-*.jsonl"))+sorted((p/"ops").glob("*.jsonl"))+sorted((p/"chats").glob("*.jsonl"))+sorted(p.glob("conversations-*.jsonl"))
 except Exception:return []
def _rows():
 for p in _files():
  try:
   size=p.stat().st_size
   with p.open("rb") as f:
    if size>_MAX: f.seek(-_MAX,2); f.readline()
    for raw in f:
     try:
      x=json.loads(raw.decode("utf-8")); x["_file"]=p.name; x["_is_ops"]=str(p.parent.name)=="ops"; yield x
     except Exception: continue
  except Exception: continue
def _ts(x): return str(x.get("timestamp") or x.get("ts") or x.get("t") or x.get("time") or "")
def _epoch(s):
 try:return datetime.fromisoformat(str(s).replace("Z","+00:00")).timestamp()
 except Exception:return 0.0
def _text(x):
 v=x.get("text",x.get("content",x.get("reply",x.get("message",x.get("summary","")))))
 if isinstance(v,(dict,list)):v=json.dumps(v,ensure_ascii=False)
 return str(v)[:4000]
def _sid(x):
 if x.get("_is_ops"): return ""
 for k in ("session_id","session","conversation_id","conversation","client_ip","request_id"):
  if x.get(k): return str(x[k])
 if str(x.get("_file","")).startswith("conversations-"):
  day=str(x.get("_file").split("-")[-1].split(".")[0]); model=str(x.get("model") or "unknown")
  return "gw-%s-%s"%(day,model)
 return ""
def sessions(query="",limit=50):
 try:
  d={}
  for x in _rows():
   sid=_sid(x)
   if not sid:continue
   d.setdefault(sid,[]).append(x)
  out=[]
  for sid,items in d.items():
   items.sort(key=lambda z:_epoch(_ts(z)),reverse=True); title=_text(items[-1]) or sid
   if query and query.lower() not in (sid+" "+title).lower():continue
   out.append({"id":sid,"title":title[:200],"last_ts":_ts(items[0]),"count":len(items)})
  out.sort(key=lambda z:_epoch(z["last_ts"]),reverse=True); return out[:min(max(int(limit),1),500)]
 except Exception:return []
def messages(session_id,limit=200):
 try:
  out=[{"ts":_ts(x),"role":str(x.get("role") or x.get("author") or x.get("kind") or ""),"text":_text(x)} for x in _rows() if _sid(x)==str(session_id)]
  out.sort(key=lambda z:_epoch(z["ts"]),reverse=True); return out[:min(max(int(limit),1),500)]
 except Exception:return []
def search(q="",limit=50,source=None):
 try:
  q=str(q).lower(); out=[]
  for x in _rows():
   src=str(x.get("source") or x.get("agent") or x.get("_file") or ""); text=_text(x)
   if source and src!=str(source):continue
   score=text.lower().count(q) if q else 1
   if q and not score:continue
   out.append({"ts":_ts(x),"source":src,"text":text,"score":score})
  out.sort(key=lambda z:(_epoch(z["ts"]),z["score"]),reverse=True); return out[:min(max(int(limit),1),500)]
 except Exception:return []
def stats():
 try:
  rows=list(_rows()); ids={_sid(x) for x in rows if _sid(x)}; sources={}
  for x in rows:
   s=str(x.get("source") or x.get("agent") or x.get("_file") or ""); sources[s]=sources.get(s,0)+1
  return {"sessions":len(ids),"messages":len(rows),"bytes":sum(len(json.dumps(x,ensure_ascii=False).encode()) for x in rows),"sources":sources}
 except Exception:return {"sessions":0,"messages":0,"bytes":0,"sources":{}}
