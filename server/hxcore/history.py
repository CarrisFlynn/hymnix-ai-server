# -*- coding: utf-8 -*-
"""UTF-8 chat history queries, paging, backup and portable import/export."""
from __future__ import annotations
import json, re, shutil
from datetime import datetime, timezone
from pathlib import Path
try:
    from hxcore.paths import logs_dir
except Exception:
    logs_dir = lambda: str(Path(__file__).resolve().parents[2] / "logs")

def _files():
    p=Path(logs_dir())
    try:
        return sorted(set(p.glob("events-*.jsonl")) | set((p/"ops").glob("*.jsonl")) | set((p/"chats").glob("*.jsonl")) | set(p.glob("conversations-*.jsonl")))
    except Exception: return []
def _rows():
    for p in _files():
        try:
            with p.open("r",encoding="utf-8-sig",errors="replace") as f:
                for raw in f:
                    try:
                        x=json.loads(raw)
                        if isinstance(x,dict): x["_file"]=p.name; x["_is_ops"]=p.parent.name=="ops"; yield x
                    except Exception: continue
        except Exception: continue
def _ts(x): return str(x.get("timestamp") or x.get("ts") or x.get("t") or x.get("time") or "")
def _epoch(s):
    try:
        d=datetime.fromisoformat(str(s).replace("Z","+00:00")); return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()
    except Exception:return 0.0
def _text(x):
    v=x.get("text",x.get("content",x.get("reply",x.get("message",x.get("summary","")))))
    return json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else str(v or "")
def _sid(x):
    if x.get("_is_ops"): return ""
    for k in ("session_id","session","conversation_id","conversation","client_ip","request_id"):
        if x.get(k): return str(x[k])
    if str(x.get("_file","")).startswith("conversations-"):
        return "gw-%s-%s"%(x["_file"].split("-")[-1].split(".")[0],str(x.get("model") or "unknown"))
    return ""
def _ordered(): return sorted(list(_rows()),key=lambda x:_epoch(_ts(x)))
def sessions(query="",limit=50,offset=0,**_kwargs):
    groups={}
    for x in _ordered():
        sid=_sid(x)
        if sid: groups.setdefault(sid,[]).append(x)
    q=str(query or "").casefold(); out=[]
    for sid,items in groups.items():
        title=next((_text(i) for i in items if str(i.get("role") or "").lower()=="user" and _text(i)),_text(items[0]) or sid)
        if q and q not in (sid+" "+title+" "+" ".join(_text(i) for i in items)).casefold(): continue
        out.append({"id":sid,"title":title[:200],"last_ts":_ts(items[-1]),"first_ts":_ts(items[0]),"count":len(items)})
    out.sort(key=lambda z:_epoch(z["last_ts"]),reverse=True); start=max(0,int(offset)); return out[start:start+max(0,min(int(limit),500))]
def messages(session_id,limit=200,offset=0,query="",**_kwargs):
    q=str(query or "").casefold(); out=[]
    for x in _ordered():
        if _sid(x)!=str(session_id): continue
        text=_text(x)
        if q and q not in text.casefold(): continue
        out.append({"ts":_ts(x),"role":str(x.get("role") or x.get("author") or x.get("kind") or ""),"text":text,"content":text,"model":str(x.get("model") or "")})
    start=max(0,int(offset)); return out[start:start+max(0,min(int(limit),5000))]
def search(q="",limit=50,source=None,offset=0,session_id=None,context=32,**_kwargs):
    needle=str(q or "").casefold(); allrows=_ordered(); out=[]
    for i,x in enumerate(allrows):
        sid=_sid(x); text=_text(x); src=str(x.get("source") or x.get("agent") or x.get("_file") or "")
        if session_id and sid!=str(session_id): continue
        if source and src!=str(source): continue
        score=text.casefold().count(needle) if needle else 1
        if needle and not score: continue
        pos=text.casefold().find(needle) if needle else 0
        lo=max(0,pos-max(0,int(context))); hi=min(len(text),pos+len(needle)+max(0,int(context))) if needle else len(text)
        out.append({"ts":_ts(x),"source":src,"session_id":sid,"text":text,"snippet":text[lo:hi],"highlight":text[lo:pos]+("<mark>"+text[pos:pos+len(needle)]+"</mark>" if needle else "")+text[pos+len(needle):hi] if needle else text[lo:hi],"score":score,"role":str(x.get("role") or "")})
    out.sort(key=lambda z:(_epoch(z["ts"]),z["score"]),reverse=True)
    # Stable deduplication of identical event/session hits.
    seen=set(); unique=[]
    for row in out:
        key=(row["session_id"],row["ts"],row["text"])
        if key not in seen: seen.add(key); unique.append(row)
    start=max(0,int(offset)); return unique[start:start+max(1,min(int(limit),500))]
def stats():
    rows=list(_rows()); ids={_sid(x) for x in rows if _sid(x)}
    return {"sessions":len(ids),"messages":len(rows),"bytes":sum(len(json.dumps(x,ensure_ascii=False).encode("utf-8")) for x in rows),"sources":{}}
def export(rows,path,fmt="json",bom=False):
    rows=list(rows or [])
    if str(fmt).lower() in ("md","markdown"):
        content="\n\n".join("### %s (%s)\n\n%s"%(r.get("role","message"),r.get("ts",""),r.get("text",r.get("content",""))) for r in rows)
    else: content=json.dumps(rows,ensure_ascii=False,indent=2)
    with open(path,"w",encoding="utf-8-sig" if bom else "utf-8",newline="") as f:f.write(content)
    return path
def export_session(session_id,path,fmt="json",bom=False): return export(messages(session_id,limit=5000),path,fmt,bom)
def import_file(path,session_id=None):
    """Import JSON/JSONL/Markdown into a chat JSONL, preserving Unicode."""
    p=Path(path); target=Path(logs_dir())/"chats"/(str(session_id or p.stem)+".jsonl"); target.parent.mkdir(parents=True,exist_ok=True)
    raw=p.read_text(encoding="utf-8-sig"); rows=[]
    try:
        value=json.loads(raw); rows=value if isinstance(value,list) else [value]
    except Exception:
        for line in raw.splitlines():
            if line.strip():
                try: rows.append(json.loads(line))
                except Exception: rows.append({"role":"message","text":line})
    sid=str(session_id or p.stem)
    with target.open("a",encoding="utf-8",newline="") as f:
        for row in rows:
            if not isinstance(row,dict): row={"text":str(row)}
            row=dict(row); row.setdefault("session_id",sid); row.setdefault("ts",datetime.now(timezone.utc).isoformat()); f.write(json.dumps(row,ensure_ascii=False)+"\n")
    return len(rows)
def backup(session_id,path=None):
    rows=messages(session_id,limit=5000); path=path or str(Path(logs_dir())/"backup"/(str(session_id)+".json")); Path(path).parent.mkdir(parents=True,exist_ok=True); export(rows,path,"json"); return path
def rebuild_index():
    """Return current file-derived index; queries never depend on a stale SQLite index."""
    return {"sessions":len(sessions(limit=500)),"messages":len(list(_rows()))}
