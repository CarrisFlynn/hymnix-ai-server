# -*- coding: utf-8 -*-
"""Alias arguments must survive the approval boundary: data -> content."""
import json, os, secrets, subprocess, sys, tempfile, time, urllib.request

ROOT = r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0"
data = tempfile.mkdtemp(prefix="hx-alias-")
api_key = "K" + secrets.token_urlsafe(18)
admin_key = "A" + secrets.token_urlsafe(18)
json.dump({"api_key": api_key, "admin_key": admin_key, "auto_approve_tools": False,
           "tool_policy": "workspace", "host_password": "x"},
          open(os.path.join(data, "gateway_config.json"), "w", encoding="utf-8"))
control = tempfile.mkdtemp(prefix="hx-alias-ctl-")
env = {**os.environ, "HYMNIX_DATA_DIR": data, "HYMNIX_DESKTOP_CONTROL_DIR": control}
proc = subprocess.Popen([sys.executable, "-u", "headless_gateway.py"], cwd=os.path.join(ROOT, "server"), env=env,
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

def post(path, body, key, header):
    request = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode(),
                                     method="POST", headers={header: key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()

status, body = post("/api/tools/call", {"request_id": "alias-" + str(int(time.time())), "tool": "fs.write",
                                        "args": {"path": "alias-probe.txt", "data": "hello"}}, api_key, "X-API-Key")
pending = json.loads(body) if status == 202 else {}
approval_id = (pending.get("approval") or {}).get("id", "")
if not approval_id:
    print("NO_PENDING", status, body[:200])
else:
    status2, body2 = post("/admin/approvals/" + approval_id, {"decision": "allow"}, admin_key, "X-Admin-Key")
    parsed = json.loads(body2)
    print("ALIAS_APPROVAL", status2, json.dumps(parsed)[:240])
proc.kill()
