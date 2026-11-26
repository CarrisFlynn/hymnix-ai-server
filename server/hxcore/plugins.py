# -*- coding: utf-8 -*-
from __future__ import annotations
import ast
import inspect, builtins, hashlib, json, os, re, shutil, sys, time, traceback, threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from hxcore.paths import plugins_dir, ensure_dir, read_json, atomic_write_json, root_dir, logs_dir
PLUGIN_API = "1"
MANIFEST_SCHEMA_VERSION = 1
_CAPABILITIES = {"tool", "command", "page", "hook"}
_ALLOWED = {"fs.read","fs.write","net.http","ui.toast","tools.register","log.write"}
_ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9._-]{2,63}\Z")
_MANIFEST_LIMIT = 64 * 1024
_SAFE = {k:getattr(builtins,k) for k in ("abs","all","any","bool","bytes","dict","enumerate","Exception","float","int","isinstance","len","list","map","max","min","range","repr","round","set","sorted","str","sum","tuple","zip","ValueError","RuntimeError","KeyError")}
_IMPORTS = {"math","time","datetime","json","re","statistics","collections","itertools","functools","decimal","random"}
_LOCK=threading.RLock(); _PERMISSIONS_LOCK=threading.RLock(); _LOADED={}; _ERRORS=[]
_EXECUTOR=ThreadPoolExecutor(max_workers=4, thread_name_prefix="hymnix-plugin")
_TIMEOUT=float(os.environ.get("HX_PLUGIN_TIMEOUT", "3"))
# Attribute names a plugin has no business touching: they are the documented way
# out of an exec() sandbox (walk __subclasses__ and reach the host interpreter).
# Module handles reachable through an allowlisted module would hand back the real
# os/sys objects: random._os is os, so one attribute access escaped the sandbox.
_MODULE_ATTRS={"_os","_sys","os","sys","_io","io","_builtins","builtins","_warnings","_imp","_thread","_signal","_ctypes","ctypes","_collections_abc","_frozen_importlib","_frozen_importlib_external","importlib","posixpath","ntpath","subprocess","_random","_socket"}
def _call_handler(handler, args):
    """Call a plugin handler with args when its signature accepts one.

    Only the signature decides the calling convention. An exception raised inside
    the handler must propagate: retrying without arguments would run its side
    effects twice.
    """
    try:
        parameters = inspect.signature(handler).parameters
    except (TypeError, ValueError):
        return handler()
    return handler(args) if len(parameters) >= 1 else handler()


_FORBIDDEN_ATTRS={"__class__","__base__","__bases__","__subclasses__","__mro__","__globals__","__builtins__","__code__","__closure__","__dict__","__getattribute__","__import__","__loader__","__spec__","__reduce__","__reduce_ex__",
 # Exception and frame introspection: an exception raised by the host used to
 # hand a plugin the host's __builtins__ through tb_frame.f_globals.
 "mro","__mro_entries__","__subclasshook__","__traceback__","tb_frame","tb_next","tb_lasti","tb_lineno","tb_lasti",
 "f_back","f_globals","f_locals","f_builtins","f_code",
 "gi_frame","gi_code","cr_frame","cr_code","ag_frame","ag_code"}
class _PluginTimeout(BaseException):
    """Raised inside plugin frames so a plugin cannot swallow its own deadline."""
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
    row={"id":pid,"where":where,"error":str(e),"ts":time.time()}
    with _LOCK: _ERRORS.append(row); del _ERRORS[:-200]
    try:
        target=os.path.join(logs_dir(), "plugin-errors.jsonl"); ensure_dir(os.path.dirname(target))
        with open(target,"a",encoding="utf-8") as fh: fh.write(json.dumps(row,ensure_ascii=False)+"\\n")
    except Exception: pass
def plugins_root():
    try: p=os.path.abspath(plugins_dir()); ensure_dir(p); _examples(p); return p
    except Exception as e: _err("","root",e); return os.path.abspath("plugins")
def _examples(root):
    data={"hello-world":({"schema_version":1,"id":"hello-world","name":"Hello World","version":"1.0.0","author":"Hymnix","apiVersion":"1","entry":"main.py","capabilities":["hook"],"permissions": ["ui.toast"],"description":"A minimal greeting plugin."},"""def on_load(api):
    api["toast"]("Hello from Hymnix")
"""),"clock-tools":({"schema_version":1,"id":"clock-tools","name":"Clock Tools","version":"1.0.0","author":"Hymnix","apiVersion":"1","entry":"main.py","capabilities":["tool"],"permissions": ["tools.register"],"description":"Registers a world clock tool."},"""def on_load(api):
    api["register_tool"]("world_clock", lambda args: {"utc": "available through host adapter"})
""" )}
    state_path=os.path.join(root,"state.json")
    state=read_json(state_path,{})
    if not isinstance(state,dict): state={}
    changed=False
    for pid,(m,src) in data.items():
        d=os.path.join(root,pid); ensure_dir(d); mp=os.path.join(d,"plugin.json"); ep=os.path.join(d,"main.py")
        if not os.path.exists(mp): atomic_write_json(mp,m)
        if not os.path.exists(ep):
            try:
                with open(ep,"w",encoding="utf-8") as f:f.write(src)
            except Exception as e:_err(pid,"example",e)
        prior=state.get(pid)
        needs_source=pid not in state or isinstance(prior,bool) or (isinstance(prior,dict) and "source" not in prior)
        if needs_source:
            try:
                with open(ep,"r",encoding="utf-8") as f: matches_entry=f.read()==src
                if matches_entry and read_json(mp,None)==m:
                    with open(mp,"rb") as f: digest=hashlib.sha256(f.read()).hexdigest()
                    metadata=dict(prior) if isinstance(prior,dict) else {"enabled":prior if isinstance(prior,bool) else False}
                    metadata["source"]="bundled"
                    metadata.setdefault("installed_at",time.strftime("%Y-%m-%dT%H:%M:%S%z"))
                    metadata.setdefault("manifest_sha256",digest)
                    state[pid]=metadata
                    changed=True
            except OSError as e:_err(pid,"example",e)
    if changed and not atomic_write_json(state_path,state):
        _err("","example","state_write_failed")
def _within(root, path):
    try:
        base = os.path.normcase(os.path.realpath(root))
        target = os.path.normcase(os.path.realpath(path))
        return os.path.commonpath((base, target)) == base
    except (ValueError, OSError):
        return False


def validate_manifest(folder):
    """Return (manifest, errors), where errors is a list of stable error codes.

    fs.read does not provide open() to plugin code. Any future fs.read host adapter
    must restrict resolved targets to plugins_root() or HYMNIX_DATA_DIR and check
    the target again for each read. A permission label alone grants no file access.
    """
    base = os.path.realpath(os.path.abspath(os.fspath(folder)))
    manifest_path = os.path.join(base, "plugin.json")
    if not os.path.isfile(manifest_path):
        return None, ["bad_manifest"]
    if not _within(base, manifest_path):
        return None, ["symlink_escape"]
    try:
        if os.path.getsize(manifest_path) > _MANIFEST_LIMIT:
            return None, ["bad_manifest"]
        with open(manifest_path, "rb") as stream:
            raw = stream.read(_MANIFEST_LIMIT + 1)
        if len(raw) > _MANIFEST_LIMIT:
            return None, ["bad_manifest"]
        manifest = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeError, ValueError):
        return None, ["bad_manifest"]
    if not isinstance(manifest, dict):
        return None, ["bad_manifest"]
    errors = []
    required = ("id", "name", "version", "entry", "permissions")
    if any(key not in manifest for key in required):
        errors.append("bad_manifest")
    pid = manifest.get("id")
    if not isinstance(pid, str) or not _ID_PATTERN.fullmatch(pid):
        if "bad_manifest" not in errors: errors.append("bad_manifest")
    for key in ("name", "version"):
        value = manifest.get(key)
        if not isinstance(value, str) or not value.strip():
            if "bad_manifest" not in errors: errors.append("bad_manifest")
    if manifest.get("apiVersion", PLUGIN_API) != PLUGIN_API or manifest.get("schema_version", MANIFEST_SCHEMA_VERSION) != MANIFEST_SCHEMA_VERSION:
        if "bad_manifest" not in errors: errors.append("bad_manifest")
    if "schema_version" not in manifest or "capabilities" not in manifest:
        manifest["legacy"] = True
        manifest.setdefault("schema_version", MANIFEST_SCHEMA_VERSION)
        perms = manifest.get("permissions")
        manifest.setdefault("capabilities", ["tool"] if isinstance(perms, list) and "tools.register" in perms else ["hook"])
    caps = manifest.get("capabilities")
    if not isinstance(caps, list) or not caps or any(not isinstance(cap, str) or cap not in _CAPABILITIES for cap in caps):
        if "bad_manifest" not in errors: errors.append("bad_manifest")
    permissions = manifest.get("permissions")
    if not isinstance(permissions, list) or any(not isinstance(perm, str) for perm in permissions):
        if "bad_manifest" not in errors: errors.append("bad_manifest")
    elif any(perm not in _ALLOWED for perm in permissions):
        errors.append("unknown_permission")
    entry = manifest.get("entry")
    if isinstance(entry, str) and ".." in entry:
        errors.append("path_escape")
    elif not isinstance(entry, str) or not entry or not entry.lower().endswith(".py") or os.path.isabs(entry) or bool(re.match(r"^[a-zA-Z]:", entry)) or chr(92) in entry:
        errors.append("unsafe_entry")
    else:
        parts = entry.split("/")
        if any(part in ("", ".") for part in parts):
            errors.append("unsafe_entry")
        else:
            candidate = os.path.join(base, *parts)
            if not _within(base, candidate):
                errors.append("symlink_escape")
            elif not os.path.isfile(candidate):
                errors.append("unsafe_entry")
    return manifest, errors


def _manifest(folder):
    manifest, errors = validate_manifest(folder)
    if not errors:
        return manifest, ""
    return None, errors[0]


def _source_is_trusted(source, trusted=False):
    if trusted or _within(plugins_root(), source):
        return True
    for directory in os.environ.get("HYMNIX_TRUSTED_PLUGIN_DIRS", "").split(os.pathsep):
        if directory and os.path.isabs(directory) and _within(directory, source):
            return True
    return False


def _check_tree(folder):
    base = os.path.realpath(folder)
    for current, dirs, files in os.walk(folder, followlinks=False):
        for name in dirs + files:
            if not _within(base, os.path.join(current, name)):
                return "symlink_escape"
    return ""

def _state():
    x=read_json(os.path.join(plugins_root(),"state.json"),{}); return x if isinstance(x,dict) else {}
def is_enabled(pid):
    try:
        value=_state().get(pid,False)
        return bool(value.get("enabled",False) if isinstance(value,dict) else value) and _manifest_permissions_granted(pid)
    except Exception as e:_err(pid,"enabled",e);return False
def set_enabled(pid,on):
    try:
        if on and not _manifest_permissions_granted(pid):return False
        s=_state(); value=s.get(pid,False)
        if isinstance(value,dict): value["enabled"]=bool(on)
        else: value=bool(on)
        s[pid]=value
        return atomic_write_json(os.path.join(plugins_root(),"state.json"),s)
    except Exception as e:_err(pid,"set_enabled",e);return False
def discover():
    rows=[]
    try:
        root=plugins_root(); state=_state()
        for name in sorted(os.listdir(root)):
            folder=os.path.join(root,name)
            if not os.path.isdir(folder) or os.path.islink(folder) or name.startswith("."):continue
            m,err=_manifest(folder); pid=m.get("id",name) if m else name
            if not err and pid != name: err="bad_manifest"
            metadata=state.get(pid,False)
            metadata=metadata if isinstance(metadata,dict) else {"enabled":bool(metadata)}
            digest=metadata.get("manifest_sha256","")
            if digest:
                try:
                    with open(os.path.join(folder,"plugin.json"),"rb") as stream:
                        if hashlib.sha256(stream.read()).hexdigest()!=digest: err="bad_manifest"
                except OSError: err="bad_manifest"
            rows.append({"id":pid,"name":m.get("name",name) if m else name,"version":m.get("version","") if m else "","apiVersion":m.get("apiVersion","") if m else "","description":m.get("description","") if m else "","permissions":m.get("permissions",[]) if m else [],"capabilities":m.get("capabilities",[]) if m else [],"author":m.get("author","") if m else "","legacy":bool(m.get("legacy",False)) if m else False,"enabled":bool(metadata.get("enabled",False)),"path":folder,"error":err,"loaded":pid in _LOADED,"source":metadata.get("source","unknown"),"manifest_sha256":digest,"installed_at":metadata.get("installed_at")})
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
        if row["error"]:_err(pid,"manifest",row["error"]);return {"ok":False,"error":row["error"]}
        m,err=_manifest(row["path"])
        if err:_err(pid,"manifest",err);return {"ok":False,"error":err}
        missing=sorted(set(m["permissions"])-set(granted(pid)))
        if missing:
            reason="permission_not_granted:"+",".join(missing)
            _err(pid,"permission",reason)
            return {"ok":False,"error":"permission_not_granted","detail":reason}
        if not is_enabled(pid):return {"ok":False,"error":"plugin_disabled"}
        path=os.path.realpath(os.path.join(row["path"],m["entry"]))
        with open(path,encoding="utf-8") as f:source=f.read()
        tree=ast.parse(source, path)
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and (node.attr in _FORBIDDEN_ATTRS or node.attr in _MODULE_ATTRS):
                _err(pid,"load","plugin_sandbox_escape:"+node.attr)
                return {"ok":False,"error":"plugin_sandbox_escape","detail":node.attr}
            if isinstance(node, ast.Name) and node.id in {"__builtins__","eval","exec","compile","globals","locals","vars","breakpoint","type","object","getattr","setattr","delattr"}:
                _err(pid,"load","plugin_sandbox_escape:"+node.id)
                return {"ok":False,"error":"plugin_sandbox_escape","detail":node.id}
            if isinstance(node, ast.Attribute) and node.attr in _FORBIDDEN_ATTRS:
                _err(pid,"load","plugin_sandbox_escape:"+node.attr)
                return {"ok":False,"error":"plugin_sandbox_escape","detail":node.attr}
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
            if not tools.register(full_name,"Plugin tool "+full_name,{"type":"object","properties":{}},lambda args:_call_handler(handler, args)):raise RuntimeError("tool registration failed")
            registrations.append(full_name)
            return full_name
        def register_command(name,handler):
            if "command" not in m["capabilities"] or not callable(handler): raise PermissionError("command capability required")
            registrations.append(pid+".command."+str(name)); return registrations[-1]
        def register_page(name,handler):
            if "page" not in m["capabilities"] or not callable(handler): raise PermissionError("page capability required")
            registrations.append(pid+".page."+str(name)); return registrations[-1]
        def register_hook(name,handler):
            if "hook" not in m["capabilities"] or name not in ("on_start","on_message","on_shutdown") or not callable(handler): raise PermissionError("hook capability required")
            registrations.append(pid+".hook."+name); return registrations[-1]
        def run_plugin():
            # A thread cannot be killed from outside, so the deadline is enforced
            # from inside: the trace hook runs between plugin lines and raises once
            # the budget is gone, which actually stops the plugin instead of merely
            # abandoning the wait for it.
            deadline=time.monotonic()+_TIMEOUT
            def watchdog(frame,event,arg):
                if time.monotonic()>deadline: raise _PluginTimeout()
                return watchdog
            sys.settrace(watchdog)
            try:
                exec(code,ns,ns); hook=ns.get("on_load")
                api={"toast":toast,"register_tool":register_tool,"register_command":register_command,"register_page":register_page,"register_hook":register_hook}
                if callable(hook):hook(api)
                for name in ("on_start","on_message","on_shutdown"):
                    if callable(ns.get(name)) and "hook" in m["capabilities"]: register_hook(name,ns[name])
            finally:
                sys.settrace(None)
        future=_EXECUTOR.submit(run_plugin)
        try: future.result(timeout=_TIMEOUT)
        except FutureTimeoutError:
            _err(pid,"load","plugin_timeout")
            return {"ok":False,"error":"plugin_timeout"}
        except _PluginTimeout:
            _err(pid,"load","plugin_timeout")
            return {"ok":False,"error":"plugin_timeout"}
        _LOADED[pid]={"path":path,"namespace":ns,"tools":registrations};return {"ok":True,"error":""}
    except BaseException as e:_err(pid,"load",traceback.format_exc());return {"ok":False,"error":str(e)}
def reload(pid):
    unload(pid)
    return load(pid)

def unload(pid):
    try:
        item=_LOADED.pop(pid,None)
        if not item:return False
        from hxcore import tools
        for name in item.get("tools",[]):tools._REGISTRY.pop(name,None)
        return True
    except Exception as e:_err(pid,"unload",e);return False
def install_from_folder(path, trusted=False):
    """Only install a local folder. trusted=True asserts caller provenance, not a signature."""
    try:
        if not isinstance(path, (str, os.PathLike)) or str(path).lower().startswith(("http://", "https://", "ftp://", "file://")):
            return {"ok":False,"id":"","error":"source_untrusted"}
        original=os.path.abspath(os.fspath(path))
        if not os.path.isdir(original): return {"ok":False,"id":"","error":"bad_manifest"}
        if os.path.islink(original): return {"ok":False,"id":"","error":"source_untrusted"}
        src=os.path.realpath(original)
        manifest,errors=validate_manifest(src)
        if errors: return {"ok":False,"id":manifest.get("id","") if manifest else "","error":errors[0]}
        unsafe=_check_tree(src)
        if unsafe: return {"ok":False,"id":manifest["id"],"error":unsafe}
        root=os.path.realpath(plugins_root())
        dest=os.path.join(root,manifest["id"])
        if os.path.lexists(dest): return {"ok":False,"id":manifest["id"],"error":"plugin_exists"}
        if _within(src,dest): return {"ok":False,"id":manifest["id"],"error":"source_untrusted"}
        with open(os.path.join(src,"plugin.json"),"rb") as stream:
            digest=hashlib.sha256(stream.read()).hexdigest()
        provenance="trusted" if _source_is_trusted(src,trusted) else "unknown"
        shutil.copytree(src,dest,symlinks=True)
        installed,validation=validate_manifest(dest)
        if validation or not _within(root,dest) or _check_tree(dest) or installed["id"]!=manifest["id"]:
            shutil.rmtree(dest)
            return {"ok":False,"id":manifest["id"],"error":validation[0] if validation else "symlink_escape"}
        with open(os.path.join(dest,"plugin.json"),"rb") as stream:
            copied_hash=hashlib.sha256(stream.read()).hexdigest()
        if copied_hash!=digest:
            shutil.rmtree(dest)
            return {"ok":False,"id":manifest["id"],"error":"bad_manifest"}
        state=_state()
        state[manifest["id"]]={"enabled":False,"manifest_sha256":digest,"source":provenance,"installed_at":time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        if not atomic_write_json(os.path.join(root,"state.json"),state):
            shutil.rmtree(dest)
            return {"ok":False,"id":manifest["id"],"error":"state_write_failed"}
        return {"ok":True,"id":manifest["id"],"error":""}
    except Exception as exc:
        _err("","install",exc)
        return {"ok":False,"id":"","error":"bad_manifest"}

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
    old_plugins=os.environ.get("HYMNIX_PLUGINS_DIR")
    old_data=os.environ.get("HYMNIX_DATA_DIR")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["HYMNIX_PLUGINS_DIR"]=os.path.join(tmp,"installed")
            os.environ["HYMNIX_DATA_DIR"]=tmp
            _LOADED.clear(); _ERRORS.clear()
            source=os.path.join(tmp,"source"); os.makedirs(source)
            baseline={"id":"good","name":"Good","version":"1","apiVersion":"1","entry":"main.py","permissions":["net.http"],"description":""}
            def make(manifest, code="def on_load(api): pass\n"):
                with open(os.path.join(source,"plugin.json"),"w",encoding="utf-8") as stream: json.dump(manifest,stream)
                with open(os.path.join(source,"main.py"),"w",encoding="utf-8") as stream: stream.write(code)
            make(baseline)
            assert install_from_folder(source)["ok"]
            assert _state()["good"]["manifest_sha256"]
            assert _state()["good"]["source"]=="unknown"
            assert install_from_folder(source)["error"]=="plugin_exists"
            assert load("good")["error"]=="permission_not_granted"
            assert grant("good","net.http")["ok"]
            assert set_enabled("good",True) and load("good")["ok"] and unload("good")
            assert uninstall("good")
            for bad, expected in (({**baseline,"id":None},"bad_manifest"),({**baseline,"entry":"bad.txt"},"unsafe_entry"),({**baseline,"entry":"../../evil.py"},"path_escape"),({**baseline,"permissions":["root"]},"unknown_permission")):
                make(bad)
                assert install_from_folder(source)["error"]==expected
            make(baseline)
            link=os.path.join(source,"escape.py")
            external=os.path.join(tmp,"evil.py")
            with open(external,"w") as stream: stream.write("pass")
            try:
                os.symlink(external,link)
            except (OSError, NotImplementedError):
                pass
            else:
                assert install_from_folder(source)["error"]=="symlink_escape"
            assert install_from_folder("https://example.com/plugin")["error"]=="source_untrusted"
        return True
    except Exception as exc:
        _err("selftest","run",exc)
        return False
    finally:
        if old_plugins is None: os.environ.pop("HYMNIX_PLUGINS_DIR",None)
        else: os.environ["HYMNIX_PLUGINS_DIR"]=old_plugins
        if old_data is None: os.environ.pop("HYMNIX_DATA_DIR",None)
        else: os.environ["HYMNIX_DATA_DIR"]=old_data


if __name__ == "__main__":
    passed=selftest()
    print("SELFTEST OK" if passed else "SELFTEST FAIL")
    raise SystemExit(0 if passed else 1)

