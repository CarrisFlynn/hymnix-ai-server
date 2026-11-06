# -*- coding: utf-8 -*-
from __future__ import annotations
import ast, builtins, json, os, re, shutil, time, traceback, threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from hxcore.paths import plugins_dir, ensure_dir, read_json, atomic_write_json, root_dir, logs_dir
PLUGIN_API = "1"
_ALLOWED = {"fs.read","fs.write","net.http","ui.toast","tools.register","log.write"}
_SAFE = {k:getattr(builtins,k) for k in ("abs","all","any","bool","bytes","dict","enumerate","Exception","float","int","isinstance","len","list","map","max","min","object","range","repr","round","set","sorted","str","sum","tuple","type","zip","ValueError","RuntimeError","KeyError")}
_IMPORTS = {"math","time","datetime","json","re","statistics","collections","itertools","functools","decimal","random"}
_LOCK=threading.RLock(); _PERMISSIONS_LOCK=threading.RLock(); _LOADED={}; _ERRORS=[]
_EXECUTOR=ThreadPoolExecutor(max_workers=4, thread_name_prefix="hymnix-plugin")
_TIMEOUT=float(os.environ.get("HX_PLUGIN_TIMEOUT", "3"))
_UI_HOOKS={"toast":None}
def set_ui_hooks(toast=None):
    _UI_HOOKS["toast"] = toast if callable(toast) else None
def _permission_path():
    return os.path.join(os.environ.get("HYMNIX_DATA_DIR") or root_dir(), "config", "plugins-permissions.json")
def _permission_data():
    data=read_json(_permission_path(), {})
    return data if isinstance(data, dict) else {}
def granted(plugin_id):
    with _PERMISSIONS_LOCK:
        value=_permission_data().get(plugin_id, [])
        return sorted(set(value)) if isinstance(value, list) else []
def _save_grants(plugin_id, values):
    data=_permission_data(); data[plugin_id]=sorted(set(values))
    return atomic_write_json(_permission_path(), data)
def grant(plugin_id, perm):
    if perm not in _ALLOWED: return {"ok":False}
    with _PERMISSIONS_LOCK:
        values=granted(plugin_id)
        values.append(perm)
        return {"ok":_save_grants(plugin_id, values)}
def revoke(plugin_id, perm):
    with _PERMISSIONS_LOCK:
        values=[x for x in granted(plugin_id) if x != perm]
        return {"ok":_save_grants(plugin_id, values)}
def _manifest_permissions_granted(pid):
    row=next((x for x in discover() if x["id"]==pid), None)
    return bool(row and not row["error"] and set(row["permissions"]).issubset(granted(pid)))
def _err(pid,where,e):
    with _LOCK: _ERRORS.append({"id":pid,"where":where,"error":str(e),"ts":time.time()}); del _ERRORS[:-200]
def plugins_root():
    try: p=os.path.abspath(plugins_dir()); ensure_dir(p); _examples(p); return p
    except Exception as e: _err("","root",e); return os.path.abspath("plugins")
def _examples(root):
    data={"hello-world":({"id":"hello-world","name":"Hello World","version":"1.0.0","apiVersion":"1","entry":"main.py","permissions": ["ui.toast"],"description":"A minimal greeting plugin."},"""def on_load(api):
    api["toast"]("Hello from Hymnix")
"""),"clock-tools":({"id":"clock-tools","name":"Clock Tools","version":"1.0.0","apiVersion":"1","entry":"main.py","permissions": ["tools.register"],"description":"Registers a world clock tool."},"""def on_load(api):
    api["register_tool"]("world_clock", lambda: {"utc": "available through host adapter"})
""" )}
    for pid,(m,src) in data.items():
        d=os.path.join(root,pid); ensure_dir(d); mp=os.path.join(d,"plugin.json"); ep=os.path.join(d,"main.py")
        if not os.path.exists(mp): atomic_write_json(mp,m)
        if not os.path.exists(ep):
            try:
                with open(ep,"w",encoding="utf-8") as f:f.write(src)
            except Exception as e:_err(pid,"example",e)
def _manifest(folder):
    m=read_json(os.path.join(folder,"plugin.json"),None)
    if not isinstance(m,dict): return None,"manifest_missing_or_invalid"
    req=("id","name","version","apiVersion","entry","permissions","description"); miss=[x for x in req if x not in m]
    if miss:return None,"manifest_missing_fields:"+",".join(miss)
    if not isinstance(m["id"],str) or not re.fullmatch(r"[a-z0-9._-]+",m["id"]):return None,"invalid_id"
    if m["apiVersion"]!=PLUGIN_API:return None,"unsupported_api_version"
    base=os.path.realpath(folder); entry=m["entry"] if isinstance(m["entry"],str) else ""; full=os.path.realpath(os.path.join(base,entry))
    if not entry or os.path.commonpath((base,full))!=base or not os.path.isfile(full):return None,"entry_outside_plugin_or_missing"
    if not isinstance(m["permissions"],list):return None,"invalid_permissions"
    unknown=sorted(set(m["permissions"])-_ALLOWED)
    if unknown:return None,"unknown_permissions:"+",".join(unknown)
    return m,""
def _state():
    x=read_json(os.path.join(plugins_root(),"state.json"),{}); return x if isinstance(x,dict) else {}
def is_enabled(pid):
    try:return bool(_state().get(pid,False)) and _manifest_permissions_granted(pid)
    except Exception as e:_err(pid,"enabled",e);return False
def set_enabled(pid,on):
    try:
        if on and not _manifest_permissions_granted(pid):return False
        s=_state();s[pid]=bool(on);return atomic_write_json(os.path.join(plugins_root(),"state.json"),s)
    except Exception as e:_err(pid,"set_enabled",e);return False
def discover():
    rows=[]
    try:
        root=plugins_root(); state=_state()
        for name in sorted(os.listdir(root)):
            folder=os.path.join(root,name)
            if not os.path.isdir(folder) or name.startswith("."):continue
            m,err=_manifest(folder); pid=m.get("id",name) if m else name
            rows.append({"id":pid,"name":m.get("name",name) if m else name,"version":m.get("version","") if m else "","apiVersion":m.get("apiVersion","") if m else "","description":m.get("description","") if m else "","permissions":m.get("permissions",[]) if m else [],"enabled":bool(state.get(pid,False)),"path":folder,"error":err,"loaded":pid in _LOADED})
    except Exception as e:_err("","discover",e)
    return rows
def _imp(perms):
    def importer(name,*args,**kwargs):
        top=name.split(".")[0]; forbidden={"os","subprocess","ctypes","urllib","requests","shutil"}; network={"socket","ssl","http"}
        if top in network and "net.http" not in perms:raise ImportError("module blocked by plugin sandbox: "+top)
        if top in forbidden:raise ImportError("module blocked by plugin sandbox: "+top)
        if top in network and "net.http" in perms:return builtins.__import__(name,*args,**kwargs)
        if top not in _IMPORTS and top not in forbidden:raise ImportError("module not allowlisted: "+top)
        return builtins.__import__(name,*args,**kwargs)
    return importer
def load(pid):
    try:
        row=next((x for x in discover() if x["id"]==pid),None)
        if not row:return {"ok":False,"error":"plugin_not_found"}
        m,err=_manifest(row["path"])
        if err:_err(pid,"manifest",err);return {"ok":False,"error":err}
        if not _manifest_permissions_granted(pid):return {"ok":False,"error":"permission_not_granted"}
        if not is_enabled(pid):return {"ok":False,"error":"plugin_disabled"}
        path=os.path.realpath(os.path.join(row["path"],m["entry"]))
        with open(path,encoding="utf-8") as f:source=f.read()
        tree=ast.parse(source, path)
        code=compile(tree,path,"exec")
        perms=set(m["permissions"]); ns={"__builtins__":dict(_SAFE,__import__=_imp(perms)),"__name__":"__plugin__"}
        if any(isinstance(n, ast.While) and isinstance(n.test, ast.Constant) and n.test.value is True for n in ast.walk(tree)):
            _err(pid,"load","plugin_timeout")
            return {"ok":False,"error":"plugin_timeout"}
        registrations=[]
        def toast(text):
            hook=_UI_HOOKS.get("toast")
            if callable(hook):return hook(str(text))
            target=os.path.join(logs_dir(),"plugins","toast.log");ensure_dir(os.path.dirname(target))
            with open(target,"a",encoding="utf-8") as fh:fh.write(str(text)+"\n")
            return True
        def register_tool(name,handler):
            if "tools.register" not in perms:raise PermissionError("tools.register permission required")
            if not isinstance(name,str) or not re.fullmatch(r"[a-zA-Z0-9_-]+",name) or not callable(handler):raise ValueError("invalid plugin tool")
            from hxcore import tools
            full_name=pid+"."+name
            if not tools.register(full_name,"Plugin tool "+full_name,{"type":"object","properties":{}},lambda args:handler()):raise RuntimeError("tool registration failed")
            registrations.append(full_name)
            return full_name
        def run_plugin():
            exec(code,ns,ns); hook=ns.get("on_load")
            if callable(hook):hook({"toast":toast,"register_tool":register_tool})
        future=_EXECUTOR.submit(run_plugin)
        try: future.result(timeout=_TIMEOUT)
        except FutureTimeoutError:
            _err(pid,"load","plugin_timeout")
            return {"ok":False,"error":"plugin_timeout"}
        _LOADED[pid]={"path":path,"namespace":ns,"tools":registrations};return {"ok":True,"error":""}
    except BaseException as e:_err(pid,"load",traceback.format_exc());return {"ok":False,"error":str(e)}
def unload(pid):
    try:
        item=_LOADED.pop(pid,None)
        if not item:return False
        from hxcore import tools
        for name in item.get("tools",[]):tools._REGISTRY.pop(name,None)
        return True
    except Exception as e:_err(pid,"unload",e);return False
def install_from_folder(path):
    try:
        src=os.path.realpath(os.path.abspath(path));m,err=_manifest(src)
        if err:return {"ok":False,"id":"","error":err}
        dest=os.path.join(plugins_root(),m["id"])
        if os.path.exists(dest):return {"ok":False,"id":m["id"],"error":"plugin_exists"}
        shutil.copytree(src,dest);return {"ok":True,"id":m["id"],"error":""}
    except Exception as e:_err("","install",e);return {"ok":False,"id":"","error":str(e)}
def uninstall(pid):
    try:
        unload(pid);root=os.path.realpath(plugins_root());folder=os.path.realpath(os.path.join(root,pid))
        if os.path.commonpath((root,folder))!=root or not os.path.isdir(folder):return False
        trash=os.path.join(root,".trash");ensure_dir(trash);os.replace(folder,os.path.join(trash,time.strftime("%Y%m%d-%H%M%S-")+pid));s=_state();s.pop(pid,None);atomic_write_json(os.path.join(root,"state.json"),s);return True
    except Exception as e:_err(pid,"uninstall",e);return False
def status():
    rows=discover();return {"root":plugins_root(),"count":len(rows),"enabled":sum(x["enabled"] for x in rows),"loaded":len(_LOADED),"errors":list(_ERRORS)}
def load_enabled():
    out=[]
    for x in discover():
        if x["enabled"] and load(x["id"])["ok"]:out.append(x["id"])
    return out
def selftest():
    import tempfile
    old=os.environ.get("HYMNIX_PLUGINS_DIR")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["HYMNIX_PLUGINS_DIR"]=tmp;_LOADED.clear();_ERRORS.clear();r=plugins_root()
            for pid,body in (("bad",{"id":"bad"}),("sock",{"id":"sock","name":"s","version":"1","apiVersion":"1","entry":"main.py","permissions":[],"description":""}),("boom",{"id":"boom","name":"b","version":"1","apiVersion":"1","entry":"main.py","permissions":[],"description":""})):
                d=os.path.join(r,pid);ensure_dir(d)
                with open(os.path.join(d,"plugin.json"),"w") as f:json.dump(body,f)
                if pid!="bad":
                    with open(os.path.join(d,"main.py"),"w") as f:f.write("import socket\n" if pid=="sock" else "raise RuntimeError('expected plugin failure')\n")
            assert next(x for x in discover() if x["id"]=="bad")["error"].startswith("manifest_missing_fields")
            assert set_enabled("sock",True) and not load("sock")["ok"]
            assert set_enabled("boom",True) and not load("boom")["ok"] and any(x["id"]=="boom" for x in status()["errors"])
        return True
    except Exception as e:_err("selftest","run",e);return False
    finally:
        if old is None:os.environ.pop("HYMNIX_PLUGINS_DIR",None)
        else:os.environ["HYMNIX_PLUGINS_DIR"]=old

