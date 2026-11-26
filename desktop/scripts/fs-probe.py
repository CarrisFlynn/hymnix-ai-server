# -*- coding: utf-8 -*-
import json, os, subprocess, sys, tempfile, time, secrets

ROOT = r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0"
data = tempfile.mkdtemp(prefix="hx-fs-")
cfg = {
    "api_key": "Hx" + secrets.token_urlsafe(12),
    "admin_key": "Ad" + secrets.token_urlsafe(12),
    "auto_approve_tools": True,
    "tool_policy": "workspace",
    "host_password": "x",
}
json.dump(cfg, open(os.path.join(data, "gateway_config.json"), "w", encoding="utf-8"))
control = tempfile.mkdtemp(prefix="hx-fs-ctl-")
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
import urllib.request
def post(path, body, key, header):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode(), method="POST",
                                 headers={header: key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()

status, body = post("/api/tools/call", {"request_id": "fs-" + str(int(time.time())), "tool": "fs.write",
                                        "args": {"path": "fs-probe.txt", "content": "ok"}}, cfg["api_key"], "X-API-Key")
print("RESULT", status, body[:400])
proc.kill()
