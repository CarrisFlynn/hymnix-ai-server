# -*- coding: utf-8 -*-
"""Persistent terminal through the real gateway and approval queue."""
import json, os, secrets, subprocess, sys, tempfile, time, urllib.request

ROOT = r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0"
data = tempfile.mkdtemp(prefix="hx-term-")
api_key = "K" + secrets.token_urlsafe(18); admin_key = "A" + secrets.token_urlsafe(18)
json.dump({"api_key": api_key, "admin_key": admin_key, "auto_approve_tools": False,
           "tool_policy": "workspace", "host_password": "x"},
          open(os.path.join(data, "gateway_config.json"), "w", encoding="utf-8"))
control = tempfile.mkdtemp(prefix="hx-term-ctl-")
env = {**os.environ, "HYMNIX_DATA_DIR": data, "HYMNIX_DESKTOP_CONTROL_DIR": control}
proc = subprocess.Popen([sys.executable, "-u", "headless_gateway.py"], cwd=os.path.join(ROOT, "server"), env=env,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ready = os.path.join(control, "ready.json"); port = None
for _ in range(120):
    time.sleep(0.25)
    if os.path.exists(ready):
        try: port = json.load(open(ready, encoding="utf-8"))["port"]; break
        except Exception: continue

def post(path, body, key, header):
    request = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode(),
                                     method="POST", headers={header: key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()

def call(tool, args):
    status, body = post("/api/tools/call", {"request_id": tool + "-" + str(int(time.time() * 1000)), "tool": tool, "args": args}, api_key, "X-API-Key")
    if status == 200:
        # safe tools execute directly and return their result in the body
        try: return status, body, json.loads(body).get("result") or {}
        except Exception: return status, body, {}
    if status != 202:
        return status, body, {}
    approval_id = (json.loads(body).get("approval") or {}).get("id", "")
    status2, body2 = post("/admin/approvals/" + approval_id, {"decision": "allow"}, admin_key, "X-Admin-Key")
    return status2, body2, json.loads(body2).get("result") or {}

s1, b1, started = call("term.start", {"cwd": "."})
print("START", s1, json.dumps(started)[:120])
if started.get("id"):
    s2, _, _ = call("term.write", {"id": started["id"], "input": "echo term-approved"})
    time.sleep(2)
    collected = ""
    s3 = 0
    for _ in range(4):
        s3, _, out = call("term.read", {"id": started["id"], "timeout_s": 2})
        collected += out.get("output") or ""
        if "term-approved" in collected:
            break
    s4, _, stopped = call("term.stop", {"id": started["id"]})
    print("WRITE", s2, "READ", s3, "STOP", s4, "SAW", "term-approved" in collected)
    print("OUTPUT", repr(collected[-300:]))
proc.kill()
