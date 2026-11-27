# -*- coding: utf-8 -*-
"""End to end: agent-side command execution and structured edit, through approval."""
import json, os, secrets, subprocess, sys, tempfile, time, urllib.request

ROOT = r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0"
data = tempfile.mkdtemp(prefix="hx-agent-")
api_key = "K" + secrets.token_urlsafe(18)
admin_key = "A" + secrets.token_urlsafe(18)
json.dump({"api_key": api_key, "admin_key": admin_key, "auto_approve_tools": False,
           "tool_policy": "workspace", "host_password": "x"},
          open(os.path.join(data, "gateway_config.json"), "w", encoding="utf-8"))
control = tempfile.mkdtemp(prefix="hx-agent-ctl-")
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
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()

def approved_call(tool, args):
    status, body = post("/api/tools/call", {"request_id": tool.replace(".", "-") + "-" + str(int(time.time() * 1000)),
                                            "tool": tool, "args": args}, api_key, "X-API-Key")
    if status != 202:
        return status, body
    approval_id = (json.loads(body).get("approval") or {}).get("id", "")
    return post("/admin/approvals/" + approval_id, {"decision": "allow"}, admin_key, "X-Admin-Key")

status, body = approved_call("shell.run", {"command": "echo agent-ok"})
parsed = json.loads(body) if body.startswith("{") else {}
result = parsed.get("result") or {}
print("SHELL", status, json.dumps({"exit": result.get("exit_code"), "stdout": (result.get("stdout") or "").strip()})[:160])

open(os.path.join(ROOT, "agent-edit.txt"), "w", encoding="utf-8").write("before value")
status2, body2 = approved_call("fs.edit", {"path": "agent-edit.txt", "find": "before", "replace": "after"})
after = open(os.path.join(ROOT, "agent-edit.txt"), encoding="utf-8").read()
print("EDIT", status2, json.dumps({"ok": json.loads(body2).get("ok") if body2.startswith("{") else False, "text": after})[:160])
os.remove(os.path.join(ROOT, "agent-edit.txt"))
proc.kill()
