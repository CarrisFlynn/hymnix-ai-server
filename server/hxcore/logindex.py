# -*- coding: utf-8 -*-
"""Resilient local SQLite event index for Hymnix."""
from __future__ import annotations
import atexit, json, os, queue, sqlite3, threading, time
try:
    from hxcore.paths import logs_dir, ensure_dir
except Exception:
    def logs_dir(): return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "logs")
    def ensure_dir(path): os.makedirs(path, exist_ok=True); return path
_Q=queue.Queue(); _STOP=object(); _FAILED=object(); _LOCK=threading.RLock(); _THREAD=None; _READY=False; _FTS=False; _DB=""
def _error(exc):
    try:
        p=os.path.join(logs_dir(),"index","error.log"); ensure_dir(os.path.dirname(p))
        with open(p,"a",encoding="utf-8") as f: f.write(time.strftime("%Y-%m-%d %H:%M:%S")+" "+repr(exc)+"\n")
    except Exception: pass
def _connect():
    global _DB,_FTS
    if not _DB: _DB=os.path.join(logs_dir(),"index","hymnix.db")
    ensure_dir(os.path.dirname(_DB)); c=sqlite3.connect(_DB,timeout=30)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, ts REAL, iso TEXT, source TEXT, kind TEXT, text TEXT, payload TEXT, day TEXT)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)"); c.execute("CREATE INDEX IF NOT EXISTS idx_events_source_kind ON events(source,kind)")
    _FTS=False
    if not os.environ.get("HX_INDEX_NO_FTS"):
        try:
            c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(text, content='events', content_rowid='id')")
            c.execute("CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN INSERT INTO events_fts(rowid,text) VALUES (new.id,new.text); END")
            c.execute("CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN INSERT INTO events_fts(events_fts,rowid,text) VALUES ('delete',old.id,old.text); END")
            _FTS=True
        except Exception: _FTS=False
    c.commit(); return c
def _worker():
    try:
        c=_connect()
    except Exception as e:
        _error(e); _Q.put(_FAILED); return
    while True:
        item=_Q.get()
        if item is _STOP: _Q.task_done(); break
        if item is _FAILED: _Q.task_done(); continue
        try: c.execute("INSERT INTO events(ts,iso,source,kind,text,payload,day) VALUES (?,?,?,?,?,?,?)",item); c.commit()
        except Exception as e: _error(e); c.rollback()
        finally: _Q.task_done()
    try:c.close()
    except Exception:pass
def _start():
    global _THREAD,_READY
    with _LOCK:
        if not _READY: _READY=True; _THREAD=threading.Thread(target=_worker,name="hymnix-logindex",daemon=True); _THREAD.start()
def record(source: str,kind: str,payload: dict|str)->None:
    try:
        _start(); ts=time.time(); text=payload if isinstance(payload,str) else json.dumps(payload,ensure_ascii=False,sort_keys=True); raw=payload if isinstance(payload,str) else json.dumps(payload,ensure_ascii=False)
        _Q.put_nowait((ts,time.strftime("%Y-%m-%dT%H:%M:%S",time.localtime(ts)),str(source),str(kind),str(text),raw,time.strftime("%Y-%m-%d",time.localtime(ts))))
    except Exception as e:_error(e)
def _flush(timeout=5):
    deadline=time.monotonic()+timeout
    try:
        while _Q.unfinished_tasks and time.monotonic()<deadline: time.sleep(.01)
        if _Q.unfinished_tasks: _error(TimeoutError("log index queue flush timed out")); return False
        return True
    except Exception as e:_error(e); return False
def _shutdown():
    try:
        if _THREAD and _THREAD.is_alive() and _flush(): _Q.put(_STOP); _THREAD.join(timeout=5)
    except Exception as e:_error(e)
atexit.register(_shutdown)
def _query(q,source,kind,since,until,limit,order):
    c=_connect(); args=[]; filters=[]; rows=[]
    if source: filters.append("e.source=?"); args.append(source)
    if kind: filters.append("e.kind=?"); args.append(kind)
    if since is not None: filters.append("e.ts>=?"); args.append(float(since))
    if until is not None: filters.append("e.ts<=?"); args.append(float(until))
    asc="ASC" if str(order).lower()=="asc" else "DESC"; cap=max(1,min(int(limit),10000))
    if q and _FTS and "%" not in str(q) and "_" not in str(q):
        phrase='"'+str(q).replace('"','""')+'"'
        sql="SELECT e.id,e.ts,e.iso,e.source,e.kind,e.text,e.payload FROM events_fts f JOIN events e ON e.id=f.rowid WHERE events_fts MATCH ?"; args=[phrase]+args
        if filters: sql+=" AND "+" AND ".join(filters)
    else:
        if q:
            escaped=str(q).replace(chr(92), chr(92)+chr(92)).replace("%", chr(92)+"%").replace("_", chr(92)+"_")
            filters.insert(0,"e.text LIKE ? ESCAPE '\\'"); args.insert(0,'%'+escaped+'%')
        sql="SELECT e.id,e.ts,e.iso,e.source,e.kind,e.text,e.payload FROM events e"
        if filters: sql+=" WHERE "+" AND ".join(filters)
        sql+=" ORDER BY e.ts "+asc+" LIMIT ?"; args.append(cap)
    try:
        for row in c.execute(sql,args):
            try: payload=json.loads(row[6])
            except Exception:payload=row[6]
            rows.append(dict(zip(("id","ts","iso","source","kind","text","payload"),row[:6]+(payload,))))
    finally:c.close()
    return rows
def search(q: str="",source: str|None=None,kind: str|None=None,since: float|None=None,until: float|None=None,limit: int=100,order: str="desc")->list[dict]:
    try:_flush(); return _query(q,source,kind,since,until,limit,order)
    except Exception as e:_error(e); return []
def stats()->dict:
    try:
        _flush(); c=_connect(); row=c.execute("SELECT COUNT(*),COALESCE(SUM(LENGTH(text)+LENGTH(payload)),0) FROM events").fetchone(); sources={r[0]:r[1] for r in c.execute("SELECT source,COUNT(*) FROM events GROUP BY source")}; c.close(); return {"rows":row[0],"bytes":row[1],"sources":sources,"db":_DB,"index":"fts5" if _FTS else "like"}
    except Exception as e:_error(e); return {"rows":0,"bytes":0,"sources":{},"db":_DB,"index":"fts5" if _FTS else "like"}
def import_jsonl(path: str,source: str|None=None)->int:
    rows=[]
    try:
        with open(path,"r",encoding="utf-8") as f:
            for line in f:
                if not line.strip():continue
                obj=json.loads(line); ts=time.time(); raw=json.dumps(obj,ensure_ascii=False); text=raw if not isinstance(obj,str) else obj
                rows.append((ts,time.strftime("%Y-%m-%dT%H:%M:%S",time.localtime(ts)),source or (obj.get("source") if isinstance(obj,dict) else None) or os.path.basename(path), (obj.get("kind") if isinstance(obj,dict) else None) or "import",text,raw,time.strftime("%Y-%m-%d",time.localtime(ts))))
        if not rows:return 0
        _flush(); c=_connect()
        try:c.executemany("INSERT INTO events(ts,iso,source,kind,text,payload,day) VALUES (?,?,?,?,?,?,?)",rows); c.commit()
        except Exception:c.rollback(); raise
        finally:c.close()
        return len(rows)
    except Exception as e:_error(e); return 0
def prune(days: int=30)->int:
    try:
        _flush(); c=_connect(); cutoff=time.time()-max(0,int(days))*86400; cur=c.execute("DELETE FROM events WHERE ts<?",(cutoff,)); c.commit(); n=cur.rowcount; c.close(); return n
    except Exception as e:_error(e); return 0
