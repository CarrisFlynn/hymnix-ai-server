# -*- coding: utf-8 -*-
"""Offline-first plugin catalog with validated remote refresh."""
from __future__ import annotations
import datetime, json, os, re, shutil, tempfile, urllib.error, urllib.request, urllib.parse, zipfile
from pathlib import Path
from hxcore.paths import root_dir, logs_dir, read_json, atomic_write_json, ensure_dir

_DEFAULT=[{"id":"builtin","url":"","enabled":True}]
_REQUIRED=("id","name","version","apiVersion","entry","permissions","description","homepage")
_ID=re.compile(r"^[a-z0-9._-]+$")

def _config_path(): return os.path.join(os.environ.get("HYMNIX_DATA_DIR") or root_dir(),"config","plugin-index.json")
def _cache_path(source_id): return os.path.join(logs_dir(),"plugins","index-"+str(source_id)+".json")
def sources():
    try:
        data=read_json(_config_path(),None)
        rows=data.get("sources") if isinstance(data,dict) else None
        if not isinstance(rows,list): return [dict(x) for x in _DEFAULT]
        out=[]
        for row in rows:
            if isinstance(row,dict) and isinstance(row.get("id"),str) and isinstance(row.get("url"),str):
                out.append({"id":row["id"],"url":row["url"],"enabled":bool(row.get("enabled",True))})
        return out or [dict(x) for x in _DEFAULT]
    except Exception: return [dict(x) for x in _DEFAULT]

def _source(source_id=None):
    rows=sources()
    if source_id is not None:return next((x for x in rows if x["id"]==source_id and x["enabled"]),None)
    return next((x for x in rows if x["enabled"] and x["url"]),next((x for x in rows if x["enabled"]),None))

def _valid_plugin(item):
    if not isinstance(item,dict) or any(k not in item for k in _REQUIRED): return False
    if not isinstance(item["id"],str) or not _ID.fullmatch(item["id"]):return False
    if not isinstance(item["name"],str) or not item["name"].strip() or not isinstance(item["version"],str) or not item["version"].strip():return False
    if item["apiVersion"]!="1" or not isinstance(item["entry"],str) or not item["entry"]:return False
    entry=item["entry"]
    if len(entry)>200 or ":" in entry or entry.startswith(("/","\\")):return False
    parts=entry.replace("\\","/").split("/")
    if ".." in parts or any(not part for part in parts):return False
    if not isinstance(item["permissions"],list) or not isinstance(item["description"],str) or not isinstance(item["homepage"],str):return False
    return True

def fetch(source_id=None,timeout=8):
    sid=""
    try:
        src=_source(source_id)
        if not src:return {"ok":False,"source":str(source_id or ""),"count":0,"cached":False,"error":"source_not_found"}
        sid=src["id"]
        if not src["url"]:return {"ok":True,"source":sid,"count":0,"cached":False,"error":"offline"}
        req=urllib.request.Request(src["url"],headers={"User-Agent":"Hymnix-Plugin-Index/1"})
        with urllib.request.urlopen(req,timeout=timeout) as response: raw=response.read(4*1024*1024+1)
        if len(raw)>4*1024*1024:raise ValueError("index_too_large")
        payload=json.loads(raw.decode("utf-8"))
        if not isinstance(payload,dict) or not isinstance(payload.get("plugins"),list):raise ValueError("invalid_index")
        valid=[x for x in payload["plugins"] if _valid_plugin(x)]
        wrapped={"fetched_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"plugins":valid}
        if not atomic_write_json(_cache_path(sid),wrapped):raise OSError("cache_write_failed")
        return {"ok":True,"source":sid,"count":len(valid),"cached":False,"error":""}
    except Exception as exc:
        return {"ok":False,"source":sid or str(source_id or ""),"count":0,"cached":False,"error":str(exc) or type(exc).__name__}

def cached(source_id=None):
    try:
        src=_source(source_id); sid=src["id"] if src else (source_id or "builtin")
        data=read_json(_cache_path(sid),None)
        if not isinstance(data,dict) or not isinstance(data.get("plugins"),list):return {"ok":False,"fetched_at":"","plugins":[],"error":"cache_missing"}
        stamp=data.get("fetched_at",""); result={"ok":True,"fetched_at":stamp,"plugins":[x for x in data["plugins"] if _valid_plugin(x)],"error":""}
        try:
            dt=datetime.datetime.fromisoformat(stamp.replace("Z","+00:00")); result["stale"]=(datetime.datetime.now(datetime.timezone.utc)-dt.astimezone(datetime.timezone.utc)).total_seconds()>86400
        except Exception:result["stale"]=True
        return result
    except Exception as exc:return {"ok":False,"fetched_at":"","plugins":[],"error":str(exc) or type(exc).__name__}

def search(query="",source_id=None):
    try:
        rows=cached(source_id).get("plugins",[]); q=str(query).casefold()
        return [x for x in rows if q in " ".join(str(x.get(k,"")) for k in ("id","name","description")).casefold()]
    except Exception:return []

def install_from_index(plugin_id,source_id=None):
    temp_dir=None
    try:
        item=next((x for x in cached(source_id).get("plugins",[]) if x.get("id")==plugin_id),None)
        if not item:return {"ok":False,"error":"plugin_not_found","path":""}
        url=item.get("download_url",""); scheme=urllib.parse.urlparse(url).scheme
        if not url or scheme not in ("http","https"):return {"ok":False,"error":"no_download_url","path":""}
        from hxcore import plugins
        src=_source(source_id); sid=src["id"] if src else (source_id or "builtin")
        temp_dir=tempfile.mkdtemp(prefix="plugin-index-",dir=ensure_dir(os.path.join(logs_dir(),"tmp")))
        archive=os.path.join(temp_dir,"plugin.zip"); req=urllib.request.Request(url,headers={"User-Agent":"Hymnix-Plugin-Index/1"})
        with urllib.request.urlopen(req,timeout=8) as response,open(archive,"wb") as out:shutil.copyfileobj(response,out,1024*1024)
        unpack=os.path.join(temp_dir,"unpacked");os.makedirs(unpack)
        with zipfile.ZipFile(archive) as zf:
            base=os.path.realpath(unpack)
            for member in zf.infolist():
                target=os.path.realpath(os.path.join(unpack,member.filename))
                if os.path.commonpath((base,target))!=base:raise ValueError("unsafe_archive_path")
            zf.extractall(unpack)
        candidates=[unpack]+[os.path.join(unpack,x) for x in os.listdir(unpack) if os.path.isdir(os.path.join(unpack,x))]
        folder=next((f for f in candidates if isinstance(read_json(os.path.join(f,"plugin.json"),None),dict)),None)
        if not folder:return {"ok":False,"error":"invalid_manifest","path":""}
        manifest=read_json(os.path.join(folder,"plugin.json"),{})
        if not isinstance(manifest,dict) or not _valid_plugin(manifest) or manifest.get("id")!=plugin_id:return {"ok":False,"error":"invalid_entry" if isinstance(manifest,dict) and not isinstance(manifest.get("entry"),str) or isinstance(manifest,dict) and not _valid_plugin(manifest) else "invalid_manifest","path":""}
        checked,err=plugins._manifest(folder)
        if err or not checked or checked.get("id")!=plugin_id:return {"ok":False,"error":"invalid_entry" if err=="entry_outside_plugin_or_missing" else (err or "invalid_manifest"),"path":""}
        result=plugins.install_from_folder(folder)
        return {"ok":bool(result.get("ok")),"error":result.get("error",""),"path":os.path.join(plugins.plugins_root(),plugin_id) if result.get("ok") else ""}
    except Exception as exc:return {"ok":False,"error":str(exc) or type(exc).__name__,"path":""}
    finally:
        if temp_dir:
            try:shutil.rmtree(temp_dir,ignore_errors=True)
            except Exception:pass


def download_plugin(url, dest_dir=None, *, sha256=None, timeout=30):
    """Download a ZIP archive from HTTP(S) or a local file URL."""
    import hashlib
    import urllib.parse
    import urllib.request
    from hxcore.paths import logs_dir
    result = {"ok": False, "path": "", "bytes": 0, "sha256": "", "error": ""}
    if not url:
        result.update(error="needs_source", status="needs_source")
        return result
    partial = ""
    try:
        parsed = urllib.parse.urlparse(os.fspath(url))
        if parsed.scheme not in ("http", "https", "file") or not parsed.path.lower().endswith(".zip"):
            result["error"] = "invalid_source"
            return result
        folder = os.fspath(dest_dir) if dest_dir is not None else os.path.join(logs_dir(), "tmp", "plugin-dl")
        os.makedirs(folder, exist_ok=True)
        name = os.path.basename(urllib.request.url2pathname(parsed.path)) or "plugin.zip"
        if not name.lower().endswith(".zip"):
            result["error"] = "invalid_source"
            return result
        fd, partial = tempfile.mkstemp(prefix=".download-", suffix=".tmp", dir=folder)
        os.close(fd)
        digest = hashlib.sha256()
        total = 0
        request = urllib.request.urlopen(url, timeout=timeout)
        with request, open(partial, "wb") as out:
            while True:
                block = request.read(65536)
                if not block:
                    break
                total += len(block)
                if total > 20 * 1024 * 1024:
                    result["error"] = "too_large"
                    return result
                digest.update(block)
                out.write(block)
        actual = digest.hexdigest()
        if sha256 and actual.lower() != str(sha256).lower():
            result["error"] = "checksum_mismatch"
            return result
        target = os.path.join(folder, name)
        if os.path.exists(target):
            target = os.path.join(folder, digest.hexdigest()[:12] + "-" + name)
        os.replace(partial, target)
        partial = ""
        result.update(ok=True, path=target, bytes=total, sha256=actual, error=None)
        return result
    except Exception as exc:
        result["error"] = str(exc) or type(exc).__name__
        return result
    finally:
        if partial and os.path.exists(partial):
            try:
                os.remove(partial)
            except Exception:
                pass


def install_from_zip(zip_path, *, allow_replace=False):
    """Validate and atomically install a plugin ZIP archive."""
    import time
    import zipfile
    from hxcore import plugins
    from hxcore.paths import plugins_dir, logs_dir
    plugin_id = ""
    backup = ""
    temp = ""
    try:
        with zipfile.ZipFile(os.fspath(zip_path), "r") as archive:
            temp_parent = os.path.join(logs_dir(), "tmp")
            os.makedirs(temp_parent, exist_ok=True)
            base = os.path.realpath(tempfile.mkdtemp(prefix="plugin-install-", dir=temp_parent))
            temp = base
            for member in archive.infolist():
                member_name = member.filename.replace("\\", "/")
                if member_name.startswith("/") or re.match(r"^[A-Za-z]:", member_name) or ".." in member_name.split("/"):
                    return {"ok": False, "plugin_id": "", "installed_to": "", "backup": "", "error": "unsafe_archive_path"}
                target = os.path.realpath(os.path.join(base, member.filename))
                if os.path.commonpath((base, target)) != base:
                    return {"ok": False, "plugin_id": "", "installed_to": "", "backup": "", "error": "unsafe_archive_path"}
            archive.extractall(base)
        candidates = [base] + [os.path.join(base, x) for x in os.listdir(base) if os.path.isdir(os.path.join(base, x))]
        folder = next((d for d in candidates if isinstance(read_json(os.path.join(d, "plugin.json"), None), dict)), "")
        manifest = read_json(os.path.join(folder, "plugin.json"), {}) if folder else {}
        allowed_fields = set(_REQUIRED)
        if isinstance(manifest, dict):
            unknown = sorted(set(manifest) - allowed_fields)
            if unknown:
                return {"ok": False, "plugin_id": str(manifest.get("id") or ""), "installed_to": "", "backup": "", "error": "invalid_manifest", "detail": "unknown field: " + unknown[0]}
        if not isinstance(manifest, dict) or not _valid_plugin(manifest):
            return {"ok": False, "plugin_id": "", "installed_to": "", "backup": "", "error": "invalid_manifest"}
        plugin_id = manifest["id"]
        checked, error = plugins._manifest(folder)
        if error or not checked:
            return {"ok": False, "plugin_id": plugin_id, "installed_to": "", "backup": "", "error": "invalid_manifest"}
        dest_root = os.path.abspath(plugins.plugins_root())
        os.makedirs(dest_root, exist_ok=True)
        destination = os.path.join(dest_root, plugin_id)
        if os.path.exists(destination) and not allow_replace:
            return {"ok": False, "plugin_id": plugin_id, "installed_to": "", "backup": "", "error": "already_installed"}
        if os.path.exists(destination):
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            backup = os.path.join(logs_dir(), "backup", stamp, "plugins", plugin_id)
            os.makedirs(os.path.dirname(backup), exist_ok=True)
            if os.path.exists(backup):
                backup += "-" + str(os.getpid())
            os.replace(destination, backup)
            try:
                repo = root_dir()
                logbook = os.path.join(repo, "tools", "logbook.py")
                if os.path.isfile(logbook):
                    import subprocess, sys
                    completed = subprocess.run([sys.executable, logbook, "--agent", "plugin-kernel", "--kind", "rollback", "--summary", "替换插件前备份旧目录", "--detail", "old=" + destination + "; new=" + destination, "--files", os.path.relpath(destination, repo).replace(os.sep, "/"), "--result", "ok", "--round", "R7"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)
                    if completed.returncode != 0:
                        raise RuntimeError("rollback_log_failed")
            except Exception:
                try:
                    ops_dir = os.path.join(logs_dir(), "ops")
                    os.makedirs(ops_dir, exist_ok=True)
                    with open(os.path.join(ops_dir, "plugin-kernel.jsonl"), "a", encoding="utf-8") as fh:
                        fh.write(json.dumps({"agent": "plugin-kernel", "kind": "rollback", "round": "R7", "detail": "old=" + destination + "; new=" + destination, "plugin_id": plugin_id}, ensure_ascii=False) + "\n")
                except Exception:
                    pass
        staging = destination + ".installing"
        if os.path.exists(staging):
            shutil.rmtree(staging, ignore_errors=True)
        shutil.copytree(folder, staging)
        os.replace(staging, destination)
        return {"ok": True, "plugin_id": plugin_id, "installed_to": destination, "backup": backup, "error": None}
    except Exception as exc:
        return {"ok": False, "plugin_id": plugin_id, "installed_to": "", "backup": backup, "error": str(exc) or type(exc).__name__}
    finally:
        if temp:
            shutil.rmtree(temp, ignore_errors=True)

# not implemented yet: Account login, uploads, publishing, ratings, and reviews are intentionally unsupported.