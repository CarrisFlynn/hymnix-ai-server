# -*- coding: utf-8 -*-
"""Small stdlib MCP JSON-RPC client for stdio and HTTP/SSE servers."""
from __future__ import annotations
import atexit, json, os, queue, shlex, subprocess, threading, time
from pathlib import Path
from typing import Any
from urllib import request
from hxcore.paths import root_dir

class McpManager:
    def __init__(self, servers: dict | None = None):
        self.servers = servers if isinstance(servers, dict) else self._load_config()
        self._procs: dict[str, subprocess.Popen] = {}
        self._locks: dict[str, threading.RLock] = {}
        self._ids = 0
        self._lock = threading.RLock()
        self._http_ready: set[str] = set()
        atexit.register(self.stop_all)

    def _load_config(self):
        try:
            p = Path(root_dir()) / "config" / "mcp.json"
            data = json.loads(p.read_text(encoding="utf-8"))
            return data.get("servers", {}) if isinstance(data, dict) and isinstance(data.get("servers", {}), dict) else {}
        except Exception:
            return {}

    def _spec(self, name):
        value = self.servers.get(name)
        return value if isinstance(value, dict) and value.get("enabled", True) is not False else None

    def _transport(self, spec):
        return str(spec.get("transport", "stdio")).lower() if isinstance(spec, dict) else "stdio"

    def _next_id(self):
        with self._lock:
            self._ids += 1
            return self._ids

    def start(self, name: str) -> bool:
        try:
            spec = self._spec(name)
            if not spec: return False
            if self._transport(spec) == "http":
                if not spec.get("url"): return False
                with self._lock: ready = name in self._http_ready
                if ready: return True
                init = self._http_request(name, "initialize", {"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"Hymnix","version":"1"}}, 10.0)
                if init.get("ok"):
                    with self._lock: self._http_ready.add(name)
                return bool(init.get("ok"))
            with self._lock:
                if name in self._procs and self._procs[name].poll() is None: return True
            if not spec.get("command"): return False
            raw_command = spec.get("command")
            command = [str(x) for x in raw_command] if isinstance(raw_command, (list, tuple)) else [str(raw_command)] + [str(x) for x in spec.get("args", [])]
            if len(command) == 1 and any(ch.isspace() for ch in command[0]): command = shlex.split(command[0], posix=False)
            env = os.environ.copy()
            if isinstance(spec.get("env"), dict): env.update({str(k): str(v) for k,v in spec["env"].items()})
            proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace", env=env, bufsize=1)
            with self._lock:
                self._procs[name] = proc; self._locks.setdefault(name, threading.RLock())
            init = self._request(name, "initialize", {"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"Hymnix","version":"1"}}, 20.0)
            return bool(init.get("ok"))
        except Exception:
            self.stop(name); return False

    def stop(self, name: str) -> bool:
        with self._lock:
            proc = self._procs.pop(name, None); self._http_ready.discard(name)
        if not proc: return True
        try:
            if proc.poll() is None: proc.kill()
            proc.wait(timeout=2)
        except Exception:
            try: proc.kill()
            except Exception: pass
        for stream in (proc.stdin, proc.stdout):
            try:
                if stream: stream.close()
            except Exception: pass
        return True

    def stop_all(self) -> None:
        with self._lock: names = list(set(self._procs) | set(self._http_ready))
        for name in names: self.stop(name)

    def _http_request(self, name, method, params, timeout=10.0):
        spec = self._spec(name)
        if not spec or not spec.get("url"): return {"ok":False,"error":"not_configured"}
        rid = self._next_id()
        payload = {"jsonrpc":"2.0","id":rid,"method":method,"params":params}
        headers = {"Content-Type":"application/json", "Accept":"application/json, text/event-stream"}
        if isinstance(spec.get("headers"), dict): headers.update({str(k):str(v) for k,v in spec["headers"].items()})
        req = request.Request(str(spec["url"]), data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=min(10.0, max(0.1, float(timeout)))) as response:
                ctype = str(response.headers.get("Content-Type", "")).lower()
                if "text/event-stream" not in ctype:
                    obj = json.loads(response.read().decode("utf-8", "replace"))
                    return self._http_result(obj, rid)
                event_data = []
                for raw_line in response:
                    line = raw_line.decode("utf-8", "replace").rstrip("\r\n")
                    if line == "":
                        result = self._sse_event(event_data, rid)
                        event_data = []
                        if result is not None:
                            return result
                    elif line.startswith("data:"):
                        event_data.append(line[5:].lstrip(" "))
                result = self._sse_event(event_data, rid)
                return result if result is not None else {"ok":False,"error":"invalid_response"}
        except Exception as exc:
            if isinstance(exc, TimeoutError) or exc.__class__.__name__ in ("URLError", "socket.timeout") and "timed out" in str(exc).lower():
                return {"ok":False,"error":"timeout"}
            text = str(exc).lower()
            return {"ok":False,"error":"timeout" if "timed out" in text or "timeout" in text else str(exc)}

    @staticmethod
    def _http_result(obj, rid):
        if not isinstance(obj, dict): return {"ok":False,"error":"invalid_response"}
        if obj.get("id") != rid: return {"ok":False,"error":"id_mismatch"}
        if "error" in obj: return {"ok":False,"error":str(obj["error"])}
        return {"ok":True,"result":obj.get("result")}

    def _sse_event(self, data_lines, rid):
        if not data_lines: return None
        try:
            obj = json.loads("\n".join(data_lines))
        except Exception:
            return None
        if not isinstance(obj, dict) or "id" not in obj:
            return None
        return self._http_result(obj, rid)

    def _request(self, name, method, params, timeout):
        spec = self._spec(name)
        if self._transport(spec) == "http": return self._http_request(name, method, params, min(10.0, timeout))
        lock = self._locks.setdefault(name, threading.RLock())
        with lock:
            with self._lock: proc = self._procs.get(name)
            if not proc or proc.poll() is not None: return {"ok":False,"error":"not_running"}
            rid = self._next_id(); payload = {"jsonrpc":"2.0","id":rid,"method":method,"params":params}
            try:
                proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n"); proc.stdin.flush()
                resultq = queue.Queue(maxsize=1)
                def read_one():
                    try: resultq.put(json.loads(proc.stdout.readline()))
                    except Exception as exc: resultq.put({"_exception":str(exc)})
                threading.Thread(target=read_one, daemon=True).start()
                deadline = time.monotonic() + max(0.1, float(timeout))
                while time.monotonic() < deadline:
                    try: response = resultq.get(timeout=min(0.1, deadline-time.monotonic())); break
                    except queue.Empty: pass
                else:
                    self.stop(name); return {"ok":False,"error":"timeout"}
                if response.get("_exception"): return {"ok":False,"error":response["_exception"]}
                if response.get("id") != rid: return {"ok":False,"error":"id_mismatch"}
                if "error" in response: return {"ok":False,"error":str(response["error"])}
                return {"ok":True,"result":response.get("result")}
            except Exception as exc: return {"ok":False,"error":str(exc)}

    def list_tools(self, name: str | None = None) -> list[dict]:
        names = [name] if name else list(self.servers)
        output=[]
        for server in names:
            if not self.start(server): continue
            response=self._request(server,"tools/list",{},10.0)
            if response.get("ok"):
                result=response.get("result") or {}; items=result.get("tools",[]) if isinstance(result,dict) else []
                for item in items:
                    if isinstance(item,dict) and item.get("name"): output.append({"server":server,**item})
        return output

    def call(self, name: str, tool: str, args: dict, timeout: float = 10.0) -> dict:
        try:
            if not self.start(name): return {"ok":False,"error":"start_failed"}
            return self._request(name,"tools/call",{"name":tool,"arguments":args if isinstance(args,dict) else {}},min(10.0, timeout))
        except Exception as exc: return {"ok":False,"error":str(exc)}

    def status(self) -> dict:
        result = {}
        for name, spec in self.servers.items():
            transport = self._transport(spec)
            connected = (name in self._http_ready) if transport == "http" else bool(self._procs.get(name) and self._procs[name].poll() is None)
            tools = [x.get("name") for x in self.list_tools(name)] if connected else []
            result[name] = {"transport":transport,"connected":connected,"tools":[x for x in tools if x]}
        return result

    def register_into(self, registry) -> list[str]:
        names=[]
        try:
            for item in self.list_tools():
                server, tool = item["server"], item["name"]; full=f"mcp:{server}:{tool}"
                schema=item.get("inputSchema") or {"type":"object","properties":{}}
                handler=lambda args, s=server, t=tool: self.call(s,t,args)
                if registry.register(full, item.get("description", "MCP tool"), schema, handler, permission="mcp"):
                    names.append(full)
        except Exception: pass
        return names
