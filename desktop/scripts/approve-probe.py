# -*- coding: utf-8 -*-
import json, os, sys, tempfile, time, urllib.request

ROOT = r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0"
SERVER = os.path.join(ROOT, "server")
sys.path.insert(0, SERVER)
control = tempfile.mkdtemp(prefix="hx-appr-")
env = {**os.environ, "HYMNIX_DESKTOP_CONTROL_DIR": control}
proc = __import__("subprocess").Popen([sys.executable, "-u", "headless_gateway.py"], cwd=SERVER, env=env,
                                      stdout=__import__("subprocess").DEVNULL, stderr=__import__("subprocess").DEVNULL)
ready = os.path.join(control, "ready.json")
for _ in range(120):
    time.sleep(0.25)
    if os.path.exists(ready):
        try:
            port = json.load(open(ready, encoding="utf-8"))["port"]
            break
        except Exception:
            continue
cfg = json.load(open(os.path.join(os.environ.get("LOCALAPPDATA", ""), "Hymnix", "gateway_config.json"), encoding="utf-8"))
base = "http://127.0.0.1:%d" % port

def post(path, body, key, header):
    data = json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method="POST",
                                 headers={header: key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()

status, body = post("/api/tools/call", {"request_id": "probe-" + str(int(time.time())), "tool": "fs.write",
                                        "args": {"path": "approve-probe.txt", "content": "ok"}}, cfg["api_key"], "X-API-Key")
print("CALL", status, body[:260])
approval_id = json.loads(body).get("approval", {}).get("id", "")
print("ID", approval_id, len(approval_id))
status2, body2 = post("/admin/approvals/" + approval_id, {"decision": "allow"}, cfg["admin_key"], "X-Admin-Key")
print("APPROVE", status2, body2[:400])
proc.kill()
