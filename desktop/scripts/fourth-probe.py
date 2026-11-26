# -*- coding: utf-8 -*-
"""Behaviour probes for the fourth review: request boundaries, save_cfg, tunnel, handler."""
import json, os, socket, subprocess, sys, tempfile, time

ROOT = r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0"
SERVER = os.path.join(ROOT, "server")
sys.path.insert(0, SERVER)

data = tempfile.mkdtemp(prefix="hx-four-")
json.dump({"api_key": "K" + "x" * 20, "admin_key": "A" + "y" * 20,
           "host_password": "", "trust_proxy_headers": False},
          open(os.path.join(data, "gateway_config.json"), "w", encoding="utf-8"))
control = tempfile.mkdtemp(prefix="hx-four-ctl-")
env = {**os.environ, "HYMNIX_DATA_DIR": data, "HYMNIX_DESKTOP_CONTROL_DIR": control}
proc = subprocess.Popen([sys.executable, "-u", "headless_gateway.py"], cwd=SERVER, env=env,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ready = os.path.join(control, "ready.json")
port = None
for _ in range(120):
    time.sleep(0.25)
    if os.path.exists(ready):
        try:
            port = json.load(open(ready, encoding="utf-8"))["port"]
            break
        except Exception:
            continue

def raw(request):
    sock = socket.create_connection(("127.0.0.1", port), timeout=5)
    sock.sendall(request.encode())
    data_out = b""
    try:
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            data_out += chunk
    except socket.timeout:
        pass
    sock.close()
    return data_out

# duplicate Content-Length
dup = raw("POST /health HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nContent-Length: 5\r\n\r\nhello")
print("DUP_CL", dup.count(b"HTTP/1.1"), dup[:120].decode("latin-1").replace("\r\n", " "))
# body on GET
getbody = raw("GET /health HTTP/1.1\r\nHost: x\r\nContent-Length: 12\r\n\r\nGET /admin/x")
print("GET_BODY", getbody.count(b"HTTP/1.1"), getbody[:140].decode("latin-1").replace("\r\n", " "))

proc.kill()

# _save_cfg actually writes
# _save_cfg is covered by save-cfg-probe.py (its own data dir)

# a failed tunnel start leaves the flag off
gateway_core.CFG["host_password"] = ""
gateway_core.CFG["trust_proxy_headers"] = False
gateway_core.start_tunnel()
print("TUNNEL_ROLLBACK", gateway_core.CFG.get("trust_proxy_headers") is False)

# handler runs its side effect once and the error propagates
from hxcore import plugins
counter = {"n": 0}
def handler(args):
    counter["n"] += 1
    raise ValueError("inside")
try:
    plugins._call_handler(handler, {})
except ValueError:
    pass
print("HANDLER_ONCE", counter["n"] == 1)

# zero-arg handlers still work
print("ZERO_ARG", plugins._call_handler(lambda: {"ok": True}, {}) == {"ok": True})
