import os, sys, tempfile
sys.path.insert(0, ".")
work = tempfile.mkdtemp(prefix="hx-gate-")
os.environ["HYMNIX_WORKSPACE"] = work
from hxcore import paths
from hxcore import tools
tools.builtin_tools()
paths.set_workspace(work)
body = "\n".join("line%04d payload" % i for i in range(10000)) + "\n"
path = os.path.join(work, "big.txt")
open(path, "w", encoding="utf-8", newline="").write(body)
before = os.path.getsize(path)
tools.call("fs.edit", {"path": "big.txt", "find": "line0001 payload", "replace": "LINE0001 payload"}, approve=lambda *a: True)
after = os.path.getsize(path)
raw = open(path, "rb").read()
print("SIZE", before, after)
print("CRLF", b"\r\n" in raw)
print("TAIL", raw.rstrip().endswith(b"line9999 payload"))
