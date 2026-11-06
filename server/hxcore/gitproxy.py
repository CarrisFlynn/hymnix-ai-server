"""Safe project-local git proxy and mirror configuration."""
import datetime, os, shutil, subprocess
try:
    from .paths import root_dir, logs_dir
except Exception:
    from hxcore.paths import root_dir, logs_dir

MIRROR_CANDIDATES = (
    ("ghfast", "https://ghfast.top/https://github.com/", "第三方镜像，可能不稳定"),
    ("gh-proxy", "https://gh-proxy.com/https://github.com/", "第三方镜像，可能不稳定"),
    ("ghproxy", "https://ghproxy.net/https://github.com/", "第三方镜像，可能不稳定"),
)

def _log(kind, summary, detail, result, round_tag=None):
    try:
        p = os.path.join(root_dir(), "tools", "logbook.py")
        subprocess.run(["python", p, "--agent", "gateway-scale", "--kind", kind,
                        "--summary", str(summary)[:80], "--detail", str(detail),
                        "--files", "source/hxcore/gitproxy.py", "--result", result,
                        "--round", str(round_tag or os.environ.get("HYMNIX_ROUND") or "R8")], timeout=10, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def _repo():
    return os.path.abspath(os.path.join(root_dir(), ".git"))

def _config():
    return os.path.join(_repo(), "config")

def _run(args):
    try:
        p = subprocess.run(args, cwd=os.path.dirname(_repo()), capture_output=True,
                           text=True, timeout=10, check=False)
        return p.returncode, (p.stdout or "").strip(), (p.stderr or "").strip()
    except Exception as exc:
        return 1, "", str(exc)

def _backup():
    try:
        src = _config()
        if not os.path.isfile(src):
            return ""
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        dst_dir = os.path.join(logs_dir(), "backup", stamp)
        os.makedirs(dst_dir, exist_ok=True)
        dst = os.path.join(dst_dir, "git-config")
        shutil.copy2(src, dst)
        _log("rollback", "备份 git local config", src + " -> " + dst, "ok")
        return dst
    except Exception as exc:
        _log("fail", "git config 备份失败", str(exc), "fail")
        return ""

def status():
    out = {"ok": False, "git": "", "git_version": "", "repo": _repo(), "is_repo": False,
           "proxy": "", "mirror": "", "error": ""}
    try:
        rc, text, err = _run(["git", "--version"])
        out["git"] = "git"; out["git_version"] = text
        if rc:
            out["error"] = err or "git unavailable"; return out
        rc, _, err = _run(["git", "rev-parse", "--is-inside-work-tree"])
        out["is_repo"] = rc == 0
        if not out["is_repo"]:
            out["error"] = err or "not a repository"; return out
        rc, text, err = _run(["git", "config", "--local", "--get", "http.proxy"])
        if rc == 0: out["proxy"] = text
        rc, text, err = _run(["git", "config", "--local", "--get-regexp", r"^url\..*\.insteadOf$"])
        if rc == 0: out["mirror"] = text
        out["ok"] = True
    except Exception as exc:
        out["error"] = str(exc)
    return out

def candidates():
    return [{"name": n, "url": u, "note": note} for n, u, note in MIRROR_CANDIDATES]

def detect_proxy():
    for key in ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"):
        value = os.environ.get(key, "").strip()
        if value:
            return {"ok": True, "http_proxy": os.environ.get("HTTP_PROXY", ""),
                    "https_proxy": os.environ.get("HTTPS_PROXY", value), "from": "env"}
    return {"ok": True, "http_proxy": "", "https_proxy": "", "from": "none"}

def apply_proxy(url, scope="local"):
    out = {"ok": False, "backup": "", "path": _config(), "error": ""}
    if scope != "local": out["error"] = "scope must be local"; return out
    out["backup"] = _backup()
    if not out["backup"] and os.path.isfile(_config()): out["error"] = "backup failed"; return out
    args = ["git", "config", "--local"]
    args += ["--unset", "http.proxy"] if not url else ["http.proxy", str(url)]
    rc, _, err = _run(args); out["ok"] = rc == 0 or (not url and rc == 5)
    if not out["ok"]: out["error"] = err or "git config failed"
    return out

def apply_mirror(old_prefix="https://github.com/", new_prefix="https://ghfast.top/https://github.com/", scope="local"):
    out = {"ok": False, "backup": "", "changed": 0, "error": ""}
    if scope != "local": out["error"] = "scope must be local"; return out
    out["backup"] = _backup()
    if not out["backup"] and os.path.isfile(_config()): out["error"] = "backup failed"; return out
    key = "url.%s.insteadOf" % str(new_prefix)
    rc, _, err = _run(["git", "config", "--local", key, str(old_prefix)])
    out["ok"] = rc == 0; out["changed"] = 1 if rc == 0 else 0
    if not out["ok"]: out["error"] = err or "git config failed"
    return out

def revert(backup_path):
    out = {"ok": False, "error": ""}
    try:
        backup = os.path.abspath(str(backup_path)); backup_root = os.path.abspath(os.path.join(logs_dir(), "backup"))
        if not backup.startswith(backup_root + os.sep) or not os.path.isfile(backup):
            out["error"] = "backup path outside project backup root"; return out
        os.makedirs(os.path.dirname(_config()), exist_ok=True); shutil.copy2(backup, _config()); out["ok"] = True
    except Exception as exc: out["error"] = str(exc)
    return out

def cert_install():
    return {"ok": False, "error": "needs_human", "hint": "安装根证书需要管理员权限，标记 not implemented yet"}

def lfs_status():
    out={"ok":True,"installed":False,"version":"","has_gitattributes":os.path.isfile(os.path.join(root_dir(),'.gitattributes'))}
    try:
        rc,text,err=_run(["git","lfs","version"])
        out["installed"]=rc==0; out["version"]=text if rc==0 else ""; out["ok"]=True
    except Exception: pass
    return out

def lfs_init(scope="local"):
    out={"ok":False,"changed":[],"backup":"","error":""}
    if scope!="local": out["error"]="scope must be local"; return out
    cfg=_config(); attr=os.path.join(root_dir(),'.gitattributes'); existed={cfg:os.path.isfile(cfg),attr:os.path.isfile(attr)}
    try:
        stamp=datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f"); bd=os.path.join(logs_dir(),"backup",stamp); os.makedirs(bd,exist_ok=True)
        for src,present in existed.items():
            if present: shutil.copy2(src,os.path.join(bd,os.path.basename(src)))
        out["backup"]=bd
        try:
            if os.path.isfile(cfg):
                rc,_,err=_run(["git","lfs","install","--local"])
                if rc!=0: raise RuntimeError(err or "git lfs init failed")
                out["changed"].append(".git/config")
            if not os.path.isfile(attr):
                with open(attr,"w",encoding="utf-8") as f:f.write("# Git LFS patterns\n")
                out["changed"].append(".gitattributes")
            out["ok"]=True; _log("rollback","备份 git-lfs 配置",bd,"ok"); return out
        except Exception as exc:
            if existed.get(cfg): shutil.copy2(os.path.join(bd,os.path.basename(cfg)),cfg)
            if existed.get(attr): shutil.copy2(os.path.join(bd,os.path.basename(attr)),attr)
            elif os.path.isfile(attr): os.remove(attr)
            out["error"]=str(exc); out["rolled_back"]=True; return out
    except Exception as exc: out["error"]=str(exc); return out

def shallow_clone(url,dest,depth=1):
    out={"ok":False,"dest":str(dest),"depth":depth,"error":""}
    try:
        d=os.path.abspath(str(dest)); base=os.path.abspath(root_dir())
        if not (d==base or d.startswith(base+os.sep)): out["error"]="out_of_scope"; return out
        n=int(depth)
        if n<1: out["error"]="invalid_depth"; return out
        if os.path.exists(d): out["error"]="dest_exists"; return out
        rc,_,err=_run(["git","clone","--depth",str(n),str(url),d]); out["ok"]=rc==0
        if not out["ok"]: out["error"]=err or "clone_failed"; shutil.rmtree(d,ignore_errors=True)
    except Exception as exc: out["error"]=str(exc); shutil.rmtree(str(dest),ignore_errors=True)
    return out

def cert_plan():
    return {"ok":True,"steps":["检查 openssl 可执行文件","生成 2048 位自签证书与私钥到 logs/certs/","校验 SHA-256 指纹","不安装到系统信任库"],"note":"cert_install 固定返回 needs_human"}

def cert_generate(dir=None):
    out={"ok":False,"cert":"","key":"","fingerprint":"","error":""}
    try:
        target=os.path.abspath(os.path.join(logs_dir(),"certs")); requested=os.path.abspath(str(dir)) if dir else target
        if requested!=target: out["error"]="out_of_scope"; return out
        os.makedirs(target,exist_ok=True); stamp=str(os.getpid())+"-"+datetime.datetime.now().strftime("%H%M%S%f"); cert=os.path.join(target,"hymnix-local.crt"); key=os.path.join(target,"hymnix-local.key"); cert_tmp=cert+"."+stamp+".tmp"; key_tmp=key+"."+stamp+".tmp"
        rc,_,err=_run(["openssl","version"])
        if rc!=0: out["error"]="openssl_unavailable"; return out
        cp=subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-keyout",key_tmp,"-out",cert_tmp,"-days","3650","-nodes","-subj","/CN=Hymnix Local"],cwd=root_dir(),capture_output=True,text=True,timeout=30,check=False)
        if cp.returncode!=0:
            for x in (cert_tmp,key_tmp):
                try:
                    if os.path.exists(x): os.remove(x)
                except Exception: pass
            out["error"]=(cp.stderr or "cert_generation_failed")[:300]; return out
        fp=subprocess.run(["openssl","x509","-in",cert_tmp,"-noout","-fingerprint","-sha256"],capture_output=True,text=True,timeout=10,check=False)
        if fp.returncode!=0:
            for x in (cert_tmp,key_tmp):
                try:
                    if os.path.exists(x): os.remove(x)
                except Exception: pass
            out["error"]="fingerprint_failed"; return out
        os.replace(cert_tmp,cert); os.replace(key_tmp,key); out.update({"ok":True,"cert":cert,"key":key,"fingerprint":(fp.stdout or "").strip()}); return out
    except Exception as exc: out["error"]=str(exc); return out