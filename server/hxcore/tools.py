# -*- coding: utf-8 -*-
"""Schema-checked built-in tools for Hymnix."""
from __future__ import annotations
import ast, datetime, ipaddress, json, math, os, platform, socket, stat, time, urllib.error, urllib.parse, urllib.request
from typing import Any
import http.client
import ssl
from hxcore.paths import root_dir

_resolver = socket.getaddrinfo

_REGISTRY: dict[str, dict] = {}
_DISABLED = False

class ToolError(Exception): pass

def register(name, description, schema, handler, *, danger=False, permission=None) -> bool:
    if not isinstance(name,str) or not name or not callable(handler): return False
    _REGISTRY[name]={"name":name,"description":str(description),"schema":schema if isinstance(schema,dict) else {"type":"object","properties":{}},"danger":bool(danger),"permission":permission,"handler":handler}
    return True

def all_tools() -> list[dict]:
    return [{k:v for k,v in item.items() if k!="handler"} for item in _REGISTRY.values()]

def get(name: str) -> dict | None:
    item=_REGISTRY.get(name)
    return {k:v for k,v in item.items() if k!="handler"} if item else None

def _inside_root(path: str) -> str | None:
    try:
        root=os.path.realpath(root_dir()); target=os.path.realpath(os.path.join(root,path) if not os.path.isabs(path) else path)
        return target if os.path.commonpath((root,target))==root else None
    except Exception: return None

def _validate(schema: dict, args: dict) -> str:
    if not isinstance(args,dict): return "invalid_arguments"
    props=schema.get("properties",{})
    for key in schema.get("required",[]):
        if key not in args: return "missing_required:"+str(key)
    for key,value in args.items():
        spec=props.get(key)
        if spec is None and schema.get("additionalProperties") is not True: return "unexpected_argument:"+str(key)
        if spec is None: continue
        typ=spec.get("type")
        valid={"string":lambda x:isinstance(x,str),"integer":lambda x:isinstance(x,int) and not isinstance(x,bool),"number":lambda x:isinstance(x,(int,float)) and not isinstance(x,bool),"boolean":lambda x:isinstance(x,bool),"object":lambda x:isinstance(x,dict),"array":lambda x:isinstance(x,list)}.get(typ,lambda x:True)
        if not valid(value): return "invalid_type:"+key
        if "enum" in spec and value not in spec["enum"]: return "invalid_enum:"+key
        if isinstance(value,(int,float)) and not isinstance(value,bool):
            if "minimum" in spec and value<spec["minimum"]: return "below_minimum:"+key
            if "maximum" in spec and value>spec["maximum"]: return "above_maximum:"+key
    return ""

def _calc(expression: str):
    if not isinstance(expression,str) or len(expression)>512: raise ToolError("invalid_expression")
    node=ast.parse(expression,mode="eval")
    def ev(n):
        if isinstance(n,ast.Expression): return ev(n.body)
        if isinstance(n,ast.Constant) and isinstance(n.value,(int,float)) and not isinstance(n.value,bool): return n.value
        if isinstance(n,ast.UnaryOp) and type(n.op) in (ast.UAdd,ast.USub): return +ev(n.operand) if isinstance(n.op,ast.UAdd) else -ev(n.operand)
        if isinstance(n,ast.BinOp) and type(n.op) in (ast.Add,ast.Sub,ast.Mult,ast.Div,ast.FloorDiv,ast.Mod,ast.Pow):
            a,b=ev(n.left),ev(n.right)
            if abs(a)>1e100 or abs(b)>1e100: raise ToolError("number_too_large")
            if isinstance(n.op,ast.Pow) and abs(b)>100: raise ToolError("exponent_too_large")
            result={ast.Add:lambda:a+b,ast.Sub:lambda:a-b,ast.Mult:lambda:a*b,ast.Div:lambda:a/b,ast.FloorDiv:lambda:a//b,ast.Mod:lambda:a%b,ast.Pow:lambda:a**b}[type(n.op)]()
            if not math.isfinite(result) or abs(result)>1e100: raise ToolError("result_too_large")
            return result
        raise ToolError("expression_rejected")
    return ev(node)

def _fs_path(args):
    p=_inside_root(args.get("path","."))
    if p is None: raise ToolError("out_of_scope")
    return p

def _fs_list(args):
    p=_fs_path(args)
    if not os.path.isdir(p): raise ToolError("not_a_directory")
    return sorted(os.listdir(p))[:1000]

def _fs_read(args):
    p=_fs_path(args)
    if not os.path.isfile(p): raise ToolError("not_a_file")
    with open(p,"r",encoding="utf-8",errors="replace") as f: return f.read(256*1024)

def _fs_stat(args):
    p=_fs_path(args); s=os.stat(p)
    return {"path":os.path.relpath(p,root_dir()),"size":s.st_size,"mtime":s.st_mtime,"is_file":stat.S_ISREG(s.st_mode),"is_dir":stat.S_ISDIR(s.st_mode)}

def _repo_tree(args):
    try:
        from hxcore import fstree
        if _inside_root(args.get("path", ".")) is None: return {"ok":False,"error":"out_of_scope"}
        result=fstree.tree(args.get("path", "."), args.get("depth", 1), args.get("limit", 500))
        return {"ok":True,"results":result,"count":len(result)}
    except Exception as exc:
        return {"ok":False,"error":str(exc) or type(exc).__name__}

def _repo_search(args):
    try:
        from hxcore import fstree
        if len(args["query"])>200: return {"ok":False,"count":0,"results":[],"error":"query_too_long"}
        if _inside_root(args.get("path", ".")) is None: return {"ok":False,"count":0,"results":[],"error":"out_of_scope"}
        result=fstree.search_text(args["query"], args.get("path", "."), args.get("include"), args.get("limit", 200))
        rows=[]
        for row in result:
            item=dict(row); item["text"]=str(item.get("text", ""))[:300]; rows.append(item)
        return {"ok":True,"count":len(rows),"results":rows}
    except Exception as exc:
        return {"ok":False,"count":0,"results":[],"error":str(exc) or type(exc).__name__}

def _repo_read(args):
    try:
        p=_inside_root(args["path"])
        if p is None: return {"ok":False,"error":"out_of_scope"}
        if not os.path.isfile(p): return {"ok":False,"error":"not_found"}
        start=args.get("start", 1); lines=args.get("lines", 100)
        with open(p,"rb") as raw: data=raw.read(65537)
        if b"\x00" in data: return {"ok":False,"error":"binary_file"}
        text=data.decode("utf-8"); all_lines=text.splitlines()
        selected=all_lines[start-1:start-1+lines]; body="\n".join(selected)
        if len(body.encode("utf-8"))>65536: body=body.encode("utf-8")[:65536].decode("utf-8","ignore")
        return {"ok":True,"path":os.path.relpath(p,root_dir()),"start":start,"end":start+len(selected)-1,"total":len(all_lines),"text":body}
    except UnicodeDecodeError: return {"ok":False,"error":"binary_file"}
    except Exception as exc: return {"ok":False,"error":str(exc) or type(exc).__name__}

def _sysinfo(args):
    return {"platform":platform.platform(),"python":platform.python_version(),"processor":platform.processor(),"cpu_count":os.cpu_count(),"cwd":os.getcwd()}

def _resolve_public(host: str, port: int) -> list[tuple[int, str]]:
    """Resolve once and reject the host if any returned address is non-public."""
    try:
        rows = _resolver(host, port, type=socket.SOCK_STREAM)
        addresses = []
        for row in rows:
            family, _, _, _, sockaddr = row
            address = sockaddr[0].split("%", 1)[0]
            parsed = ipaddress.ip_address(address)
            if not parsed.is_global or parsed.is_private or parsed.is_loopback or parsed.is_link_local or parsed.is_multicast or parsed.is_reserved or parsed.is_unspecified:
                raise ToolError("blocked_address")
            entry = (family, address)
            if entry not in addresses:
                addresses.append(entry)
        if not addresses:
            raise ToolError("dns_failed")
        return addresses
    except ToolError:
        raise
    except Exception:
        raise ToolError("dns_failed")


def _connect_pinned(scheme: str, host: str, port: int, family: int, address: str, timeout: float):
    """Open a socket to a numeric address while retaining the URL hostname for TLS."""
    ip = ipaddress.ip_address(address)
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sockaddr = (address, port, 0, 0) if family == socket.AF_INET6 else (address, port)
        sock.connect(sockaddr)
        if scheme == "https":
            context = ssl.create_default_context()
            sock = context.wrap_socket(sock, server_hostname=host)
        return sock
    except Exception:
        sock.close()
        raise


def _request_pinned(url: str, timeout: float = 8):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ToolError("invalid_url")
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    allow = os.environ.get("HX_HTTP_ALLOW", "").strip()
    if allow and host.lower() not in {h.strip().lower() for h in allow.split(",") if h.strip()}:
        raise ToolError("host_not_allowed")
    addresses = _resolve_public(host, port)
    path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
    host_header = host if parsed.port is None else host + ":" + str(port)
    last_error = None
    for family, address in addresses:
        conn = None
        try:
            conn = http.client.HTTPConnection(host, port, timeout=timeout) if parsed.scheme == "http" else http.client.HTTPSConnection(host, port, timeout=timeout, context=ssl.create_default_context())
            conn.connect = lambda f=family, a=address, s=parsed.scheme, h=host, p=port, t=timeout: setattr(conn, "sock", _connect_pinned(s, h, p, f, a, t))
            conn.connect()
            conn.request("GET", path, headers={"User-Agent": "Hymnix-Tool/1.0", "Host": host_header})
            response = conn.getresponse()
            return conn, response
        except Exception as exc:
            last_error = exc
            if conn is not None:
                conn.close()
    if isinstance(last_error, ToolError):
        raise last_error
    raise ToolError("fetch_failed")


def _web_fetch(args):
    url = args.get("url", "")
    response = None
    for redirect_count in range(11):
        conn, response = _request_pinned(url, timeout=8)
        if response.status not in (301, 302, 303, 307, 308):
            try:
                body = response.read(256 * 1024 + 1)
                headers = response.headers
                charset = headers.get_content_charset() if hasattr(headers, "get_content_charset") else None
                text = body[:256 * 1024].decode(charset or "utf-8", "replace")
                return {"status": response.status, "url": url, "text": text, "truncated": len(body) > 256 * 1024}
            finally:
                conn.close()
        location = response.getheader("Location")
        conn.close()
        if not location:
            raise ToolError("redirect_invalid")
        if redirect_count >= 10:
            raise ToolError("too_many_redirects")
        url = urllib.parse.urljoin(url, location)
    raise ToolError("too_many_redirects")

def builtin_tools() -> list[str]:
    register("time.now","Current local time",{"type":"object","properties":{}},lambda a:datetime.datetime.now().astimezone().isoformat())
    register("calc","Evaluate safe arithmetic",{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"]},lambda a:_calc(a["expression"]))
    register("fs.list","List root-scoped directory",{"type":"object","properties":{"path":{"type":"string"}}},_fs_list)
    register("fs.read","Read root-scoped UTF-8 text",{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]},_fs_read)
    register("fs.stat","Inspect root-scoped path",{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]},_fs_stat)
    register("sysinfo","Basic system information",{"type":"object","properties":{}},_sysinfo)
    register("web.fetch","Fetch HTTP(S) resource",{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]},_web_fetch)
    register("repo.tree","List root-scoped repository tree",{"type":"object","properties":{"path":{"type":"string"},"depth":{"type":"integer","minimum":1,"maximum":4},"limit":{"type":"integer","minimum":1,"maximum":500}},"additionalProperties":False},_repo_tree)
    register("repo.search","Search root-scoped repository text",{"type":"object","properties":{"query":{"type":"string"},"path":{"type":"string"},"include":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":200}},"required":["query"],"additionalProperties":False},_repo_search)
    register("repo.read","Read root-scoped repository text",{"type":"object","properties":{"path":{"type":"string"},"start":{"type":"integer","minimum":1},"lines":{"type":"integer","minimum":1,"maximum":400}},"required":["path"],"additionalProperties":False},_repo_read)
    try:
        from hxcore import approvals
        approvals._SAFE_TOOLS.update({"repo.tree","repo.search","repo.read"})
    except Exception: pass
    return ["time.now","calc","fs.list","fs.read","fs.stat","sysinfo","web.fetch","repo.tree","repo.search","repo.read"]

def call(name: str, args: dict, *, approve=None) -> dict:
    start=time.perf_counter(); cid=""
    try:
        from hxcore import toolcall
        cid=toolcall.begin(name,args if isinstance(args,dict) else {},origin="api")
    except Exception: pass
    try:
        if _DISABLED: raise ToolError("tools_disabled")
        item=_REGISTRY.get(name)
        if not item: raise ToolError("unknown_tool")
        invalid=_validate(item["schema"],args)
        if invalid: raise ToolError(invalid)
        try:
            from hxcore import approvals
            command="tool:"+name+" "+json.dumps(args,ensure_ascii=False)
            decision=approvals.check(command, origin="tool")
            approvals.record(decision, command)
            if decision.get("decision")=="deny":
                payload={"ok":False,"result":None,"error":"denied","decision":decision,"ms":(time.perf_counter()-start)*1000,"id":cid}
                return payload
            if decision.get("risk")=="danger" and decision.get("decision")=="ask":
                if not callable(approve):
                    payload={"ok":False,"result":None,"error":"needs_approval","decision":decision,"ms":(time.perf_counter()-start)*1000,"id":cid}
                    return payload
                if not approve(name,args,decision):
                    payload={"ok":False,"result":None,"error":"denied","decision":decision,"ms":(time.perf_counter()-start)*1000,"id":cid}
                    return payload
        except ImportError:
            pass
        if item["danger"] and (not callable(approve) or not approve(name,args,{})): raise ToolError("approval_required")
        result=item["handler"](args)
        payload={"ok":True,"result":result,"error":"","ms":(time.perf_counter()-start)*1000,"id":cid}
    except Exception as exc:
        payload={"ok":False,"result":None,"error":str(exc) or type(exc).__name__,"ms":(time.perf_counter()-start)*1000,"id":cid}
    try:
        from hxcore import toolcall
        toolcall.end(cid,payload["ok"],result=payload["result"],error=payload["error"],ms=payload["ms"])
    except Exception: pass
    try:
        from hxcore import logindex
        logindex.record("tools","call",{"id":cid,"tool":name,"args":args,"ok":payload["ok"],"result":payload["result"],"error":payload["error"],"ms":payload["ms"]})
    except Exception: pass
    return payload

def off() -> None:
    global _DISABLED
    _DISABLED=True
