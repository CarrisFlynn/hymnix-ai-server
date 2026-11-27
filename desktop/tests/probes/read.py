import os, sys, tempfile
sys.path.insert(0, ".")
work = tempfile.mkdtemp(prefix="hx-gate-")
os.environ["HYMNIX_WORKSPACE"] = work
from hxcore import paths
from hxcore import tools
tools.builtin_tools()
paths.set_workspace(work)
open(os.path.join(work, "big.txt"), "w", encoding="utf-8").write("x" * 300000)
r = tools.call("fs.read", {"path": "big.txt"}, approve=lambda *a: True)
row = r.get("result") or {}
print("READ", row.get("truncated"), row.get("bytes"), len(row.get("text") or ""))
