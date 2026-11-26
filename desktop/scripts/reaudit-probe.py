# -*- coding: utf-8 -*-
"""Behaviour probes for the re-audit: OPTIONS smuggling, plugin args, file hash."""
import hashlib, json, os, socket, subprocess, sys, tempfile, time

ROOT = r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0"
SERVER = os.path.join(ROOT, "server")
sys.path.insert(0, SERVER)

def start_gateway():
    control = tempfile.mkdtemp(prefix="hx-re-")
    proc = subprocess.Popen([sys.executable, "-u", "headless_gateway.py"], cwd=SERVER,
                            env={**os.environ, "HYMNIX_DESKTOP_CONTROL_DIR": control},
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ready = os.path.join(control, "ready.json")
    for _ in range(120):
        time.sleep(0.25)
        if os.path.exists(ready):
            try:
                return proc, control, json.load(open(ready, encoding="utf-8"))
            except Exception:
                continue
    return proc, control, None

def smuggle_options(port, admin_key):
    sock = socket.create_connection(("127.0.0.1", port), timeout=5)
    body = "POST /connect HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n"
    smuggled = "GET /admin/config?key=%s HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n" % admin_key
    request = ("OPTIONS /health HTTP/1.1\r\nHost: x\r\nContent-Length: %d\r\n\r\n" % len(smuggled)) + smuggled
    sock.sendall(request.encode())
    data = b""
    try:
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            data += chunk
    except socket.timeout:
        pass
    sock.close()
    return data.count(b"HTTP/1.1"), data[:160].decode("latin-1").replace("\r\n", " ")

proc, control, ready = start_gateway()
if not ready:
    print("GATEWAY_FAILED")
    raise SystemExit(1)
port = ready["port"]
try:
    cfg = json.load(open(os.path.join(os.environ.get("LOCALAPPDATA", ""), "Hymnix", "gateway_config.json"), encoding="utf-8"))
    admin = cfg.get("admin_key", "")
    count, head = smuggle_options(port, admin)
    print("OPTIONS_SMUGGLE", json.dumps({"responses": count, "head": head}))
finally:
    try:
        proc.kill()
    except Exception:
        pass

# plugin arguments: the built-in clock-tools example must accept the host's args
from hxcore import plugins
folder = os.path.join(plugins.plugins_root(), "clock-tools")
plugins.grant("clock-tools", "fs.read")
plugins.set_enabled("clock-tools", True)
result = plugins.load("clock-tools")
print("CLOCK_LOAD", json.dumps(result, ensure_ascii=False, default=str)[:200])
from hxcore import tools as host_tools
call = host_tools.call("clock-tools.world_clock", {}) if hasattr(host_tools, "call") else None
print("CLOCK_CALL", json.dumps(call, ensure_ascii=False, default=str)[:300] if call is not None else "no-call-api")

# whole-file hash: a file larger than 4096 bytes must hash entirely
import importlib.util
spec = importlib.util.spec_from_file_location("hymnix_main", os.path.join(SERVER, "hymnix_main.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
blob = (b"hymnix" * 2000)
with tempfile.NamedTemporaryFile(delete=False) as fh:
    fh.write(blob)
    path = fh.name
whole = hashlib.sha256(blob).hexdigest()
head = hashlib.sha256(blob[:4096]).hexdigest()
print("HASH", json.dumps({"whole": module._sha256_file(path) == whole, "not_head": module._sha256_file(path) != head, "size": len(blob)}))
os.unlink(path)
